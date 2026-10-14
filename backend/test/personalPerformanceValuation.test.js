import test from 'node:test';
import assert from 'node:assert/strict';
import { parisDate, performancePositions, reconstructSecurities } from '../src/personalPerformanceValuation.js';

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

test('saved dated opening prices survive provider outages without freezing quantities', () => {
  const doc = { symbol: 'URNU.DE', quantity: 3, purchase_date: '2025-01-01' };
  const saved = [{ symbol: 'URNU.DE', valuation_date: '2025-12-31', price_date: '2025-12-30', close: 20, currency: 'EUR' }];
  const result = reconstructSecurities([doc], {}, {}, [], '2025-12-31', true, saved);
  assert.equal(result.complete, true); assert.equal(result.known_value_eur, 60);
  const wrongDate = reconstructSecurities([doc], {}, {}, [], '2025-12-31', true, [{ ...saved[0], price_date: '2025-12-29' }]);
  assert.equal(wrongDate.complete, false);
  const current = reconstructSecurities([doc], {}, {}, [], '2026-10-14', false, saved);
  assert.equal(current.complete, false); // An old saved price never replaces a live quote.
});

test('an unreconciled aggregate cannot certify opening inventory, but keeps current holdings', () => {
  const doc = { symbol: 'PARRO.PA', quantity: 261, purchase_date: '2024-11-28',
    reconciliation: { opening_inventory_status: 'unverified' } };
  const quotes = [{ symbol: 'PARRO.PA', valuation_date: '2025-12-31', price_date: '2025-12-31', close: 7.4, currency: 'EUR' }];
  const opening = reconstructSecurities([doc], {}, {}, [], '2025-12-31', true, quotes);
  assert.equal(opening.complete, false);
  assert.equal(opening.known_value_eur, 0);
  assert.deepEqual(opening.missing_symbols, ['PARRO.PA']);
  const current = reconstructSecurities([doc], { 'PARRO.PA': { current: 5, currency: 'EUR', quote_date: '2026-10-14' } }, {}, [], '2026-10-14');
  assert.equal(current.complete, true);
  assert.equal(current.known_value_eur, 1305);
});

test('confirmed opening inventory replaces only the boundary quantity without changing current holdings or legacy lots', () => {
  const docs = [{ _id: 'parrot', symbol: 'PARRO.PA', quantity: 261, purchase_date: '2024-11-28',
    reconciliation: { opening_inventory_status: 'unverified' } },
  { _id: 'fund', symbol: 'H2O', quantity: 2.23, purchase_date: '2025-12-31', is_closed: true, closing_date: '2026-03-23',
    reconciliation: { opening_inventory_status: 'unverified' } }];
  const before = structuredClone(docs);
  const quotes = [{ symbol: 'PARRO.PA', valuation_date: '2025-12-31', price_date: '2025-12-31', close: 7.4, currency: 'EUR' },
    { symbol: 'H2O', valuation_date: '2025-12-31', price_date: '2025-12-31', close: 361.98, currency: 'EUR' }];
  const inventory = [{ position_id: 'parrot', symbol: 'PARRO.PA', date: '2025-12-31', quantity: 251, status: 'user_confirmed' },
    { position_id: 'fund', symbol: 'H2O', date: '2025-12-31', quantity: 1.38, status: 'user_confirmed' }];
  const opening = reconstructSecurities(docs, {}, {}, [], '2025-12-31', true, quotes, inventory);
  assert.equal(opening.complete, true);
  assert.equal(opening.known_value_eur, 251 * 7.4 + 1.38 * 361.98);
  const current = reconstructSecurities(docs, { 'PARRO.PA': { current: 5, currency: 'EUR', quote_date: '2026-10-14' } }, {}, [], '2026-10-14', false, quotes, inventory);
  assert.equal(current.known_value_eur, 261 * 5);
  assert.deepEqual(docs, before);
  for (const invalid of [[{ ...inventory[0], quantity: null }], [inventory[0], inventory[0]], [{ ...inventory[0], position_id: 'missing' }]]) {
    assert.equal(reconstructSecurities(docs, {}, {}, [], '2025-12-31', true, quotes, invalid).complete, false);
  }
});

test('performance excludes configured symbols but uses all NVIDIA shares and live FX without modifying the main portfolio', () => {
  const docs = [{ _id: 'nvda', symbol: 'NVDA', quantity: 10.436, purchase_date: '2024-06-10' },
    { _id: 'soxl', symbol: 'SOXL', quantity: 1, purchase_date: '2025-01-01' }];
  const scoped = performancePositions(docs, { performance_scope: { excluded_symbols: ['SOXL'] } });
  const fx = [{ date: '2026-10-14', rates: { USD: 1.1 } }, { date: '2025-12-31', rates: { USD: 1.2 } }];
  const opening = reconstructSecurities(scoped, {}, {}, fx, '2025-12-31', true,
    [{ symbol: 'NVDA', valuation_date: '2025-12-31', price_date: '2025-12-31', close: 120, currency: 'USD' }]);
  assert.ok(Math.abs(opening.known_value_eur - 1043.6) < 1e-8);
  const value = (price) => reconstructSecurities(scoped, { NVDA: { current: price, currency: 'USD', quote_date: '2026-10-14' } }, {}, fx, '2026-10-14');
  assert.ok(Math.abs(value(220).known_value_eur - 2087.2) < 1e-8);
  assert.ok(Math.abs(value(221.1).known_value_eur - value(220).known_value_eur - 10.436) < 1e-8);
  assert.equal(docs.length, 2); assert.equal(docs[0].quantity, 10.436);
});
