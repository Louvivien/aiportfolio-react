import test from 'node:test';
import assert from 'node:assert/strict';
import { planSale } from '../src/salePlan.js';
import { recordSale, previewSale } from '../src/saleService.js';
import { valuePosition, periodPerformance, positionLots } from '../src/finance.js';

const exail = () => ({ symbol: 'EXAIL', quantity: 20, cost_price: 45,
  updated_at: new Date('2026-06-01T00:00:00Z'), purchase_lots: [
    { id: 'five', quantity: 5, cost_price: 60, purchase_date: '2026-05-20', stop_loss_set: true },
    { id: 'fifteen', quantity: 15, cost_price: 40, purchase_date: '2026-05-01', stop_loss_set: true },
  ] });
const sale = (extra = {}) => ({ sale_id: 'test-sale', quantity: 10, price: 100, date: '2026-06-15',
  lot_index: null, expected_updated_at: '2026-06-01T00:00:00.000Z', ...extra });

test('Exail: selling 10 splits the earlier purchase of 15 and keeps the original 5 untouched', () => {
  const doc = exail(), original = structuredClone(doc);
  const result = planSale(doc, sale());
  assert.deepEqual(doc, original);
  assert.equal(result.remaining_quantity, 10);
  assert.equal(result.proceeds, 1000);
  assert.deepEqual(result.purchase_lots[0], original.purchase_lots[0]);
  assert.equal(result.purchase_lots[1].quantity, 5);
  const closed = result.purchase_lots[2];
  assert.equal(closed.quantity, 10);
  assert.equal(closed.cost_price, 40);
  assert.equal(closed.purchase_date, '2026-05-01');
  assert.equal(closed.closing_date, '2026-06-15');
  assert.equal(closed.closing_price, 100);
  assert.equal(closed.stop_loss_set, false);
  assert.equal(new Set(result.purchase_lots.map((lot) => lot.id)).size, 3);
  const updated = { ...doc, purchase_lots: result.purchase_lots, current_price: 110 };
  const valuation = valuePosition(updated, [], (v) => v, '2026-06-30');
  assert.equal(valuation.open_cost, 500);
  assert.equal(valuation.closed_cost, 400);
  assert.equal(valuation.realized_pl, 600);
  assert.equal(valuation.market_value, 1100);
  assert.equal(valuation.total_pl, 1200);
  const monthly = periodPerformance(positionLots(updated), [{ date: '2026-05-31', close: 80 }, { date: '2026-06-30', close: 110 }],
    { periodStart: '2026-06-01', periodEnd: '2026-06-30' });
  assert.equal(monthly.gain, 500); // Sold ten gain 200; remaining ten gain 300.
});

test('a sale can span purchases, select a specific purchase, or close everything', () => {
  const spanning = planSale(exail(), sale({ quantity: 18 }));
  assert.deepEqual(spanning.allocations.map((a) => a.quantity), [15, 3]);
  assert.equal(spanning.remaining_quantity, 2);
  const specific = planSale(exail(), sale({ quantity: 3, lot_index: 0 }));
  assert.equal(specific.allocations[0].cost_price, 60);
  assert.deepEqual(specific.purchase_lots.at(-1), exail().purchase_lots[1]);
  assert.ok(planSale(exail(), sale({ quantity: 20 })).purchase_lots.every((lot) => lot.is_closed));
});

test('successive sales preserve earlier proceeds and support fractional and legacy positions', () => {
  const doc = { quantity: 0.3, cost_price: 10, purchase_date: '2026-01-01' };
  const first = planSale(doc, sale({ quantity: 0.1 }));
  const second = planSale({ ...doc, purchase_lots: first.purchase_lots }, sale({ sale_id: 'second', quantity: 0.2, price: 0 }));
  assert.equal(second.remaining_quantity, 0);
  assert.equal(second.purchase_lots.reduce((total, lot) => total + lot.quantity * lot.closing_price, 0), 10);
  assert.deepEqual(second.purchase_lots[1], first.purchase_lots[1]);
});

