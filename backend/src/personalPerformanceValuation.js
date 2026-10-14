import { currencyConverter } from './fxService.js';
import { positionLots, priceAt } from './finance.js';
import { validDate, elapsedDays } from './personalPerformance.js';
const openingDate = '2025-12-31';

export function parisDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type) => parts.find((p) => p.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function reconstructSecurities(docs, prices, histories, fx, date, historical = false) {
  let known = 0;
  const missing = new Set();
  let count = 0;
  for (const doc of docs) {
    const lots = positionLots(doc);
    if (lots.some((lot) => !lot.purchase_date || (lot.is_closed && !lot.closing_date))) missing.add(doc.symbol);
    const held = lots.filter((lot) => lot.purchase_date && lot.purchase_date <= date && (!lot.is_closed || lot.closing_date > date));
    if (!held.length) continue;
    count++;
    if (doc.api_url || held.some((lot) => !Number.isFinite(lot.quantity) || lot.quantity <= 0)) { missing.add(doc.symbol); continue; }
    const quote = prices[doc.symbol];
    // Xetra's official 2025 calendar confirms the exchange was closed Dec 31.
    // This exception must not be applied to a fund NAV or arbitrary weekdays.
    const boundary = historical && date === openingDate && doc.symbol.endsWith('.DE') ? '2025-12-30' : date;
    const price = historical ? priceAt(histories[doc.symbol], boundary)?.close : quote?.current;
    if (!historical && (!validDate(quote?.quote_date) || quote.quote_date > date || elapsedDays(quote.quote_date, date) > 7)) { missing.add(doc.symbol); continue; }
    const value = !Number.isFinite(price) || price < 0 ? null : currencyConverter(fx, quote?.currency)(price * held.reduce((s, l) => s + l.quantity, 0), date);
    if (value === null || !Number.isFinite(value)) missing.add(doc.symbol); else known += value;
  }
  return { known_value_eur: known, complete: missing.size === 0, missing_symbols: [...missing], position_count: count };
}

