import test from 'node:test';
import assert from 'node:assert/strict';
// Import calculation code without connecting to any database or calling providers.
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/unused_test';
const { buildMonthlyReportFromData, buildMonthlyReportList } = await import('../src/monthlyReportService.js');
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
  assert.equal(report.calculation_version, 3);
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

test('one unavailable security retains matched partial totals and its missing-data reason', () => {
  const missing = { _id: 'urnu', symbol: 'URNU.DE', tags: ['t'], quantity: 10, cost_price: 20, purchase_date: '2026-01-01' };
  const report = buildMonthlyReportFromData('2026-06', [...docs, missing], names, histories, []);
  assert.equal(report.summary.performance_value, null);
  assert.equal(report.summary.coverage.performance_value, 310);
  assert.equal(report.summary.coverage.start_value, 2090);
  assert.equal(report.summary.coverage.performance_pct, 310 / 2090 * 100);
  assert.equal(report.tags[0].incomplete, true);
  assert.equal(report.tags[0].coverage.performance_value, 310);
  assert.equal(report.skipped_positions.find((row) => row.symbol === 'URNU.DE').incomplete, true);
});
test('partial position contributes its known purchases to the partial report', () => {
  const bad = structuredClone(docs); bad[0].purchase_lots[1].purchase_date = null;
  const report = buildMonthlyReportFromData('2026-06', bad, names, histories, []);
  assert.equal(report.positions[0].coverage.performance_value, 300);
  assert.equal(report.summary.coverage.performance_value, 300);
  assert.equal(report.summary.coverage.start_value, 1500);
});
test('month catalogue includes missing months without generating and hides stale figures', () => {
  const rows = [{ month: '2026-06', calculation_version: 3, stale: true, summary: { performance_value: 999 } }];
  const result = buildMonthlyReportList(rows, { referenceDate: new Date('2026-09-07T12:00:00Z') });
  assert.equal(result.reports.length, 8);
  assert.equal(result.reports[0].month, '2026-08');
  assert.equal(result.reports[0].needs_generation, true);
  assert.equal(result.reports.find((r) => r.month === '2026-06').performance_value, null);
  assert.equal(buildMonthlyReportList([], { ensureYearToDate: false, referenceDate: new Date('2026-09-07') }).reports.length, 0);
});
test('January catalogue offers the last completed December even with no saved reports', () => {
  const result = buildMonthlyReportList([], { referenceDate: new Date('2027-01-02') });
  assert.equal(result.reports[0].month, '2026-12');
});
