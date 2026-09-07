import { day, number } from './finance.js';

const URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml';
let cache;
let inflight;
export function parseEcbRates(xml) {
  const days = [];
  for (const match of xml.matchAll(/<Cube\s+time=['"]([\d-]+)['"]\s*>([\s\S]*?)<\/Cube>/g)) {
    const rates = { EUR: 1 };
    for (const quote of match[2].matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) {
      const rate = number(quote[2]);
      if (rate > 0) rates[quote[1]] = rate;
    }
    days.push({ date: match[1], rates });
  }
  return days.sort((a, b) => b.date.localeCompare(a.date));
}
export async function loadFxRates() {
  if (cache && Date.now() - cache.loaded < 3600000) return cache.days;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const response = await fetch(URL, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error('ECB rates unavailable');
      const days = parseEcbRates(await response.text());
      if (!days.length) throw new Error('Empty ECB rates');
      cache = { days, loaded: Date.now() };
      return days;
    } catch {
      return cache?.days ?? [];
    } finally { inflight = null; }
  })();
  return inflight;
}
export function exchangeRate(days, currency, date) {
  const scale = currency === 'GBp' || currency === 'GBX' ? 0.01 : 1;
  const code = scale === 0.01 ? 'GBP' : currency;
  if (code === 'EUR') return { rate: 1, date: day(date), source: 'identity' };
  const target = day(date);
  if (!target || !code) return null;
  const entry = days.find((entry) => entry.date <= target && entry.rates[code] > 0);
  if (!entry || new Date(target) - new Date(entry.date) > 7 * 86400000) return null;
  return { rate: scale / entry.rates[code], date: entry.date, source: URL };
}
export function currencyConverter(days, currency) {
  return (amount, date) => {
    if (number(amount) === null) return null;
    const rate = exchangeRate(days, currency, date);
    return rate ? amount * rate.rate : null;
  };
}
