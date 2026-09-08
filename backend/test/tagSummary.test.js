import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTagSummary } from '../src/tagSummaryService.js';
import { valuePosition } from '../src/finance.js';

const today = '2026-09-08';
const valued = (extra) => {
  const position = { symbol: 'EUROPE', tags: ['AI'], quantity: 10, cost_price: 80, purchase_date: '2026-01-01',
    current_price: 102, previous_close: 100, quote_date: today, ...extra };
  return { ...position, valuation: valuePosition(position, [], (value) => value, today) };
};

test('US market closed does not blank the daily return of the AI tag or dilute its denominator', () => {
  const europe = valued({});
  const us = valued({ symbol: 'NVDA', quote_date: '2026-09-04', current_price: 1000, previous_close: 990 });
  const [tag] = buildTagSummary([europe, us], today);
  assert.equal(tag.intraday_change_pct, 2);
  assert.equal(tag.coverage.intraday.value, 20);
  assert.equal(tag.coverage.intraday.basis, 1000);
  assert.equal(tag.coverage.intraday.missing_lots, 1);
  assert.match(tag.coverage.intraday.issues.join(' '), /NVDA/);
  assert.equal(tag.total_market_value, 11020); // Market value stays known for both.
  assert.equal(tag.coverage.market_value.missing_lots, 0);
});

test('tag percentage is weighted by the included basis and includes negative and zero gains', () => {
  const [tag] = buildTagSummary([valued({}), valued({ quantity: 20, current_price: 99 }),
    valued({ quantity: 5, current_price: 100 })], today);
  assert.equal(tag.intraday_change_pct, 0);
  assert.equal(tag.coverage.intraday.basis, 3500);
  assert.equal(tag.coverage.intraday.missing_lots, 0);
});

test('partial data inside one position preserves the calculable purchases in every period', () => {
  const position = valued({ purchase_lots: [
    { quantity: 10, cost_price: 100, purchase_date: today },
    { quantity: 10, cost_price: 100, purchase_date: null },
  ] });
  const [tag] = buildTagSummary([position], today);
  for (const key of ['intraday', 'ten_day', 'one_year']) {
    assert.equal(tag.coverage[key].value, 20);
    assert.equal(tag.coverage[key].basis, 1000);
    assert.equal(tag.coverage[key].missing_lots, 1);
  }
  assert.equal(tag.change_10d_pct, 2);
  assert.equal(tag.change_1y_pct, 2);
});

test('missing prices preserve available market values and P/L; all-missing performance stays unavailable', () => {
  const [tag] = buildTagSummary([valued({}), valued({ symbol: 'MISSING', current_price: null })], today);
  assert.equal(tag.total_market_value, 1020);
  assert.equal(tag.total_unrealized_pl, 220);
  assert.equal(tag.coverage.market_value.missing_lots, 1);
  const [closedMarket] = buildTagSummary([valued({ quote_date: '2026-09-04' })], today);
  assert.equal(closedMarket.intraday_change_pct, null);
  assert.equal(closedMarket.coverage.intraday.value, null);
  assert.equal(buildTagSummary([valued({ current_price: null })], today).length, 0);
});

test('a fully closed position with no eligible daily contributions does not turn all missing data into zero', () => {
  const [tag] = buildTagSummary([valued({ quote_date: '2026-09-04' }),
    valued({ is_closed: true, closing_date: '2026-08-01', closing_price: 90 })], today);
  assert.equal(tag.intraday_change_pct, null);
  assert.equal(tag.coverage.intraday.value, null);
});
