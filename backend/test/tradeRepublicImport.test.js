import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTradeRepublicTrade, netTradeUnitPrice } from '../src/tradeRepublicImport.js';
import { assertNonnegativeClosingPrices } from '../src/positionValidation.js';
import { valuePosition } from '../src/finance.js';
import { calculatePersonalPerformance } from '../src/personalPerformance.js';
import { reconstructSecurities } from '../src/personalPerformanceValuation.js';
const sale = { type: 'SELL', shares: '-1.0000000000', price: '890', amount: '890.00', fee: '-1.00', tax: '', currency: 'EUR' };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('a signed share outflow produces positive net sale proceeds while retaining the real fee', () => {
  const result = normalizeTradeRepublicTrade(sale);
  assert.equal(result.quantity, 1); assert.equal(result.source_quantity, -1); assert.equal(result.signed_quantity, -1);
  assert.equal(result.execution_price_eur, 890); assert.equal(result.fee_cash_cents, -100);
  assert.equal(result.net_cash_cents, 88900); assert.equal(result.net_unit_price_eur, 889);
  assert.equal(normalizeTradeRepublicTrade({ ...sale, shares: '1' }).net_unit_price_eur, 889);
});

test('purchase debits and sale credits use different signs without losing fees, taxes or settlement rounding', () => {
  const buy = normalizeTradeRepublicTrade({ ...sale, type: 'BUY', shares: '1.011031', price: '988.10', amount: '-999', fee: '-1' });
  close(buy.net_unit_price_eur, 1000 / 1.011031);
  const fractional = normalizeTradeRepublicTrade({ ...sale, shares: '-0.5', amount: '445', tax: '-0.5' });
  assert.equal(fractional.net_cash_cents, 44350); assert.equal(fractional.net_unit_price_eur, 887);
});

test('inconsistent inputs are rejected rather than making every signed number positive', () => {
  for (const changes of [{ amount: '-890' }, { price: '-890' }, { shares: '0' }, { shares: '' }, { shares: 'NaN' },
    { fee: '1' }, { tax: '1' }, { fee: '-900' }, { amount: '890.001' }, { currency: 'USD' }]) {
    assert.throws(() => normalizeTradeRepublicTrade({ ...sale, ...changes }));
  }
  assert.throws(() => netTradeUnitPrice({ direction: 'sell', quantity: -1, net_cash_cents: 88900 }));
});

test('position edits cannot persist a negative price at position or purchase-lot level', () => {
  for (const body of [{ closing_price: -889 }, { purchase_lots: [{ closing_price: '-889' }] }, { purchase_lots: [{ closingPrice: -889 }] }])
    assert.throws(() => assertNonnegativeClosingPrices(body), (error) => error.status === 400);
  for (const value of [null, undefined, 0, 889]) assert.doesNotThrow(() => assertNonnegativeClosingPrices({ closing_price: value }));
});

test('Micron sale correction changes historical P/L by 1778 EUR, leaves holdings and endpoint XIRR unchanged', () => {
  const price = normalizeTradeRepublicTrade(sale).net_unit_price_eur;
  const doc = { symbol: 'MTE.DE', current_price: 840, purchase_lots: [
    { quantity: 1, cost_price: 1000 / 1.011031, purchase_date: '2026-07-01', is_closed: true, closing_date: '2026-07-02', closing_price: -889 },
    { quantity: 1.8, cost_price: 485.65 / 1.8, purchase_date: '2026-01-05', is_closed: false },
  ] };
  const corrected = { ...doc, purchase_lots: doc.purchase_lots.map((lot) => lot.is_closed ? { ...lot, closing_price: price } : { ...lot }) };
  const before = valuePosition(doc, [], (v) => v, '2026-10-14');
  const after = valuePosition(corrected, [], (v) => v, '2026-10-14');
  close(after.realized_pl, -100.089355321449);
  close(after.realized_pl - before.realized_pl, 1778); close(after.total_pl - before.total_pl, 1778);
  close(after.market_value, before.market_value); close(after.open_cost, before.open_cost);
  const evidence = { scope_complete: true, transfers_reviewed: true, flow_history_complete: true,
    opening_cash_eur: 1000, current_cash_eur: 296.28, current_cash_date: '2026-10-14', dated_movements: [] };
  const calculate = (position) => {
    const quotes = { 'MTE.DE': { current: 840, currency: 'EUR', quote_date: '2026-10-14' } };
    return calculatePersonalPerformance(evidence,
      reconstructSecurities([position], quotes, {}, [], '2025-12-31', true),
      reconstructSecurities([position], quotes, {}, [], '2026-10-14'), '2026-10-14');
  };
  assert.deepEqual(calculate(doc), calculate(corrected));
});
