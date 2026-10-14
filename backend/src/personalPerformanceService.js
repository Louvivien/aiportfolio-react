import { getDb } from './db.js';
import { getPrices, getPriceHistory } from './priceService.js';
import { loadFxRates } from './fxService.js';
import { positionLots } from './finance.js';
import { parisDate, reconstructSecurities } from './personalPerformanceValuation.js';
import { calculatePersonalPerformance } from './personalPerformance.js';

const EVIDENCE_ID = 'personal-management-2026-identified-flows-v1';
const openingDate = '2025-12-31';
let pending;
export async function getPersonalPerformance2026() {
  // Share dashboard and export requests without persisting a stale valuation.
  if (pending) return pending;
  pending = (async () => {
    const db = getDb();
    const [evidence, docs] = await Promise.all([
      db.collection('performance_inputs').findOne({ _id: EVIDENCE_ID }),
      db.collection('positions').find().toArray(),
    ]);
    const today = parisDate();
    const asOf = today > '2026-12-31' ? '2026-12-31' : today;
    const symbols = [...new Set(docs.filter((doc) => !doc.api_url).map((doc) => doc.symbol))];
    const openingSymbols = [...new Set(docs.filter((doc) => !doc.api_url && positionLots(doc)
      .some((lot) => lot.purchase_date && lot.purchase_date <= openingDate && (!lot.is_closed || lot.closing_date > openingDate)))
      .map((doc) => doc.symbol))];
    const prices = await getPrices(symbols);
    const [histories, fx] = await Promise.all([
      Promise.all([false, true].map((german) => getPriceHistory(openingSymbols.filter((symbol) => symbol.endsWith('.DE') === german), {
        period: `${Math.max(13, Math.ceil((Date.now() - Date.parse(openingDate)) / (28 * 86400000)) + 1)}mo`,
        requiredDates: [german ? '2025-12-30' : openingDate],
      }))).then((groups) => Object.assign({}, ...groups)),
      loadFxRates(),
    ]);
    const opening = reconstructSecurities(docs, prices, histories, fx, openingDate, true);
    const current = reconstructSecurities(docs, prices, {}, fx, asOf);
    // After year-end a live quote is not a year-end valuation.
    if (today > asOf) { current.complete = false; current.missing_symbols = ['valorisation historique de clôture 2026']; }
    return calculatePersonalPerformance(evidence, opening, current, asOf);
  })().finally(() => { pending = null; });
  return pending;
}
