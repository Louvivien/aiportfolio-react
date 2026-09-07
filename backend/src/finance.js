// Pure, lot-based calculations. Amounts stay unrounded until presentation.
export const CALCULATION_VERSION = 2;
export const number = (value) => value === null || value === undefined || value === ''
  ? null : Number.isFinite(Number(value)) ? Number(value) : null;
export const day = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};
export const previousDay = (date) => day(new Date(new Date(`${date}T00:00:00Z`).getTime() - 86400000));
export const sum = (values) => values.some((v) => v === null || !Number.isFinite(v))
  ? null : values.reduce((a, b) => a + b, 0);
export const difference = (end, start) => end === null || start === null ? null : end - start;
export const percent = (gain, basis) => gain === null || basis === null || basis <= 0 ? null : gain / basis * 100;
export const multiply = (a, b) => a === null || b === null ? null : a * b;

export function positionLots(doc) {
  const stored = Array.isArray(doc.purchase_lots) && doc.purchase_lots.length ? doc.purchase_lots : [doc];
  return stored.map((lot) => {
    // A legacy position-level closure applies to any remaining open lots.
    const closed = Boolean(lot.is_closed || doc.is_closed);
    const inheritClosure = stored.length === 1 || (!lot.is_closed && doc.is_closed);
    return {
      ...lot,
      quantity: number(lot.quantity),
      cost_price: number(lot.cost_price),
      purchase_date: day(lot.purchase_date) ?? (stored.length === 1 ? day(doc.purchase_date) : null),
      is_closed: closed,
      closing_date: closed ? day(lot.closing_date) ?? (inheritClosure ? day(doc.closing_date) : null) : null,
      closing_price: closed ? number(lot.closing_price) ?? (inheritClosure ? number(doc.closing_price) : null) : null,
    };
  });
}

export function priceAt(series, date) {
  let found = null;
  for (const point of series || []) {
    const d = day(point.date ?? point.ts);
    const close = number(point.close ?? point.value);
    if (d && d <= date && close !== null && close > 0 && (!found || d > found.date)) {
      found = { date: d, close };
    }
  }
  // Do not value a month from a quote months old, or use a future quote.
  return found && new Date(date) - new Date(found.date) <= 7 * 86400000 ? found : null;
}

export function lotContribution(lot, series, bounds, convert = (value) => value, currentPrice = null) {
  const bought = lot.purchase_date;
  const sold = lot.is_closed ? lot.closing_date : null;
  const skip = (reason, incomplete = false) => ({ skipped: true, reason, incomplete });
  if (bought && bought > bounds.periodEnd) return skip('Purchased after report period.');
  if (sold && sold < bounds.periodStart) return skip('Closed before report period.');
  if (!bought) return skip('Missing purchase date.', true);
  if (lot.is_closed && !sold) return skip('Missing closing date.', true);
  if (sold && sold < bought) return skip('Closing date precedes purchase date.', true);
  if (lot.quantity === null || lot.quantity <= 0 || lot.cost_price === null || lot.cost_price < 0) {
    return skip('Invalid lot quantity or cost.', true);
  }
  const atPurchase = bought >= bounds.periodStart;
  const atClosing = sold && sold <= bounds.periodEnd;
  const startDate = atPurchase ? bought : previousDay(bounds.periodStart);
  const endDate = atClosing ? sold : bounds.periodEnd;
  const startPrice = atPurchase ? lot.cost_price : priceAt(series, startDate)?.close ?? null;
  const endPrice = atClosing ? lot.closing_price : currentPrice ?? priceAt(series, endDate)?.close ?? null;
  if (startPrice === null || endPrice === null) return skip('Missing boundary or sale price.', true);
  const start = convert(startPrice * lot.quantity, startDate);
  const end = convert(endPrice * lot.quantity, endDate);
  if (start === null || end === null) return skip('Missing historical exchange rate.', true);
  return {
    skipped: false, quantity: lot.quantity, start_date: startDate, end_date: endDate,
    start_price: start / lot.quantity, end_price: end / lot.quantity,
    start_value: start, end_value: end, performance_value: end - start,
    start_basis: atPurchase ? 'cost' : 'market', end_basis: atClosing ? 'closing' : 'market',
  };
}

// Keep exact totals unavailable when incomplete, and expose a separately labelled
// subtotal. Gain percentages always use the basis of the same included lots.
export function summarizeCoverage(entries) {
  const included = entries.filter((entry) => number(entry.value) !== null &&
    (entry.basis === undefined || number(entry.basis) !== null));
  const missing = entries.filter((entry) => !included.includes(entry));
  const value = included.length || !entries.length ? sum(included.map((entry) => entry.value)) : null;
  const basis = included.length || !entries.length ? sum(included.map((entry) => entry.basis ?? 0)) : null;
  return { value, basis, included_lots: included.length, missing_lots: missing.length,
    issues: [...new Set(missing.map((entry) => entry.reason || 'Missing price or exchange rate.'))] };
}

