import test from 'node:test';
import assert from 'node:assert/strict';
import { number, positionLots, valuePosition, lotContribution, periodPerformance, holdingsAt, safePeRatio, sum } from '../src/finance.js';
import { parseEcbRates, exchangeRate, currencyConverter } from '../src/fxService.js';
const identity = (value) => value;
const june = { periodStart: '2026-06-01', periodEnd: '2026-06-30' };
const history = [{ date: '2026-05-29', close: 100 }, { date: '2026-06-01', close: 105 }, { date: '2026-06-30', close: 120 }];
const lot = (overrides = {}) => ({ quantity: 15, cost_price: 90, purchase_date: '2026-05-01', is_closed: false, ...overrides });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('missing numeric data stays missing, including sum propagation', () => {
  for (const input of [null, undefined, '', 'abc', Infinity]) assert.equal(number(input), null);
  assert.equal(number(0), 0);
  assert.equal(sum([100, null]), null);
});
test('ECB USD quote is divided by USD per EUR; weekends use prior reference date', () => {
  const days = parseEcbRates(`<Cube><Cube time='2026-09-04'><Cube currency='USD' rate='1.1622'/><Cube currency='GBP' rate='0.85'/></Cube></Cube>`);
  const rate = exchangeRate(days, 'USD', '2026-09-07');
  assert.equal(rate.date, '2026-09-04');
  close(currencyConverter(days, 'USD')(1162.2, '2026-09-07'), 1000);
  close(currencyConverter(days, 'GBp')(85, '2026-09-07'), 1);
  assert.equal(exchangeRate(days, 'USD', '2026-09-03'), null);
  assert.equal(exchangeRate(days, 'USD', '2026-09-20'), null);
  assert.equal(currencyConverter(days, null)(100, '2026-09-07'), null);
});
test('EUR valuation uses purchase FX for basis and valuation FX for market value', () => {
  const fx = [{ date: '2026-09-04', rates: { USD: 1.1622 } }, { date: '2026-06-01', rates: { USD: 1.1 } }];
  const result = valuePosition({ currency: 'USD', current_price: 116.22, purchase_lots: [lot({ quantity: 10, cost_price: 110, purchase_date: '2026-06-01' })] }, [], currencyConverter(fx, 'USD'), '2026-09-07');
  close(result.market_value, 1000); close(result.open_cost, 1000); close(result.unrealized_pl, 0);
});
test('closed lots in still-open Micron/ASML-style positions contribute all realized losses', () => {
  const docs = [
    { current_price: 120, purchase_lots: [lot({ quantity: 1 }), lot({ quantity: 2, cost_price: 150, is_closed: true, closing_price: 100, closing_date: '2026-06-15' })] },
    { current_price: 700, purchase_lots: [lot({ quantity: 1, cost_price: 600 }), lot({ quantity: 1, cost_price: 700, is_closed: true, closing_price: 595.3, closing_date: '2026-06-15' })] },
  ];
  const results = docs.map((doc) => valuePosition(doc, history, identity, '2026-06-30'));
  close(sum(results.map((r) => r.realized_pl)), -204.7);
  close(sum(results.map((r) => r.market_value)), 820);
});
test('June Exail: only the first 15 shares get full-month gain, five June-30 shares start at cost', () => {
  const lots = [lot(), lot({ quantity: 5, cost_price: 118, purchase_date: '2026-06-30' })];
  const result = periodPerformance(lots, history, june, identity);
  close(result.gain, 310); close(result.basis, 2090); close(result.percent, 310 / 2090 * 100);
});
test('month opens at previous month close, never first day close', () => {
  const result = lotContribution(lot(), history, june);
  assert.equal(result.start_price, 100);
  assert.equal(result.start_date, '2026-05-31');
});
test('future purchases and lots sold before the period are excluded', () => {
  const after = lotContribution(lot({ purchase_date: '2026-07-01' }), history, june);
  const before = lotContribution(lot({ is_closed: true, closing_date: '2026-05-30', closing_price: 90 }), history, june);
  assert.equal(after.skipped, true); assert.equal(after.incomplete, false);
  assert.equal(before.skipped, true); assert.equal(before.incomplete, false);
});
test('sales during the month use execution price; later closure keeps month-end holding', () => {
  const sold = lotContribution(lot({ is_closed: true, closing_date: '2026-06-15', closing_price: 110 }), history, june);
  close(sold.performance_value, 150);
  const later = lotContribution(lot({ is_closed: true, closing_date: '2026-07-15', closing_price: 140 }), history, june);
  close(later.performance_value, 300);
});
test('missing purchase/sale dates or prices cannot fabricate holding periods or proceeds', () => {
  for (const bad of [lot({ purchase_date: null }), lot({ is_closed: true, closing_date: null }), lot({ is_closed: true, closing_date: '2026-06-15', closing_price: null })]) {
    assert.equal(lotContribution(bad, history, june).incomplete, true);
    assert.equal(periodPerformance([lot(), bad], history, june, identity).gain, null);
  }
});
test('no look-ahead price or stale price is used for a boundary', () => {
  assert.equal(lotContribution(lot(), history.slice(1), june).incomplete, true);
  assert.equal(lotContribution(lot(), [{ date: '2026-04-01', close: 100 }, history[2]], june).incomplete, true);
});
test('recent lots use execution cost for one-year P/L instead of pre-purchase history', () => {
  const doc = { current_price: 120, purchase_lots: [lot({ quantity: 1, cost_price: 110, purchase_date: '2026-06-01' })] };
  const result = valuePosition(doc, [{ date: '2025-06-30', close: 10 }], identity, '2026-06-30');
  close(result.one_year.gain, 10); close(result.one_year.percent, 10 / 110 * 100);
});
test('today denominator is opening value; a purchase today begins at purchase price', () => {
  const doc = { current_price: 110, previous_close: 100, purchase_lots: [lot({ quantity: 1 }), lot({ quantity: 1, purchase_date: '2026-06-30', cost_price: 108 })] };
  const result = valuePosition(doc, [{ date: '2026-06-29', close: 100 }], identity, '2026-06-30');
  close(result.intraday.gain, 12); close(result.intraday.percent, 12 / 208 * 100);
});
test('missing current quotes suppress unrealized P/L; a recorded zero sale price is a real total loss', () => {
  const result = valuePosition({ current_price: null, purchase_lots: [lot()] }, history, identity, '2026-06-30');
  assert.equal(result.market_value, null); assert.equal(result.unrealized_pl, null);
  const closed = valuePosition({ purchase_lots: [lot({ is_closed: true, closing_price: 0, closing_date: '2026-06-01' })] }, history, identity, '2026-06-30');
  assert.equal(closed.realized_pl, -1350);
});

