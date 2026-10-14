import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePersonalPerformance, elapsedDays, solveXirr } from '../src/personalPerformance.js';

const snapshot = (value) => ({ known_value_eur: value, complete: true, missing_symbols: [], position_count: 1 });
const evidence = (events = []) => ({ scope_complete: true, flow_history_complete: true, transfers_reviewed: true,
  opening_cash_eur: 0, current_cash_eur: 0, current_cash_date: '2026-10-14', dated_movements: events });
const movement = (id, direction, amount, date = '2026-07-01') => ({ id, direction, amount_cents: Math.round(amount * 100), date,
  currency: 'EUR', external_to_combined_scope: true, date_confirmed: true });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test('headline is effective YTD return, not the annualized XIRR', () => {
  const result = calculatePersonalPerformance(evidence(), snapshot(1000), snapshot(1100), '2026-10-14');
  assert.equal(result.status, 'complete'); close(result.net_gain_eur, 100); close(result.effective_return_pct, 10);
  close(result.annualized_xirr, 1.1 ** (365 / elapsedDays('2026-01-01', '2026-10-14')) - 1);
  assert.ok(result.annualized_xirr > 0.1);
});

test('dated deposits and withdrawals recover a known rate, with an independent EUR gain', () => {
  const flows = [movement('deposit', 'deposit', 500), movement('withdraw', 'withdrawal', 200, '2026-08-01')];
  const grow = (amount, date) => amount * 1.12 ** (elapsedDays(date, '2026-10-14') / 365);
  const final = grow(1000, '2026-01-01') + grow(500, '2026-07-01') - grow(200, '2026-08-01');
  const result = calculatePersonalPerformance(evidence(flows), snapshot(1000), snapshot(final), '2026-10-14');
  close(result.annualized_xirr, 0.12); close(result.net_gain_eur, final - 1300);
  assert.notEqual(result.net_gain_eur, result.effective_return_pct * 10);
});

test('cash is included, promotion is neutralized, and income is not counted twice', () => {
  const input = evidence([movement('promo', 'promotion', 101, '2026-01-05'),
    movement('dividend', 'dividend', 2.23), movement('interest', 'interest', 0.48)]);
  input.opening_cash_eur = 200; input.current_cash_eur = 303.71;
  const result = calculatePersonalPerformance(input, snapshot(800), snapshot(800), '2026-10-14');
  close(result.net_gain_eur, 2.71); assert.equal(result.flows.promotions_eur, 101);
  assert.equal(result.flows.movements.length, 1);
  input.current_cash_eur = 301;
  const neutral = calculatePersonalPerformance(input, snapshot(800), snapshot(800), '2026-10-14');
  close(neutral.effective_return_pct, 0); close(neutral.net_gain_eur, 0);
});

test('trades and matched internal transfers do not enter external cash flows', () => {
  const input = evidence([movement('buy', 'buy', 500), movement('sell', 'sell', 600),
    { ...movement('transfer-out', 'withdrawal', 700), external_to_combined_scope: false },
    { ...movement('transfer-in', 'deposit', 700), external_to_combined_scope: false }]);
  const result = calculatePersonalPerformance(input, snapshot(1000), snapshot(1100), '2026-10-14');
  close(result.effective_return_pct, 10); assert.equal(result.flows.movements.length, 0);
});

test('missing cash, provisional credit dates and incomplete histories suppress definitive results', () => {
  for (const override of [{ opening_cash_eur: null }, { current_cash_eur: null }, { current_cash_date: '2026-10-13' },
    { flow_history_complete: false }, { transfers_reviewed: false }, { scope_complete: false },
    { dated_movements: [{ ...movement('pea', 'deposit', 320), date_confirmed: false }] }]) {
    const result = calculatePersonalPerformance({ ...evidence(), ...override }, snapshot(1000), snapshot(1100), '2026-10-14');
    assert.equal(result.status, 'incomplete'); assert.equal(result.effective_return_pct, null); assert.equal(result.net_gain_eur, null);
    assert.ok(result.missing.length);
  }
  const result = calculatePersonalPerformance(evidence(), { ...snapshot(1000), complete: false, missing_symbols: ['FUND'] }, snapshot(1100), '2026-10-14');
  assert.equal(result.status, 'incomplete'); assert.match(result.missing.join(' '), /FUND/);
  assert.equal(result.indicative, null);
});

test('unconfirmed currencies, duplicate IDs and invalid dates cannot yield a return', () => {
  for (const events of [[movement('same', 'deposit', 500), movement('same', 'deposit', 500)],
    [{ ...movement('fx', 'deposit', 500), currency: 'USD' }],
    [{ ...movement('date', 'deposit', 500), date: '2026-02-30' }],
    [{ ...movement('transfer', 'deposit', 500), external_to_combined_scope: null }]]) {
    const result = calculatePersonalPerformance(evidence(events), snapshot(1000), snapshot(1500), '2026-10-14');
    assert.equal(result.status, 'incomplete'); assert.equal(result.effective_return_pct, null);
    assert.equal(result.indicative, null);
  }
});

test('same-day flows are grouped and future movements are excluded', () => {
  close(solveXirr([{ date: '2026-01-01', amount: -1000 }, { date: '2026-01-01', amount: -500 },
    { date: '2027-01-01', amount: 1650 }]), 0.1);
  const result = calculatePersonalPerformance(evidence([movement('future', 'deposit', 1000, '2026-12-01')]), snapshot(1000), snapshot(1100), '2026-10-14');
  close(result.effective_return_pct, 10); assert.equal(result.flows.personal_deposits_eur, 0);
});

test('nonconventional flows are flagged rather than selecting an arbitrary IRR', () => {
  assert.throws(() => solveXirr([{ date: '2026-01-01', amount: -100 }, { date: '2026-02-01', amount: 230 },
    { date: '2026-03-01', amount: -200 }, { date: '2026-10-14', amount: 90 }]), /plusieurs solutions/);
});


test('provisional coverage and transfer dates yield an explicit indicative result without confirming evidence', () => {
  const input = { ...evidence([{ ...movement('pea', 'deposit', 320), date_confirmed: false }]),
    flow_history_complete: false, transfers_reviewed: false, scope_complete: false };
  const original = structuredClone(input);
  const provisional = calculatePersonalPerformance(input, snapshot(1000), snapshot(1500), '2026-10-14');
  const confirmed = calculatePersonalPerformance(evidence([movement('pea', 'deposit', 320)]), snapshot(1000), snapshot(1500), '2026-10-14');
  assert.equal(provisional.status, 'incomplete');
  assert.equal(provisional.effective_return_pct, null);
  assert.equal(provisional.net_gain_eur, null);
  close(provisional.indicative.effective_return_pct, confirmed.effective_return_pct);
  close(provisional.indicative.net_gain_eur, 180);
  assert.deepEqual(provisional.indicative.assumptions, provisional.missing);
  assert.deepEqual(input, original);
});

test('missing numerical inputs block indicative calculations as well', () => {
  for (const override of [{ opening_cash_eur: null }, { current_cash_eur: null },
    { current_cash_date: '2026-10-13' }, { dated_movements: null }]) {
    const result = calculatePersonalPerformance({ ...evidence(), flow_history_complete: false, ...override },
      snapshot(1000), snapshot(1100), '2026-10-14');
    assert.equal(result.indicative, null);
    assert.equal(result.effective_return_pct, null);
  }
});