export function periodPerformance(lots, series, bounds, convert, currentPrice) {
  const results = lots.map((lot) => lotContribution(lot, series, bounds, convert, currentPrice));
  const coverage = summarizeCoverage(results.filter((r) => !r.skipped || r.incomplete).map((r) => ({
    value: r.skipped ? null : r.performance_value, basis: r.skipped ? null : r.start_value, reason: r.reason,
  })));
  const gain = coverage.missing_lots ? null : coverage.value;
  const basis = coverage.missing_lots ? null : coverage.basis;
  return { basis, gain, percent: percent(gain, basis), coverage };
}

export function valuePosition(doc, series, convert, today = day(new Date())) {
  const lots = positionLots(doc).filter((lot) => !lot.purchase_date || lot.purchase_date <= today);
  const open = lots.filter((lot) => !lot.is_closed || (lot.closing_date && lot.closing_date > today));
  const closed = lots.filter((lot) => lot.is_closed && (!lot.closing_date || lot.closing_date <= today));
  const current = number(doc.current_price);
  const cost = (lot) => convert(multiply(lot.quantity, lot.cost_price), lot.purchase_date);
  const marketValue = sum(open.map((lot) => convert(multiply(current, lot.quantity), today)));
  const openCost = sum(open.map(cost));
  const closedCost = sum(closed.map(cost));
  const proceeds = sum(closed.map((lot) => convert(multiply(lot.quantity, lot.closing_price), lot.closing_date)));
  const realized = difference(proceeds, closedCost);
  const unrealized = difference(marketValue, openCost);
  const openEntries = open.map((lot) => {
    const basis = cost(lot);
    const market = convert(multiply(current, lot.quantity), today);
    return { basis, market, value: difference(market, basis),
      reason: basis === null && !lot.purchase_date ? 'Missing purchase date for historical FX.' : 'Missing quote or exchange rate.' };
  });
  const closedEntries = closed.map((lot) => {
    const basis = cost(lot);
    const proceeds = convert(multiply(lot.quantity, lot.closing_price), lot.closing_date);
    return { basis, value: difference(proceeds, basis),
      reason: lot.closing_price === null ? 'Missing sale price.' : !lot.purchase_date || !lot.closing_date
        ? 'Missing purchase or sale date for historical FX.' : 'Missing historical exchange rate.' };
  });
  const coverage = {
    open_cost: summarizeCoverage(openEntries.map((entry) => ({ value: entry.basis, reason: entry.reason }))),
    closed_cost: summarizeCoverage(closedEntries.map((entry) => ({ value: entry.basis, reason: entry.reason }))),
    market_value: summarizeCoverage(openEntries.map((entry) => ({ value: entry.market, reason: entry.reason }))),
    unrealized_pl: summarizeCoverage(openEntries), realized_pl: summarizeCoverage(closedEntries),
    total_pl: summarizeCoverage([...openEntries, ...closedEntries]),
  };
  const ten = new Date(`${today}T00:00:00Z`);
  ten.setUTCDate(ten.getUTCDate() - 9);
  const year = new Date(`${today}T00:00:00Z`);
  year.setUTCFullYear(year.getUTCFullYear() - 1);
  year.setUTCDate(year.getUTCDate() + 1);
  const period = (start) => periodPerformance(lots, series, { periodStart: start, periodEnd: today }, convert, current);
  return {
    currency: 'EUR', calculation_version: CALCULATION_VERSION, coverage,
    open_cost: openCost, closed_cost: closedCost, market_value: marketValue,
    realized_pl: realized, unrealized_pl: unrealized, total_pl: sum([realized, unrealized]),
    intraday: period(today), ten_day: period(day(ten)), one_year: period(day(year)),
  };
}

export function safePeRatio(price, quoteCurrency, snapshot, symbol) {
  const eps = number(snapshot?.epsDiluted);
  // Annual EPS must be for this exact traded instrument and in the quote currency.
  if (!quoteCurrency || quoteCurrency !== snapshot?.epsCurrency ||
      snapshot?.symbol !== symbol || snapshot?.epsShareBasis !== 'listed_share' ||
      eps === null || eps <= 0 || number(price) === null || price <= 0) return null;
  return price / eps;
}

export function holdingsAt(doc, series, date, convert) {
  const lots = positionLots(doc);
  // Unknown dates cannot establish historical ownership.
  if (lots.some((lot) => !lot.purchase_date || (lot.is_closed && !lot.closing_date))) {
    return { date, market_value: null, unrealized_pl: null };
  }
  const held = lots.filter((lot) => lot.purchase_date <= date && (!lot.is_closed || lot.closing_date > date));
  const quote = priceAt(series, date)?.close ?? null;
  const market = sum(held.map((lot) => convert(multiply(lot.quantity, quote), date)));
  const cost = sum(held.map((lot) => convert(multiply(lot.quantity, lot.cost_price), lot.purchase_date)));
  return { date, market_value: market, unrealized_pl: difference(market, cost) };
}
