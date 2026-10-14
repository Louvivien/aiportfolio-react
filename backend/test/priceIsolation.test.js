import test from 'node:test';
import assert from 'node:assert/strict';
import yahooFinance from 'yahoo-finance2';
import { clearAllCaches, getPrices } from '../src/priceService.js';

const chart = (price) => new Response(JSON.stringify({ chart: { result: [{ meta: {
  regularMarketPrice: price, chartPreviousClose: price - 1,
  regularMarketTime: 1791982800, currency: 'EUR',
} }] } }));

test('an unknown ETF does not request a Yahoo quote session or break valid prices', async (t) => {
  clearAllCaches();
  const quote = t.mock.method(yahooFinance, 'quote', async () => { throw new Error('429'); });
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('/chart/DCAM?')) return new Response('{}', { status: 404 });
    if (url.includes('/chart/DCAM.PA?')) return chart(6.416);
    return new Response('{}');
  });
  const missing = await getPrices(['DCAM']);
  assert.equal(missing.DCAM.current, null);
  assert.equal(quote.mock.callCount(), 0);
  const valid = await getPrices(['DCAM.PA']);
  assert.equal(valid['DCAM.PA'].current, 6.416);
});

test('quote endpoint rate limiting does not suspend the chart endpoint for other holdings', async (t) => {
  clearAllCaches();
  const quote = t.mock.method(yahooFinance, 'quote', async () => { throw new Error('Too Many Requests 429'); });
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('/chart/FAILED?')) return new Response('{}', { status: 500 });
    if (url.includes('/chart/EXENS.PA?')) return chart(58.25);
    return new Response('{}');
  });
  await getPrices(['FAILED']);
  assert.equal(quote.mock.callCount(), 1);
  const prices = await getPrices(['EXENS.PA']);
  assert.equal(prices['EXENS.PA'].current, 58.25);
});

test('overlapping portfolio requests share one pending quote per symbol', async (t) => {
  clearAllCaches();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    await new Promise((resolve) => setImmediate(resolve));
    return chart(6.416);
  });
  const results = await Promise.all([
    getPrices(['DCAM.PA']), getPrices(['DCAM.PA']), getPrices(['DCAM.PA']),
  ]);
  assert.equal(calls, 1);
  for (const prices of results) assert.equal(prices['DCAM.PA'].current, 6.416);
});
