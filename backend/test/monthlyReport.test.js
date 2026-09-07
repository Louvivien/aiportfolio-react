import test from 'node:test';
import assert from 'node:assert/strict';
// Import calculation code without connecting to any database or calling providers.
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/unused_test';
const { buildMonthlyReportFromData } = await import('../src/monthlyReportService.js');
const stockHistory = { EXA: [{ date: '2026-05-29', close: 100 }, { date: '2026-06-30', close: 120 }] };
const docs = [{ _id: 'exa', symbol: 'EXA', tags: ['t'], purchase_lots: [
  { id: 'first', quantity: 15, cost_price: 90, purchase_date: '2026-05-01' },
  { id: 'late', quantity: 5, cost_price: 118, purchase_date: '2026-06-30' },
  { id: 'future', quantity: 10, cost_price: 120, purchase_date: '2026-07-01' },
  { id: 'sold', quantity: 1, cost_price: 90, purchase_date: '2026-05-01', is_closed: true, closing_date: '2026-05-29', closing_price: 100 },
] }];
const histories = { stockHistory, stockPrices: { EXA: { currency: 'EUR' } }, apiHistory: {} };
const names = new Map([['t', 'Industry']]);
test('monthly report aggregates eligible lot contributions identically for position, tag and portfolio', () => {
  const report = buildMonthlyReportFromData('2026-06', docs, names, histories, []);
  for (const row of [report.summary, report.positions[0], report.tags[0]]) {
    assert.equal(row.start_value, 2090); assert.equal(row.end_value, 2400); assert.equal(row.performance_value, 310);
  }
  assert.equal(report.positions[0].quantity, 20);
  assert.equal(report.positions[0].start_basis, 'mixed');
  assert.equal(report.positions[0].lots[1].start_date, '2026-06-30');
  assert.equal(report.summary.lots_skipped, 2);
  assert.equal(report.calculation_version, 2);
});
test('missing lot data suppresses position, tag and total values rather than reporting a partial gain', () => {
  const bad = structuredClone(docs); bad[0].purchase_lots[1].purchase_date = null;
  const report = buildMonthlyReportFromData('2026-06', bad, names, histories, []);
  assert.equal(report.summary.incomplete, true);
  for (const row of [report.summary, report.positions[0], report.tags[0]]) assert.equal(row.performance_value, null);
});
test('monthly mixed-currency totals convert each boundary with historical FX', () => {
  const usd = { _id: 'usd', symbol: 'USDSTOCK', tags: ['t'], quantity: 10, cost_price: 100, purchase_date: '2026-05-01' };
  const h = structuredClone(histories);
  h.stockPrices.USDSTOCK = { currency: 'USD' };
  h.stockHistory.USDSTOCK = [{ date: '2026-05-29', close: 110 }, { date: '2026-06-30', close: 120 }];
  const fx = [{ date: '2026-06-30', rates: { USD: 1.2 } }, { date: '2026-05-29', rates: { USD: 1.1 } }];
  const report = buildMonthlyReportFromData('2026-06', [...docs, usd], names, h, fx);
  assert.ok(Math.abs(report.summary.performance_value - 310) < 1e-8);
  assert.equal(report.positions.find((p) => p.symbol === 'USDSTOCK').currency, 'EUR');
});
