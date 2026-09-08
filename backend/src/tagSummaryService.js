import { day, number, percent, positionLots, sum } from './finance.js';

// Aggregate each metric independently. A missing daily quote must not remove a
// known market value, nor contribute its cost basis to another position's return.
export function tagMetricCoverage(positions, key) {
  const isPeriod = ['intraday', 'ten_day', 'one_year'].includes(key);
  const entries = positions.map((position) => {
    const metric = position.valuation?.[key];
    const data = isPeriod ? metric?.coverage : position.valuation?.coverage?.[key];
    const value = number(data ? data.value : isPeriod ? metric?.gain : metric);
    const basis = number(data ? data.basis : isPeriod ? metric?.basis : 0);
    const valid = value !== null && (!isPeriod || basis !== null);
    const missing = Math.max(data?.missing_lots ?? 0, valid ? 0 : 1);
    return { value: valid ? value : null, basis: valid ? basis : null,
      included: valid ? data?.included_lots ?? 1 : 0, missing,
      issues: missing ? (data?.issues?.length ? data.issues : ['Valuation unavailable.'])
        .map((reason) => `${position.symbol}: ${reason}`) : [] };
  });
  const included_lots = sum(entries.map((entry) => entry.included));
  const missing_lots = sum(entries.map((entry) => entry.missing));
  const known = entries.filter((entry) => entry.value !== null);
  const unavailable = missing_lots > 0 && included_lots === 0;
  return { value: unavailable ? null : sum(known.map((entry) => entry.value)),
    basis: unavailable ? null : sum(known.map((entry) => entry.basis)),
    included_lots, missing_lots, issues: [...new Set(entries.flatMap((entry) => entry.issues))] };
}

export function buildTagSummary(positions, today = day(new Date())) {
  const names = [...new Set(positions.flatMap((position) => position.tags))];
  return names.map((tag) => {
    const selected = positions.filter((position) => position.tags.includes(tag));
    const coverage = Object.fromEntries(['market_value', 'unrealized_pl', 'intraday', 'ten_day', 'one_year']
      .map((key) => [key, tagMetricCoverage(selected, key)]));
    const period = (key) => percent(coverage[key].value, coverage[key].basis);
    return { tag, currency: 'EUR', coverage,
      total_quantity: sum(selected.flatMap((position) => positionLots(position)
        .filter((lot) => (!lot.purchase_date || lot.purchase_date <= today) && (!lot.is_closed || lot.closing_date > today))
        .map((lot) => lot.quantity))),
      total_market_value: coverage.market_value.value,
      total_unrealized_pl: coverage.unrealized_pl.value,
      intraday_change_pct: period('intraday'), change_10d_pct: period('ten_day'), change_1y_pct: period('one_year') };
  }).filter((row) => Number.isFinite(row.total_market_value) && row.total_market_value > 0);
}