test('Soitec intraday uses the quoted previous close despite a missing session in history', () => {
  const doc = { current_price: 140.65, previous_close: 143.35,
    purchase_lots: [lot({ quantity: 9, cost_price: 117.2, purchase_date: '2026-07-27' })] };
  const incompleteHistory = [{ date: '2026-09-04', close: 128.3000030517578 }, { date: '2026-09-08', close: 140.65 }];
  const result = valuePosition(doc, incompleteHistory, identity, '2026-09-08');
  close(result.intraday.gain, -24.30);
  assert.equal(result.intraday.percent.toFixed(2), '-1.88');
  assert.equal(((140.65 / 128.3 - 1) * 100).toFixed(2), '9.63');
  assert.equal(result.intraday.coverage.missing_lots, 0);
});

test('intraday does not substitute historical prices when the quote previous close is unavailable', () => {
  for (const previous_close of [undefined, null, 0, -100]) {
    const result = valuePosition({ current_price: 110, previous_close, purchase_lots: [lot()] },
      [{ date: '2026-06-29', close: 100 }], identity, '2026-06-30');
    assert.equal(result.intraday.gain, null);
    assert.equal(result.intraday.percent, null);
    assert.equal(result.intraday.coverage.missing_lots, 1);
  }
  const missingCurrent = valuePosition({ current_price: null, previous_close: 100, purchase_lots: [lot()] },
    [{ date: '2026-06-30', close: 110 }], identity, '2026-06-30');
  assert.equal(missingCurrent.intraday.gain, null);
});

