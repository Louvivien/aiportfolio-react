import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePersonalPerformance, elapsedDays } from '../src/personalPerformance.js';
import { reconstructSecurities } from '../src/personalPerformanceValuation.js';
import { positionsFingerprint, newAnnualInput, validateAnnualInputPatch, rolloverState } from '../src/annualPerformance.js';
const snap = (value) => ({ complete: true, known_value_eur: value, missing_symbols: [], position_count: 1 });
const input = (year) => ({ ...newAnnualInput({ excluded_symbols: ['SOXL'] }), opening_cash_eur: 100,
  current_cash_eur: 100, current_cash_date: `${year}-10-14`, scope_complete: true, flow_history_complete: true, transfers_reviewed: true });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('annual engine works in 2027 and leap years; dates are actual/365', () => {
  for (const year of [2026, 2027, 2028]) {
    const i = input(year), date = i.current_cash_date;
    const report = calculatePersonalPerformance(i, snap(900), snap(1100), date, year);
    close(report.net_gain_eur, 200); close(report.effective_return_pct, 20);
    close(report.annualized_xirr, 1.2 ** (365 / elapsedDays(`${year}-01-01`, date)) - 1);
    assert.equal(report.label, `Performance ${year}`);
    assert.equal(report.opening_valuation_date, `${year - 1}-12-31`);
  }
  assert.throws(() => calculatePersonalPerformance(input(2027), snap(900), snap(1000), '2026-10-14', 2027));
});

test('a frozen close becomes exactly the next opening without carrying cash or flows forward as current', () => {
  const state = { _id: 2026, revision: 4, input: input(2026) };
  const snapshot = { ...snap(1200), date: '2026-12-31', cash_eur: 76.23, total_eur: 1276.23, positions: [{ symbol: 'NVDA', quantity: 10.436 }] };
  const next = rolloverState(state, snapshot, null, false, '2027-01-02');
  assert.deepEqual(next.opening_snapshot, snapshot); assert.equal(next.input.opening_cash_eur, 76.23);
  assert.equal(next.input.current_cash_eur, null); assert.deepEqual(next.input.dated_movements, []);
  assert.deepEqual(next.input.performance_scope.excluded_symbols, ['SOXL']);
  snapshot.positions[0].quantity = 0;
  assert.equal(next.opening_snapshot.positions[0].quantity, 10.436);
  assert.throws(() => rolloverState(state, snapshot, next, false, '2027-01-03'), /explicitement/);
  const changed = rolloverState(state, snapshot, next, true, '2027-01-03');
  assert.equal(changed.revision, next.revision + 1);
  assert.throws(() => rolloverState(state, snapshot, { ...next, closing_snapshot: snapshot }, true, '2028-01-01'), /déjà clôturée/);
});

test('cash reviews react to financial edits, not price refreshes or metadata; deleted holdings are detected', () => {
  const docs = [{ _id: 'one', symbol: 'NVDA', quantity: 10.436, cost_price: 30, purchase_date: '2024-01-01' }];
  const original = positionsFingerprint(docs);
  assert.equal(positionsFingerprint([{ ...docs[0], current_price: 300, updated_at: new Date(), display_name: 'Nvidia' }]), original);
  assert.notEqual(positionsFingerprint([{ ...docs[0], quantity: 10 }]), original);
  assert.notEqual(positionsFingerprint([]), original);
});

test('input validation preserves cents and requires explicit dates, signs and transfer classification', () => {
  const flow = { id: 'tr:one', date: '2027-02-01', direction: 'deposit', amount_cents: 10000, currency: 'EUR', date_confirmed: true, external_to_combined_scope: true };
  const validate = (patch) => validateAnnualInputPatch(2027, patch, '2027-10-14');
  assert.equal(validate({ current_cash_eur: 296.28, current_cash_date: '2027-10-14' }).current_cash_eur, 296.28);
  assert.equal(validate({ opening_cash_eur: 0 }).opening_cash_eur, 0);
  for (const patch of [{ current_cash_eur: null }, { current_cash_eur: -1, current_cash_date: '2027-10-14' }, { current_cash_eur: .001, current_cash_date: '2027-10-14' },
    { current_cash_eur: 0, current_cash_date: '2027-02-30' }, { current_cash_eur: 0, current_cash_date: '2027-12-31' },
    { opening_cash_eur: '' }, { performance_scope: {} }, { scope_complete: 'true' },
    { dated_movements: [flow, flow] }, { dated_movements: [{ ...flow, currency: 'USD' }] }, { dated_movements: [{ ...flow, amount_cents: -100 }] },
    { dated_movements: [{ ...flow, direction: 'buy' }] }, { dated_movements: [{ ...flow, date: '2026-12-31' }] }]) assert.throws(() => validate(patch));
  const internal = validate({ dated_movements: [{ ...flow, external_to_combined_scope: false }] });
  const result = calculatePersonalPerformance({ ...input(2027), ...internal }, snap(900), snap(900), '2027-10-14', 2027);
  close(result.net_gain_eur, 0); close(result.effective_return_pct, 0);
});

test('a year-end snapshot retains dated earlier prices and historical FX, never later prices', () => {
  const docs = [{ _id: 'n', symbol: 'NVDA', quantity: 10, purchase_date: '2026-01-02' }];
  const history = { NVDA: [{ date: '2026-12-30', close: 120 }, { date: '2027-01-02', close: 999 }] };
  const fx = [{ date: '2027-01-02', rates: { USD: 1 } }, { date: '2026-12-30', rates: { USD: 1.2 } }];
  const result = reconstructSecurities(docs, { NVDA: { currency: 'USD' } }, history, fx, '2026-12-31', true, [], [], { details: true, allowPreviousQuote: true });
  assert.equal(result.complete, true); close(result.known_value_eur, 1000);
  assert.equal(result.positions[0].price_date, '2026-12-30'); assert.equal(result.positions[0].fx.date, '2026-12-30');
  assert.equal(reconstructSecurities(docs, { NVDA: { currency: 'USD' } }, { NVDA: [{ date: '2026-12-01', close: 120 }] }, fx, '2026-12-31', true, [], [], { allowPreviousQuote: true }).complete, false);
});

test('initial day and non-conventional XIRR cases never display a fabricated percentage', () => {
  const result = calculatePersonalPerformance({ ...input(2027), current_cash_date: '2027-01-01' }, snap(900), snap(900), '2027-01-01', 2027);
  assert.equal(result.status, 'unavailable'); assert.equal(result.effective_return_pct, null);
  assert.equal(result.net_gain_eur, 0);
});
