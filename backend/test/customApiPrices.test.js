import test from 'node:test';
import assert from 'node:assert/strict';
import { computePriceEntryFromDailySeries } from '../src/customApiService.js';

const today = new Date().setUTCHours(0, 0, 0, 0);
test('custom quote uses the last observation before today, not the first price today', () => {
  const quote = computePriceEntryFromDailySeries([
    { ts: today - 86400000, value: 100 }, { ts: today + 3600000, value: 110 },
  ], { intradayPoints: [
    { ts: today - 1000, value: 105 }, { ts: today + 1000, value: 108 }, { ts: today + 3600000, value: 110 },
  ] });
  assert.equal(quote.previous_close, 105);
  assert.equal(quote.change, 5);
});
test('custom quote cannot fabricate a previous close from prices recorded only today', () => {
  const quote = computePriceEntryFromDailySeries([], { intradayPoints: [
    { ts: today + 1000, value: 100 }, { ts: today + 3600000, value: 110 },
  ] });
  assert.equal(quote.previous_close, null);
  assert.equal(quote.change_pct, null);
});
test('custom quote with no observation today keeps daily change unavailable', () => {
  const quote = computePriceEntryFromDailySeries([
    { ts: today - 2 * 86400000, value: 100 }, { ts: today - 86400000, value: 110 },
  ]);
  assert.equal(quote.previous_close, null);
  assert.equal(quote.change_pct, null);
});