test('intraday reference preserves trade prices, closed lots and dated FX in portfolio totals', () => {
  const doc = { current_price: 110, previous_close: 100, purchase_lots: [
    lot({ quantity: 1 }),
    lot({ quantity: 1, purchase_date: '2026-06-30', cost_price: 108 }),
    lot({ quantity: 1, is_closed: true, closing_date: '2026-06-30', closing_price: 105 }),
    lot({ quantity: 1, is_closed: true, closing_date: '2026-06-29', closing_price: 50 }),
  ] };
  const convert = (value, date) => value / (date === '2026-06-30' ? 1.1 : 1);
  const result = valuePosition(doc, [], convert, '2026-06-30');
  close(result.intraday.basis, 200 + 108 / 1.1);
  close(result.intraday.gain, (110 + 110 + 105) / 1.1 - (200 + 108 / 1.1));
});
test('legacy whole-position closure applies to every remaining lot without double counting', () => {
  const doc = { is_closed: true, closing_date: '2026-06-15', closing_price: 100, purchase_lots: [lot({ quantity: 1 }), lot({ quantity: 1 })] };
  assert.ok(positionLots(doc).every((l) => l.is_closed));
  const result = valuePosition(doc, history, identity, '2026-06-30');
  assert.equal(result.market_value, 0); assert.equal(result.realized_pl, 20);
});
test('a multi-lot position does not lend its earliest purchase date to an undated lot', () => {
  const lots = positionLots({ purchase_date: '2026-01-01', purchase_lots: [lot(), lot({ purchase_date: null })] });
  assert.equal(lots[1].purchase_date, null);
});
test('history reconstructs past holdings, including since-closed lots and staggered buys', () => {
  const doc = { purchase_lots: [lot({ quantity: 15, is_closed: true, closing_price: 130, closing_date: '2026-07-01' }), lot({ quantity: 5, purchase_date: '2026-06-30', cost_price: 118 })] };
  assert.equal(holdingsAt(doc, history, '2026-06-01', identity).market_value, 1575);
  assert.equal(holdingsAt(doc, history, '2026-06-30', identity).market_value, 2400);
  assert.equal(holdingsAt(doc, history, '2026-07-01', identity).market_value, null);
  assert.equal(holdingsAt(doc, [...history, { date: '2026-07-01', close: 120 }], '2026-07-01', identity).market_value, 600);
});
test('P/E requires matching currency, symbol, positive latest EPS and verified share basis', () => {
  const snapshot = { symbol: 'HYN', epsDiluted: 10000, epsCurrency: 'KRW', epsShareBasis: 'listed_share' };
  assert.equal(safePeRatio(190, 'EUR', snapshot, 'HYN'), null);
  assert.equal(safePeRatio(190, 'EUR', { ...snapshot, epsCurrency: 'EUR', epsShareBasis: null }, 'HYN'), null);
  assert.equal(safePeRatio(190, 'EUR', { ...snapshot, epsCurrency: 'EUR', epsDiluted: -1, epsDilutedPositive: 10 }, 'HYN'), null);
  assert.equal(safePeRatio(190, 'EUR', { ...snapshot, epsCurrency: 'EUR', epsDiluted: 10 }, 'HYN'), 19);
});
test('an explicitly closed lot never borrows the aggregate date or price of a different sale', () => {
  const lots = positionLots({ is_closed: true, closing_date: '2026-08-31', closing_price: 100,
    purchase_lots: [lot({ is_closed: true, closing_date: null, closing_price: null }), lot({ is_closed: true, closing_date: '2026-08-31', closing_price: 100 })] });
  assert.equal(lots[0].closing_date, null);
  assert.equal(lots[0].closing_price, null);
});
test('one undated closed trade does not discard the calculable period subtotal', () => {
  const result = periodPerformance([lot(), lot({ is_closed: true, closing_date: null })], history, june, identity);
  assert.equal(result.gain, null); // Exact total is still unknown.
  assert.equal(result.coverage.value, 300);
  assert.equal(result.coverage.basis, 1500);
  assert.equal(result.coverage.included_lots, 1);
  assert.equal(result.coverage.missing_lots, 1);
  assert.deepEqual(result.coverage.issues, ['Missing closing date.']);
});
test('realized subtotal and its basis include only the same fully valued closed lots', () => {
  const doc = { current_price: 120, purchase_lots: [
    lot({ quantity: 1, cost_price: 100 }),
    lot({ quantity: 1, cost_price: 100, is_closed: true, closing_price: 80, closing_date: '2026-06-15' }),
    lot({ quantity: 1, cost_price: 200, is_closed: true, closing_price: 160, closing_date: null }),
  ] };
  const convert = (value, date) => date ? value : null;
  const result = valuePosition(doc, history, convert, '2026-06-30');
  assert.equal(result.realized_pl, null);
  assert.equal(result.coverage.realized_pl.value, -20);
  assert.equal(result.coverage.realized_pl.basis, 100);
  assert.equal(result.coverage.realized_pl.missing_lots, 1);
  assert.equal(result.coverage.total_pl.value, 0);
  assert.equal(result.coverage.total_pl.basis, 200);
});
test('no calculable lots is unavailable, while no eligible lots is a genuine zero', () => {
  const incomplete = periodPerformance([lot({ purchase_date: null })], history, june, identity);
  assert.equal(incomplete.coverage.value, null);
  assert.equal(incomplete.coverage.missing_lots, 1);
  const empty = periodPerformance([lot({ purchase_date: '2026-07-01' })], history, june, identity);
  assert.equal(empty.coverage.value, 0);
  assert.equal(empty.coverage.missing_lots, 0);
});
