import test from 'node:test';
import assert from 'node:assert/strict';
import { selectHistoryForDates } from '../src/priceService.js';
const boundaries = ['2026-05-31', '2026-06-30'];
const complete = [{ date: '2026-05-29', close: 20 }, { date: '2026-06-30', close: 21 }];
test('nonempty history with a missing month must try the next provider', async () => {
  const result = await selectHistoryForDates([
    { provider: 'first', load: async () => [{ date: '2026-08-24', close: 24 }] },
    { provider: 'second', load: async () => complete },
  ], boundaries);
  assert.equal(result.provider, 'second');
  assert.deepEqual(result.points, complete);
});
test('failed and empty fallback providers retain the best available history', async () => {
  const result = await selectHistoryForDates([
    { provider: 'partial', load: async () => complete.slice(1) },
    { provider: 'failed', load: async () => { throw new Error('unavailable'); } },
    { provider: 'empty', load: async () => [] },
  ], boundaries);
  assert.equal(result.provider, 'partial');
  assert.deepEqual(result.points, complete.slice(1));
});

test('a missing weekday at a report boundary triggers another provider rather than using an older close', async () => {
  const result = await selectHistoryForDates([
    { provider: 'gap', load: async () => [{ date: '2026-08-28', close: 100 }] },
    { provider: 'complete', load: async () => [{ date: '2026-08-31', close: 110 }] },
  ], ['2026-08-31']);
  assert.equal(result.provider, 'complete');
});
