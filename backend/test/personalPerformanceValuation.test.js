import test from 'node:test';
import assert from 'node:assert/strict';
import { parisDate, reconstructSecurities } from '../src/personalPerformanceValuation.js';

test('opening holdings include purchases subsequently sold and use historical EUR FX', () => {
  const docs = [{ symbol: 'USD', purchase_lots: [
    { quantity: 2, purchase_date: '2025-05-01', is_closed: true, closing_date: '2026-02-01' },
    { quantity: 3, purchase_date: '2026-02-01', is_closed: false },
    { quantity: 4, purchase_date: '2025-01-01', is_closed: true, closing_date: '2025-11-01' },
  ] }];
  const result = reconstructSecurities(docs, { USD: { currency: 'USD' } },
    { USD: [{ date: '2025-12-31', close: 120 }] }, [{ date: '2025-12-31', rates: { USD: 1.2 } }], '2025-12-31', true);
  assert.equal(result.known_value_eur, 200); assert.equal(result.complete, true);
});

test('year-end Xetra holiday applies only to German listings, not fund NAVs', () => {
  const docs = ['URNU.DE', 'FUND.F'].map((symbol) => ({ symbol, quantity: 2, purchase_date: '2025-01-01' }));
  const result = reconstructSecurities(docs, { 'URNU.DE': { currency: 'EUR' }, 'FUND.F': { currency: 'EUR' } },
    { 'URNU.DE': [{ date: '2025-12-30', close: 20 }], 'FUND.F': [{ date: '2025-12-30', close: 100 }] }, [], '2025-12-31', true);
  assert.equal(result.known_value_eur, 40); assert.equal(result.complete, false);
  assert.deepEqual(result.missing_symbols, ['FUND.F']);
});

test('missing purchase dates, unknown FX and undated current quotes prevent complete valuation', () => {
  for (const [doc, quote] of [
    [{ symbol: 'X', quantity: 2 }, { current: 10, currency: 'EUR', quote_date: '2026-10-14' }],
    [{ symbol: 'X', quantity: 2, purchase_date: '2025-01-01' }, { current: 10, currency: null, quote_date: '2026-10-14' }],
    [{ symbol: 'X', quantity: 2, purchase_date: '2025-01-01' }, { current: 10, currency: 'EUR' }],
  ]) {
    const result = reconstructSecurities([doc], { X: quote }, {}, [], '2026-10-14');
    assert.equal(result.complete, false); assert.deepEqual(result.missing_symbols, ['X']);
  }
});

test('Paris valuation date changes at Paris midnight, not host midnight', () => {
  assert.equal(parisDate(new Date('2026-10-14T22:30:00Z')), '2026-10-15');
});
