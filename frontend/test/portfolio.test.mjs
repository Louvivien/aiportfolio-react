import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../node_modules/typescript/lib/typescript.js';
import { valuePosition } from '../../backend/src/finance.js';
import { currencyConverter } from '../../backend/src/fxService.js';
const source = await fs.readFile(new URL('../src/utils/portfolio.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { buildPortfolioView, visibleTagSummaries } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const valued = (position, convert = (v) => v) => ({ ...position,
  valuation: valuePosition(position, [], convert, '2026-09-07'),
  native_valuation: valuePosition(position, [], (v) => v, '2026-09-07'),
});

test('dashboard sums EUR valuations, not native currency prices', () => {
  const eur = valued({ symbol: 'EUR', currency: 'EUR', tags: [], quantity: 1, cost_price: 1000, current_price: 1000, purchase_date: '2026-09-04' });
  const usd = valued({ symbol: 'USD', currency: 'USD', tags: [], quantity: 10, cost_price: 116.22, current_price: 116.22, purchase_date: '2026-09-04' }, currencyConverter([{ date: '2026-09-04', rates: { USD: 1.1622 } }], 'USD'));
  const view = buildPortfolioView([eur, usd]);
  assert.equal(view.totals.totalMarketValueOpen, 2000);
  assert.equal(view.rows[1].effectivePrice, 116.22);
});
test('global P/L ratio includes closed cost basis and realized losses within open positions', () => {
  const position = valued({ symbol: 'TEST', currency: 'EUR', tags: [], current_price: 120, purchase_lots: [
    { quantity: 1, cost_price: 100, purchase_date: '2026-09-04' },
    { quantity: 1, cost_price: 200, purchase_date: '2026-09-04', is_closed: true, closing_price: 150, closing_date: '2026-09-04' },
  ] });
  const { totals, rows } = buildPortfolioView([position]);
  assert.equal(totals.realizedPlClosed, -50);
  assert.equal(totals.plVsInvestAll, -30);
  assert.equal(totals.plPctVsInvestAll, -10);
  assert.equal(rows[0].quantity, 1);
  assert.equal(rows[0].pnlValue, 20);
});
test('fully closed portfolio retains valid all-time P/L percentage', () => {
  const position = valued({ symbol: 'CLOSED', currency: 'EUR', tags: [], quantity: 1, cost_price: 100, purchase_date: '2026-09-04', is_closed: true, closing_price: 90, closing_date: '2026-09-04' });
  const { totals } = buildPortfolioView([position]);
  assert.equal(totals.totalMarketValueOpen, 0);
  assert.equal(totals.plPctVsInvestAll, -10);
});
test('missing FX or incomplete history remains unavailable through frontend aggregation', () => {
  const p = valued({ symbol: 'UNKNOWN', currency: 'USD', tags: [], quantity: 1, cost_price: 100, current_price: 110, purchase_date: '2025-01-01' }, () => null);
  const { totals } = buildPortfolioView([p]);
  assert.equal(totals.totalMarketValueOpen, null);
  assert.equal(totals.oneYearAbsolute, null);
  assert.equal(totals.oneYearPctTotal, null);
});

test('dashboard shows a labelled partial subtotal instead of blanking all known gains', () => {
  const known = valued({ symbol: 'KNOWN', currency: 'EUR', tags: [], quantity: 1, cost_price: 100, current_price: 120, purchase_date: '2026-09-04' });
  const unknown = valued({ symbol: 'UNDATED', currency: 'USD', tags: [], quantity: 1, cost_price: 1000, is_closed: true, closing_price: 900 }, () => null);
  const { totals } = buildPortfolioView([known, unknown]);
  assert.equal(totals.plVsInvestAll, 20);
  assert.equal(totals.plPctVsInvestAll, 20); // Excluded cost must not dilute the denominator.
  assert.equal(totals.coverage.total_pl.missingLots, 1);
  assert.ok(totals.coverage.total_pl.issues.some((issue) => issue.startsWith('UNDATED:')));
  assert.equal(totals.oneYearAbsolute, 20);
  assert.equal(totals.oneYearPctTotal, 20);
  assert.equal(totals.coverage.one_year.missingLots, 1);
});
test('legacy API data without coverage still shows known values with a partial label', () => {
  const known = valued({ symbol: 'KNOWN', currency: 'EUR', tags: [], quantity: 1, cost_price: 100, current_price: 120, purchase_date: '2026-09-04' });
  delete known.valuation.coverage;
  const { totals } = buildPortfolioView([known, { symbol: 'MISSING', tags: [] }]);
  assert.equal(totals.plVsInvestAll, 20);
  assert.equal(totals.coverage.total_pl.missingLots, 1);
});
test('tag summary excludes empty, zero and non-finite values but retains small positive holdings', () => {
  const rows = [null, 0, NaN, Infinity, -1, 0.001, 250].map((value, i) => ({ tag: String(i), total_market_value: value }));
  assert.deepEqual(visibleTagSummaries(rows).map((row) => row.total_market_value), [0.001, 250]);
});