test('invalid and excessive sales are rejected without changing holdings', () => {
  const doc = exail(), original = structuredClone(doc);
  for (const change of [{ quantity: 21 }, { quantity: 0 }, { quantity: -1 }, { quantity: NaN }, { quantity: 1e-9 },
    { quantity: '10' }, { price: null }, { price: -1 }, { price: Infinity }, { date: '2026-02-30' },
    { date: '2099-01-01' }, { date: '2026-04-01' }, { lot_index: 3 }, { lot_index: 0 }, { lot_index: 0.5 }]) {
    assert.throws(() => planSale(doc, sale(change)), JSON.stringify(change));
  }
  assert.deepEqual(doc, original);
  assert.throws(() => planSale({ ...doc, is_closed: true }, sale()));
  const missingDate = exail(); delete missingDate.purchase_lots[0].purchase_date;
  assert.throws(() => planSale(missingDate, sale()), /date des achats/);
  assert.equal(planSale(missingDate, sale({ lot_index: 1 })).remaining_quantity, 10);
});

function database() {
  let stored = { ...exail(), _id: 'position' };
  let invalidations = 0;
  return {
    positions: {
      async findOne() { return structuredClone(stored); },
      async updateOne(filter, update) {
        if (filter.updated_at.getTime() !== stored.updated_at.getTime()) return { matchedCount: 0 };
        stored = { ...stored, ...structuredClone(update.$set), recorded_sales: [...(stored.recorded_sales ?? []), structuredClone(update.$push.recorded_sales)] };
        return { matchedCount: 1 };
      },
    },
    monthlyReports: { async updateMany() { invalidations += 1; } },
    get stored() { return stored; }, get invalidations() { return invalidations; },
  };
}

test('sale persistence updates aggregates, invalidates reports, and makes retries idempotent', async () => {
  const db = database();
  await recordSale(db, 'position', sale());
  assert.equal(db.stored.quantity, 10);
  assert.equal(db.stored.cost_price, 50);
  assert.equal(db.stored.is_closed, false);
  assert.equal(db.stored.closing_price, null);
  assert.equal(db.stored.recorded_sales.length, 1);
  assert.equal(db.invalidations, 1);
  await recordSale(db, 'position', sale());
  assert.equal(db.stored.quantity, 10);
  assert.equal(db.stored.recorded_sales.length, 1);
  await assert.rejects(() => recordSale(db, 'position', sale({ price: 99 })), { status: 409 });
  await assert.rejects(() => recordSale(db, 'position', sale({ sale_id: 'stale' })), { status: 409 });
  await recordSale(db, 'position', sale({ sale_id: 'final', expected_updated_at: db.stored.updated_at.toISOString() }));
  assert.equal(db.stored.is_closed, true);
  assert.equal(db.stored.closing_price, 100);
  assert.equal(db.stored.closing_date.toISOString(), '2026-06-15T00:00:00.000Z');
});

test('preview is read-only and an intervening edit prevents saving the outdated allocation', async () => {
  const db = database(), original = structuredClone(db.stored);
  const preview = await previewSale(db, 'position', sale());
  assert.equal(preview.remaining_quantity, 10);
  assert.deepEqual(preview.allocations.map((entry) => [entry.lot_index, entry.quantity]), [[1, 10]]);
  assert.deepEqual(db.stored, original);
  assert.equal(db.invalidations, 0);
  db.stored.updated_at = new Date('2026-06-02');
  await assert.rejects(() => recordSale(db, 'position', sale()), { status: 409 });
  assert.equal(db.stored.quantity, 20);
});

test('concurrent sales cannot overwrite each other or duplicate the same sale', async () => {
  const db = database();
  const results = await Promise.allSettled([recordSale(db, 'position', sale()), recordSale(db, 'position', sale({ sale_id: 'another' }))]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(db.stored.recorded_sales.length, 1);
  const same = database();
  await Promise.all([recordSale(same, 'position', sale()), recordSale(same, 'position', sale())]);
  assert.equal(same.stored.recorded_sales.length, 1);
});
