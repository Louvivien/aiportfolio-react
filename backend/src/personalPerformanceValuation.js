import { currencyConverter } from './fxService.js';
import { positionLots, priceAt } from './finance.js';
import { validDate, elapsedDays } from './personalPerformance.js';
const openingDate = '2025-12-31';

export function parisDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type) => parts.find((p) => p.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function savedOpeningQuote(quotes, symbol, date) {
  const boundary = date === openingDate && symbol.endsWith('.DE') ? '2025-12-30' : date;
  return (quotes ?? []).find((quote) => quote.symbol === symbol && quote.valuation_date === date && quote.price_date === boundary
    && Number.isFinite(quote.close) && quote.close >= 0 && typeof quote.currency === 'string' && quote.currency.length > 0);
}

export function performancePositions(docs, evidence) {
  const excluded = new Set(evidence?.performance_scope?.excluded_symbols ?? []);
  return docs.filter((doc) => !excluded.has(doc.symbol));
}

export function reconstructSecurities(docs, prices, histories, fx, date, historical = false, savedQuotes = [], openingInventory = []) {
  let known = 0;
  const missing = new Set();
  let count = 0;
  const inventory = historical && date === openingDate ? openingInventory.filter((entry) => entry.date === date) : [];
  for (const entry of inventory) {
    if (!docs.some((doc) => String(doc._id) === entry.position_id && doc.symbol === entry.symbol)) missing.add(entry.symbol);
  }
  for (const doc of docs) {
    const entries = inventory.filter((entry) => entry.position_id === String(doc._id));
    const override = entries[0];
    if (entries.length > 1 || (override && (override.symbol !== doc.symbol || !Number.isFinite(override.quantity)
      || override.quantity < 0 || !['user_confirmed', 'documented'].includes(override.status)))) {
      missing.add(doc.symbol);
      continue;
    }
    // A quoted price does not validate an opening inventory. Preserve legacy
    // aggregates for editing, but never value a known-unreconciled opening lot.
    if (!override && historical && date === openingDate && doc.reconciliation?.opening_inventory_status === 'unverified') {
      missing.add(doc.symbol);
      continue;
    }
    const lots = positionLots(doc);
    if (!override && lots.some((lot) => !lot.purchase_date || (lot.is_closed && !lot.closing_date))) missing.add(doc.symbol);
    const held = override ? (override.quantity > 0 ? [{ quantity: override.quantity }] : [])
      : lots.filter((lot) => lot.purchase_date && lot.purchase_date <= date && (!lot.is_closed || lot.closing_date > date));
    if (!held.length) continue;
    count++;
    if (doc.api_url || held.some((lot) => !Number.isFinite(lot.quantity) || lot.quantity <= 0)) { missing.add(doc.symbol); continue; }
    const quote = prices[doc.symbol];
    // Xetra's official 2025 calendar confirms the exchange was closed Dec 31.
    // This exception must not be applied to a fund NAV or arbitrary weekdays.
    const boundary = historical && date === openingDate && doc.symbol.endsWith('.DE') ? '2025-12-30' : date;
    const saved = historical ? savedOpeningQuote(savedQuotes, doc.symbol, date) : null;
    const price = historical ? saved?.close ?? priceAt(histories[doc.symbol], boundary)?.close : quote?.current;
    if (!historical && (!validDate(quote?.quote_date) || quote.quote_date > date || elapsedDays(quote.quote_date, date) > 7)) { missing.add(doc.symbol); continue; }
    const value = !Number.isFinite(price) || price < 0 ? null : currencyConverter(fx, saved?.currency ?? quote?.currency)(price * held.reduce((s, l) => s + l.quantity, 0), date);
    if (value === null || !Number.isFinite(value)) missing.add(doc.symbol); else known += value;
  }
  return { known_value_eur: known, complete: missing.size === 0, missing_symbols: [...missing], position_count: count };
}
