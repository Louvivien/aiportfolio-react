import yahooFinance from "yahoo-finance2";

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function extractPrice10dFromHistory(entries = []) {
  const closes = entries
    .map((entry) => safeNumber(entry?.adjClose ?? entry?.close))
    .filter((value) => value !== null);
  if (!closes.length) {
    return null;
  }
  if (closes.length >= 11) {
    return closes[closes.length - 11];
  }
  return closes[0];
}

function extractPrice1yFromHistory(entries = []) {
  const closes = entries
    .map((entry) => safeNumber(entry?.adjClose ?? entry?.close))
    .filter((value) => value !== null);
  if (!closes.length) {
    return null;
  }
  return closes[0];
}

export async function getPrices(symbols) {
  if (!symbols?.length) {
    return {};
  }

  const results = {};

  await Promise.all(
    symbols.map(async (symbol) => {
      const upper = symbol.toUpperCase();
      try {
        const quote = await yahooFinance.quote(upper);

        const current =
          safeNumber(quote?.regularMarketPrice) ?? safeNumber(quote?.postMarketPrice);
        const previous =
          safeNumber(quote?.regularMarketPreviousClose) ??
          safeNumber(quote?.postMarketPreviousClose);
        const change =
          current !== null && previous !== null ? current - previous : safeNumber(quote?.regularMarketChange);
        const changePct =
          change !== null && previous
            ? (change / previous) * 100
            : safeNumber(quote?.regularMarketChangePercent);

        let price10d = null;
        let price1y = null;
        try {
          const end = new Date();
          const start = new Date();
          start.setFullYear(end.getFullYear() - 1);
          const history = await yahooFinance.historical(upper, {
            period1: start,
            period2: end,
            interval: "1d",
          });
          price10d = extractPrice10dFromHistory(history);
          price1y = extractPrice1yFromHistory(history);
        } catch (error) {
          price10d = null;
          price1y = null;
        }

        const change10dPct =
          current !== null && price10d !== null && price10d !== 0
            ? ((current / price10d) - 1) * 100
            : null;

        const change1yPct =
          current !== null && price1y !== null && price1y !== 0
            ? ((current / price1y) - 1) * 100
            : null;

        results[upper] = {
          current,
          change,
          change_pct: changePct,
          long_name: quote?.longName ?? quote?.shortName ?? null,
          currency: quote?.currency ?? null,
          price_10d: price10d,
          change_10d_pct: change10dPct,
          price_1y: price1y,
          change_1y_pct: change1yPct,
        };
      } catch (error) {
        results[upper] = {
          current: null,
          change: null,
          change_pct: null,
          long_name: null,
          currency: null,
          price_10d: null,
          change_10d_pct: null,
          price_1y: null,
          change_1y_pct: null,
        };
      }
    }),
  );

  return results;
}

function resolveStartDate(period) {
  if (!period) {
    const fallback = new Date();
    fallback.setMonth(fallback.getMonth() - 6);
    return fallback;
  }
  const match = /^(\d+)([a-z]+)$/.exec(period.trim());
  if (!match) {
    const fallback = new Date();
    fallback.setMonth(fallback.getMonth() - 6);
    return fallback;
  }
  const value = Number(match[1]);
  const unit = match[2];
  const start = new Date();
  if (Number.isNaN(value) || value <= 0) {
    start.setMonth(start.getMonth() - 6);
    return start;
  }
  switch (unit) {
    case "d":
      start.setDate(start.getDate() - value);
      break;
    case "wk":
    case "w":
      start.setDate(start.getDate() - value * 7);
      break;
    case "mo":
      start.setMonth(start.getMonth() - value);
      break;
    case "y":
      start.setFullYear(start.getFullYear() - value);
      break;
    default:
      start.setMonth(start.getMonth() - 6);
      break;
  }
  return start;
}

export async function getPriceHistory(symbols, { period = "6mo", interval = "1d" } = {}) {
  if (!symbols?.length) {
    return {};
  }

  const out = {};
  const period1 = resolveStartDate(period);
  const period2 = new Date();

  await Promise.all(
    symbols.map(async (symbol) => {
      const upper = symbol.toUpperCase();
      try {
        const history = await yahooFinance.historical(upper, {
          period1,
          period2,
          interval,
        });

        if (!history?.length) {
          out[upper] = [];
          return;
        }

        const points = [];
        for (const entry of history) {
          const close = safeNumber(
            entry?.adjClose ??
              entry?.adjustedClose ??
              entry?.close ??
              entry?.AdjClose ??
              entry?.Close,
          );
          if (close === null) {
            continue;
          }
          const dateObj =
            entry?.date instanceof Date
              ? entry.date
              : entry?.Date instanceof Date
                ? entry.Date
                : new Date(entry?.date || entry?.Date || entry?.timestamp || entry?.DateTime);
          if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) {
            continue;
          }
          const date = dateObj.toISOString().slice(0, 10);
          points.push({ date, close });
        }

        points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        out[upper] = points;
      } catch (error) {
        out[upper] = [];
      }
    }),
  );

  return out;
}
