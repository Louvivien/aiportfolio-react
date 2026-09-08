import { getPriceHistory } from './priceService.js';
import { fetchCustomApiDailySeries } from './customApiService.js';
import { currencyConverter, exchangeRate, loadFxRates } from './fxService.js';
import { day, valuePosition, priceAt } from './finance.js';

export async function addValuation(position, source = position) {
  const today = day(new Date());
  const tenDate = new Date(`${today}T00:00:00Z`);
  tenDate.setUTCDate(tenDate.getUTCDate() - 10);
  const yearDate = new Date(`${today}T00:00:00Z`);
  yearDate.setUTCFullYear(yearDate.getUTCFullYear() - 1);
  const [fx, history] = await Promise.all([
    position.currency === 'EUR' ? [] : loadFxRates(),
    source.api_url
      ? fetchCustomApiDailySeries(source.api_url, source.api_token, {
          startDate: new Date(Date.now() - 400 * 86400000),
        }).catch(() => [])
      : getPriceHistory([position.symbol], { period: '13mo', interval: '1d',
          requiredDates: [day(tenDate), day(yearDate)] })
          .then((map) => map[position.symbol] ?? []).catch(() => []),
  ]);
  const valuation = valuePosition(position, history, currencyConverter(fx, position.currency), today);
  const native = valuePosition(position, history, (value) => value, today);
  const price10d = priceAt(history, day(tenDate))?.close ?? null;
  const price1y = priceAt(history, day(yearDate))?.close ?? null;
  const quoteChange = (base) => position.current_price != null && base > 0 ? (position.current_price / base - 1) * 100 : null;
  return {
    ...position,
    price_10d: price10d,
    price_1y: price1y,
    change_10d_pct: quoteChange(price10d),
    change_1y_pct: quoteChange(price1y),
    valuation: { ...valuation, fx: exchangeRate(fx, position.currency, today) },
    native_valuation: { ...native, currency: position.currency },
  };
}
