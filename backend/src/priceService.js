import yahooFinance from "yahoo-finance2";

const DEFAULT_TIMEOUT_MS = 10_000;
const PRICE_CACHE_TTL_MS = 60_000;
const PRICE_CACHE_FAILURE_TTL_MS = 10_000;
const HISTORY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const RESOLUTION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CONCURRENCY = 4;

const YAHOO_CHART_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

const priceCache = new Map();
const historyCache = new Map();
const resolutionCache = new Map();
let yahooBlockedUntilMs = 0;

// Export function to clear caches (for debugging/manual refresh)
export function clearAllCaches() {
  priceCache.clear();
  historyCache.clear();
  resolutionCache.clear();
  yahooBlockedUntilMs = 0;
  console.log('All price caches cleared, Yahoo block lifted');
}

function nowMs() {
  return Date.now();
}

function cacheGet(map, key, ttlMs) {
  const entry = map.get(key);
  if (!entry) {
    return null;
  }
  const effectiveTtlMs =
    Number.isFinite(entry.ttlMs) && entry.ttlMs > 0 ? entry.ttlMs : ttlMs;
  if (effectiveTtlMs > 0 && nowMs() - entry.ts > effectiveTtlMs) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(map, key, value, ttlMs = null) {
  const entry = { ts: nowMs(), value };
  if (Number.isFinite(ttlMs) && ttlMs > 0) {
    entry.ttlMs = ttlMs;
  }
  map.set(key, entry);
}

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normaliseNumericString(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const cleaned = String(value)
    .trim()
    .replace(/\u202f/g, " ")
    .replace(/\s+/g, "")
    .replace(",", ".");
  if (!cleaned) {
    return null;
  }
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function extractPrice10dFromCloses(closes = []) {
  const values = closes.filter((value) => Number.isFinite(value));
  if (!values.length) {
    return null;
  }
  if (values.length >= 11) {
    return values[values.length - 11];
  }
  return values[0];
}

function extractPrice1yFromCloses(closes = []) {
  const values = closes.filter((value) => Number.isFinite(value));
  if (!values.length) {
    return null;
  }
  return values[0];
}

async function fetchWithTimeout(url, { timeoutMs = DEFAULT_TIMEOUT_MS, ...options } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const mergedHeaders = {
      Accept: "application/json,text/plain,*/*",
      ...(options.headers || {}),
    };
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: mergedHeaders,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options) {
  const res = await fetchWithTimeout(url, options);
  const text = await res.text();
  if (!res.ok) {
    const error = new Error(`HTTP ${res.status} fetching ${url}`);
    error.status = res.status;
    error.body = text;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    const parseError = new Error(`Invalid JSON from ${url}`);
    parseError.cause = error;
    parseError.body = text;
    throw parseError;
  }
}

async function fetchText(url, options) {
  const res = await fetchWithTimeout(url, options);
  const text = await res.text();
  if (!res.ok) {
    const error = new Error(`HTTP ${res.status} fetching ${url}`);
    error.status = res.status;
    error.body = text;
    throw error;
  }
  return text;
}

function toUnixSeconds(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  return Math.floor(date.getTime() / 1000);
}

async function fetchYahooChartJson(symbol, params) {
  const upper = String(symbol || "").toUpperCase().trim();
  if (!upper) {
    throw new Error("Missing symbol");
  }
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") {
      return;
    }
    search.set(key, String(value));
  });
  const query = search.toString();

  let lastError = null;
  let sawRateLimit = false;
  for (const host of YAHOO_CHART_HOSTS) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(upper)}${
      query ? `?${query}` : ""
    }`;
    try {
      return await fetchJson(url);
    } catch (error) {
      lastError = error;
      const status = typeof error?.status === "number" ? error.status : null;
      if (status === 429) {
        sawRateLimit = true;
      }
    }
  }

  if (sawRateLimit) {
    yahooBlockedUntilMs = nowMs() + 15 * 60 * 1000;
  }
  throw lastError ?? new Error("Yahoo chart fetch failed");
}

function inferCurrencyFromSymbolId(symbolId) {
  if (!symbolId) {
    return null;
  }
  const id = String(symbolId);
  if (/^(1rP|1rT|1z|2z|5p)/.test(id)) {
    return "EUR";
  }
  if (/^0P/i.test(id)) {
    return "EUR";
  }
  return "USD";
}

function boursoramaCandidates(symbol) {
  const upper = String(symbol || "").toUpperCase().trim();
  if (!upper) {
    return [];
  }
  const parts = upper.split(".");
  const base = parts[0];
  const suffix = parts.length > 1 ? parts[parts.length - 1] : null;

  if (suffix === "PA") {
    return [`1rP${base}`, `1rT${base}`];
  }
  if (suffix === "DE") {
    return [`1z${base}`];
  }
  if (suffix === "F" && /^0P/.test(base)) {
    return [];
  }
  if (parts.length === 1) {
    return [upper];
  }
  return [base];
}

async function fetchBoursoramaQuote(symbolId) {
  const cacheKey = `boursorama:quote:${symbolId}`;
  const cached = cacheGet(historyCache, cacheKey, PRICE_CACHE_TTL_MS);
  if (cached) {
    return cached;
  }
  const url = `https://www.boursorama.com/bourse/action/graph/ws/GetTicksEOD?symbol=${encodeURIComponent(
    symbolId,
  )}&length=5&period=-1`;
  const data = await fetchJson(url);
  if (!data || Array.isArray(data) || !data.d) {
    return null;
  }
  const root = data.d;

  // Get live intraday price from QuoteTab (most recent tick)
  let current = safeNumber(root?.qd?.c);
  const quoteTab = root?.QuoteTab;
  if (Array.isArray(quoteTab) && quoteTab.length > 0) {
    // QuoteTab contains intraday ticks, use the most recent close price
    const latestTick = quoteTab[quoteTab.length - 1];
    const intradayPrice = safeNumber(latestTick?.c);
    if (intradayPrice !== null) {
      current = intradayPrice;
    }
  }

  const previous = safeNumber(root?.qv?.c);
  const change = current !== null && previous !== null ? current - previous : null;
  const changePct = change !== null && previous ? (change / previous) * 100 : null;
  const quote = {
    current,
    previous_close: previous,
    change,
    change_pct: changePct,
    long_name: root?.Name ?? null,
    currency: inferCurrencyFromSymbolId(symbolId),
  };
  cacheSet(historyCache, cacheKey, quote);
  return quote;
}

function boursoramaDateFromDays(days) {
  if (!Number.isFinite(days) || days <= 0) {
    return null;
  }
  const date = new Date(days * 86400000);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function fetchBoursoramaDailyHistory(symbolId, { period1, period2 }) {
  const start = period1 instanceof Date ? period1 : null;
  const end = period2 instanceof Date ? period2 : null;
  if (!start || !end) {
    return [];
  }
  const diffDays = Math.ceil((end.getTime() - start.getTime()) / 86400000);
  const length = Math.max(365, diffDays);
  const cacheKey = `boursorama:history:${symbolId}:${length}`;
  const cached = cacheGet(historyCache, cacheKey, HISTORY_CACHE_TTL_MS);
  const raw =
    cached ??
    (await fetchJson(
      `https://www.boursorama.com/bourse/action/graph/ws/GetTicksEOD?symbol=${encodeURIComponent(
        symbolId,
      )}&length=${length}`,
    ));
  if (!cached) {
    cacheSet(historyCache, cacheKey, raw);
  }

  if (!raw || Array.isArray(raw) || !raw.d) {
    return [];
  }
  const quoteTab = raw.d?.QuoteTab;
  if (!Array.isArray(quoteTab)) {
    return [];
  }

  const points = [];
  for (const entry of quoteTab) {
    const close = safeNumber(entry?.c);
    if (close === null) {
      continue;
    }
    const dayValue = safeNumber(entry?.d);
    if (dayValue === null) {
      continue;
    }
    // Daily responses encode days since epoch (~20000). Intraday responses encode yymmddhhmm or 0.
    if (dayValue > 1_000_000) {
      continue;
    }
    const date = boursoramaDateFromDays(dayValue);
    if (!date) {
      continue;
    }
    if (date < start || date > end) {
      continue;
    }
    points.push({ date: date.toISOString().slice(0, 10), close });
  }

  points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return points;
}

function inferCurrencyFromStooq(symbol) {
  const upper = String(symbol || "").toUpperCase();
  if (upper.endsWith(".US")) {
    return "USD";
  }
  if (upper.endsWith(".UK")) {
    return "GBP";
  }
  if (upper.endsWith(".DE")) {
    return "EUR";
  }
  return null;
}

function stooqSymbol(symbol) {
  const upper = String(symbol || "").toUpperCase().trim();
  if (!upper) {
    return null;
  }
  const parts = upper.split(".");
  if (parts.length === 1) {
    return `${upper}.US`.toLowerCase();
  }
  const base = parts[0];
  const suffix = parts[parts.length - 1];
  if (suffix === "L") {
    return `${base}.UK`.toLowerCase();
  }
  if (suffix === "UK" || suffix === "US" || suffix === "DE") {
    return `${base}.${suffix}`.toLowerCase();
  }
  return null;
}

function parseStooqCsv(text) {
  if (!text) {
    return [];
  }
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return [];
  }
  const header = lines[0];
  const delimiter = header.includes(";") ? ";" : ",";
  const headers = header.split(delimiter).map((h) => h.trim().toLowerCase());
  const dateIndex = headers.indexOf("date");
  const closeIndex = headers.indexOf("close");
  if (dateIndex === -1 || closeIndex === -1) {
    return [];
  }
  const points = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(delimiter);
    if (parts.length <= Math.max(dateIndex, closeIndex)) {
      continue;
    }
    const date = parts[dateIndex]?.trim();
    const close = safeNumber(parts[closeIndex]);
    if (!date || close === null) {
      continue;
    }
    points.push({ date, close });
  }
  points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return points;
}

function toYYYYMMDD(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

async function fetchStooqHistory(symbol, { period1, period2 }) {
  const start = period1 instanceof Date ? period1 : null;
  const end = period2 instanceof Date ? period2 : null;
  if (!start || !end) {
    return [];
  }
  const cacheKey = `stooq:history:${symbol}:${toYYYYMMDD(start)}:${toYYYYMMDD(end)}`;
  const cached = cacheGet(historyCache, cacheKey, HISTORY_CACHE_TTL_MS);
  if (cached) {
    return cached;
  }
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&d1=${toYYYYMMDD(
    start,
  )}&d2=${toYYYYMMDD(end)}&i=d`;
  const text = await fetchText(url, { headers: { Accept: "text/csv,*/*" } });
  const parsed = parseStooqCsv(text);
  cacheSet(historyCache, cacheKey, parsed);
  return parsed;
}

async function fetchYahooHistoryPoints(symbol, { period1, period2, interval }) {
  if (!symbol) {
    return [];
  }
  if (nowMs() < yahooBlockedUntilMs) {
    return [];
  }
  const start = period1 instanceof Date ? period1 : null;
  const end = period2 instanceof Date ? period2 : null;
  if (!start || !end) {
    return [];
  }
  const startSeconds = toUnixSeconds(start);
  const endSeconds = toUnixSeconds(end);
  if (!startSeconds || !endSeconds) {
    return [];
  }
  try {
    const data = await fetchYahooChartJson(symbol, {
      interval,
      period1: startSeconds,
      period2: endSeconds,
      events: "history",
      includeAdjustedClose: "true",
    });
    const result = data?.chart?.result?.[0];
    if (!result) {
      return [];
    }
    const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
    const adjClose = result?.indicators?.adjclose?.[0]?.adjclose;
    const closeSeries = Array.isArray(adjClose)
      ? adjClose
      : result?.indicators?.quote?.[0]?.close;
    if (!Array.isArray(closeSeries) || !timestamps.length) {
      return [];
    }

    const points = [];
    const length = Math.min(timestamps.length, closeSeries.length);
    for (let index = 0; index < length; index += 1) {
      const ts = safeNumber(timestamps[index]);
      const close = safeNumber(closeSeries[index]);
      if (ts === null || close === null) {
        continue;
      }
      const dateObj = new Date(ts * 1000);
      if (Number.isNaN(dateObj.getTime())) {
        continue;
      }
      points.push({ date: dateObj.toISOString().slice(0, 10), close });
    }

    points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return points;
  } catch {
    return [];
  }
}

async function fetchYahooChartApi(symbol) {
  try {
    const data = await fetchYahooChartJson(symbol, { interval: "1d", range: "1d" });
    const result = data?.chart?.result?.[0];
    if (!result) {
      console.log(`[YahooChart] No result for ${symbol}`);
      return null;
    }
    const meta = result.meta;
    const current = safeNumber(meta?.regularMarketPrice);
    const previous = safeNumber(meta?.chartPreviousClose);
    const change = current !== null && previous !== null ? current - previous : null;
    const changePct = change !== null && previous ? (change / previous) * 100 : null;

    console.log(`[YahooChart] ${symbol}: current=${current}, previous=${previous}, change=${change}`);

    return {
      current,
      previous_close: previous,
      change,
      change_pct: changePct,
      long_name: meta?.longName ?? meta?.shortName ?? null,
      currency: meta?.currency ?? null,
    };
  } catch (err) {
    console.log(`[YahooChart] Error for ${symbol}: ${err.message}`);
    return null;
  }
}

async function fetchYahooFallback(symbol) {
  if (!symbol) {
    return null;
  }
  if (nowMs() < yahooBlockedUntilMs) {
    return null;
  }
  const upper = symbol.toUpperCase();

  // Try chart API first (more reliable, less rate-limiting)
  const chartData = await fetchYahooChartApi(upper);
  if (chartData) {
    // Still need historical data, try to get it
    let price10d = null;
    let price1y = null;
    try {
      const end = new Date();
      const start = new Date();
      start.setFullYear(end.getFullYear() - 1);
      const closes = (await fetchYahooHistoryPoints(upper, { period1: start, period2: end, interval: "1d" }))
        .map((point) => point.close)
        .filter((value) => value !== null);
      price10d = extractPrice10dFromCloses(closes);
      price1y = extractPrice1yFromCloses(closes);
    } catch {
      price10d = null;
      price1y = null;
    }

    const change10dPct =
      chartData.current !== null && price10d !== null && price10d !== 0
        ? ((chartData.current / price10d) - 1) * 100
        : null;
    const change1yPct =
      chartData.current !== null && price1y !== null && price1y !== 0
        ? ((chartData.current / price1y) - 1) * 100
        : null;

    return {
      ...chartData,
      price_10d: price10d,
      change_10d_pct: change10dPct,
      price_1y: price1y,
      change_1y_pct: change1yPct,
    };
  }

  // Fall back to library method
  try {
    const quote = await yahooFinance.quote(upper);

    const current =
      safeNumber(quote?.regularMarketPrice) ?? safeNumber(quote?.postMarketPrice);
    const previous =
      safeNumber(quote?.regularMarketPreviousClose) ??
      safeNumber(quote?.postMarketPreviousClose);
    const change =
      current !== null && previous !== null
        ? current - previous
        : safeNumber(quote?.regularMarketChange);
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
      const closes = (await fetchYahooHistoryPoints(upper, { period1: start, period2: end, interval: "1d" }))
        .map((point) => point.close)
        .filter((value) => value !== null);
      price10d = extractPrice10dFromCloses(closes);
      price1y = extractPrice1yFromCloses(closes);
    } catch {
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

    return {
      current,
      previous_close: previous,
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
    const message = String(error?.message || "");
    if (message.includes("Too Many Requests") || message.includes("429")) {
      yahooBlockedUntilMs = nowMs() + 15 * 60 * 1000;
    }
    return null;
  }
}

function emptyPriceEntry() {
  return {
    current: 0,
    previous_close: null,
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

function isEmptyPrice(entry) {
  if (!entry || typeof entry !== "object") {
    return true;
  }
  return (
    entry.current === 0 &&
    entry.previous_close === null &&
    entry.change === null &&
    entry.change_pct === null &&
    entry.long_name === null &&
    entry.currency === null &&
    entry.price_10d === null &&
    entry.change_10d_pct === null &&
    entry.price_1y === null &&
    entry.change_1y_pct === null
  );
}

async function resolveAndFetchPrice(symbol) {
  const upper = String(symbol || "").toUpperCase().trim();
  if (!upper) {
    return emptyPriceEntry();
  }

  const fundBase = upper.split(".")[0];
  if (/^0P/.test(fundBase) && upper.endsWith(".F")) {
    const url = `https://www.boursorama.com/bourse/opcvm/cours/${encodeURIComponent(
      fundBase,
    )}/`;
    try {
      const html = await fetchText(url, { headers: { Accept: "text/html,*/*" } });
      const nameMatch = html.match(/c-faceplate__company-link[^>]*>\\s*([^<]+)</i);
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      const longNameFromHtml =
        nameMatch?.[1]?.trim() ?? titleMatch?.[1]?.split(" - ")?.[0]?.trim() ?? null;
      const priceMatch = html.match(/data-ist-last[^>]*>([^<]+)</i);
      const variationMatch = html.match(/data-ist-variation[^>]*>([^<]+)</i);
      const currencyMatch = html.match(/c-faceplate__price-currency[^>]*>\\s*([A-Z]{3})\\s*</i);

      const current = normaliseNumericString(priceMatch?.[1]) ?? 0;
      const variationStr = variationMatch?.[1]?.trim() || null;

      // Parse variation percentage (e.g., "-1,55%" or "+2,30%")
      let changePct = null;
      let previous = null;
      let change = null;

      if (variationStr && current !== 0) {
        const cleanVariation = variationStr.replace(/[+%\s]/g, '').replace(',', '.');
        changePct = normaliseNumericString(cleanVariation);
        if (changePct !== null && Number.isFinite(changePct)) {
          // Calculate previous NAV from current price and variation
          // Formula: previous = current / (1 + changePct/100)
          previous = current / (1 + changePct / 100);
          change = current - previous;
        }
      }

      // Fetch historical NAV data from Yahoo Finance for 10-day and 1-year changes
      let price10d = null;
      let price1y = null;
      let longName = longNameFromHtml;
      let resolvedCurrency = currencyMatch?.[1] ?? null;

      if (!longName || !resolvedCurrency) {
        const chartMeta = await fetchYahooChartApi(upper);
        if (chartMeta) {
          longName = chartMeta.long_name ?? longName;
          resolvedCurrency = chartMeta.currency ?? resolvedCurrency;
        }
      }
      try {
        // Use direct chart API for funds (more reliable than library)
        const histData = await fetchYahooChartJson(upper, { interval: "1d", range: "1mo" });
        const histResult = histData?.chart?.result?.[0];
        if (histResult) {
          const meta = histResult?.meta;
          longName = meta?.longName ?? meta?.shortName ?? longName;
          resolvedCurrency = meta?.currency ?? resolvedCurrency;
          const closes = histResult.indicators?.quote?.[0]?.close?.filter((c) => c !== null) || [];
          if (closes.length > 0) {
            price10d = extractPrice10dFromCloses(closes);
            price1y = closes.length > 0 ? closes[0] : null; // Use oldest available as approximation
          }
        }
      } catch {
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

      return {
        current,
        previous_close: previous,
        change,
        change_pct: changePct,
        long_name: longName,
        currency: resolvedCurrency ?? "EUR",
        price_10d: price10d,
        change_10d_pct: change10dPct,
        price_1y: price1y,
        change_1y_pct: change1yPct,
      };
    } catch {
      return emptyPriceEntry();
    }
  }

  const cachedResolution = cacheGet(resolutionCache, upper, RESOLUTION_CACHE_TTL_MS);
  if (cachedResolution?.provider === "yahoo") {
    const yahoo = await fetchYahooFallback(cachedResolution.id || upper);
    if (yahoo) {
      return { ...yahoo, current: yahoo.current ?? 0 };
    }
  }

  const yahoo = await fetchYahooFallback(upper);
  if (yahoo) {
    cacheSet(resolutionCache, upper, { provider: "yahoo", id: upper });
    return { ...yahoo, current: yahoo.current ?? 0 };
  }

  if (cachedResolution?.provider === "boursorama") {
    try {
      const quote = await fetchBoursoramaQuote(cachedResolution.id);
      if (quote?.current !== null && quote?.current !== undefined) {
        const history = await fetchBoursoramaDailyHistory(cachedResolution.id, {
          period1: (() => {
            const start = new Date();
            start.setFullYear(start.getFullYear() - 1);
            return start;
          })(),
          period2: new Date(),
        });
        const closes = history.map((p) => p.close);
        const price10d = extractPrice10dFromCloses(closes);
        const price1y = extractPrice1yFromCloses(closes);
        const current = safeNumber(quote.current);
        const change10dPct =
          current !== null && price10d !== null && price10d !== 0
            ? ((current / price10d) - 1) * 100
            : null;
        const change1yPct =
          current !== null && price1y !== null && price1y !== 0
            ? ((current / price1y) - 1) * 100
            : null;
        return {
          ...quote,
          current: current ?? 0,
          price_10d: price10d,
          change_10d_pct: change10dPct,
          price_1y: price1y,
          change_1y_pct: change1yPct,
        };
      }
    } catch {
      // fall through
    }
  }

  const candidates = boursoramaCandidates(upper);
  for (const candidate of candidates) {
    try {
      const quote = await fetchBoursoramaQuote(candidate);
      if (quote?.current === null || quote?.current === undefined) {
        continue;
      }
      cacheSet(resolutionCache, upper, { provider: "boursorama", id: candidate });
      const history = await fetchBoursoramaDailyHistory(candidate, {
        period1: (() => {
          const start = new Date();
          start.setFullYear(start.getFullYear() - 1);
          return start;
        })(),
        period2: new Date(),
      });
      const closes = history.map((p) => p.close);
      const price10d = extractPrice10dFromCloses(closes);
      const price1y = extractPrice1yFromCloses(closes);
      const current = safeNumber(quote.current) ?? 0;
      const change10dPct =
        current !== null && price10d !== null && price10d !== 0
          ? ((current / price10d) - 1) * 100
          : null;
      const change1yPct =
        current !== null && price1y !== null && price1y !== 0
          ? ((current / price1y) - 1) * 100
          : null;
      return {
        ...quote,
        current,
        price_10d: price10d,
        change_10d_pct: change10dPct,
        price_1y: price1y,
        change_1y_pct: change1yPct,
      };
    } catch {
      // try next candidate
    }
  }

  const stooq = stooqSymbol(upper);
  if (stooq) {
    try {
      const end = new Date();
      const start = new Date();
      start.setFullYear(end.getFullYear() - 1);
      const points = await fetchStooqHistory(stooq, { period1: start, period2: end });
      if (points.length) {
        cacheSet(resolutionCache, upper, { provider: "stooq", id: stooq });
        const closes = points.map((p) => p.close);
        const current = closes.length ? closes[closes.length - 1] : 0;
        const previous = closes.length >= 2 ? closes[closes.length - 2] : null;
        const price10d = extractPrice10dFromCloses(closes);
        const price1y = extractPrice1yFromCloses(closes);
        const change = previous !== null ? current - previous : null;
        const changePct = change !== null && previous ? (change / previous) * 100 : null;
        const change10dPct =
          current !== null && price10d !== null && price10d !== 0
            ? ((current / price10d) - 1) * 100
            : null;
        const change1yPct =
          current !== null && price1y !== null && price1y !== 0
            ? ((current / price1y) - 1) * 100
            : null;
        return {
          current,
          previous_close: previous,
          change,
          change_pct: changePct,
          long_name: null,
          currency: inferCurrencyFromStooq(stooq),
          price_10d: price10d,
          change_10d_pct: change10dPct,
          price_1y: price1y,
          change_1y_pct: change1yPct,
        };
      }
    } catch {
      // fall through
    }
  }

  return emptyPriceEntry();
}

async function mapWithConcurrency(items, limit, mapper) {
  const out = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      out[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function getPrices(symbols) {
  if (!symbols?.length) {
    return {};
  }

  const unique = Array.from(
    new Set(
      symbols
        .map((symbol) => String(symbol || "").toUpperCase().trim())
        .filter(Boolean),
    ),
  );

  const results = {};
  const toFetch = [];
  for (const symbol of unique) {
    const cached = cacheGet(priceCache, symbol, PRICE_CACHE_TTL_MS);
    if (cached) {
      results[symbol] = cached;
    } else {
      toFetch.push(symbol);
    }
  }

  if (toFetch.length) {
    const fetched = await mapWithConcurrency(toFetch, MAX_CONCURRENCY, async (symbol) => {
      try {
        const entry = await resolveAndFetchPrice(symbol);
        return [symbol, entry];
      } catch {
        return [symbol, emptyPriceEntry()];
      }
    });
    for (const [symbol, entry] of fetched) {
      results[symbol] = entry;
      cacheSet(
        priceCache,
        symbol,
        entry,
        isEmptyPrice(entry) ? PRICE_CACHE_FAILURE_TTL_MS : PRICE_CACHE_TTL_MS,
      );
    }
  }

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

  const unique = Array.from(
    new Set(
      symbols
        .map((symbol) => String(symbol || "").toUpperCase().trim())
        .filter(Boolean),
    ),
  );

  const pairs = await mapWithConcurrency(unique, MAX_CONCURRENCY, async (symbol) => {
    const cacheKey = `history:${symbol}:${period}:${interval}`;
    const cached = cacheGet(historyCache, cacheKey, HISTORY_CACHE_TTL_MS);
    if (cached) {
      return [symbol, cached];
    }

    const resolved = cacheGet(resolutionCache, symbol, RESOLUTION_CACHE_TTL_MS);
    try {
      if (interval === "1d") {
        const points = await fetchYahooHistoryPoints(symbol, { period1, period2, interval });
        if (points.length) {
          cacheSet(resolutionCache, symbol, { provider: "yahoo", id: symbol });
          cacheSet(historyCache, cacheKey, points);
          return [symbol, points];
        }
      }

      if (interval === "1d") {
        if (resolved?.provider === "boursorama") {
          const points = await fetchBoursoramaDailyHistory(resolved.id, { period1, period2 });
          cacheSet(historyCache, cacheKey, points);
          return [symbol, points];
        }
        if (resolved?.provider === "stooq") {
          const points = await fetchStooqHistory(resolved.id, { period1, period2 });
          cacheSet(historyCache, cacheKey, points);
          return [symbol, points];
        }
      }

      if (interval === "1d") {
        const candidates = boursoramaCandidates(symbol);
        for (const candidate of candidates) {
          try {
            const points = await fetchBoursoramaDailyHistory(candidate, { period1, period2 });
            if (points.length) {
              cacheSet(resolutionCache, symbol, { provider: "boursorama", id: candidate });
              cacheSet(historyCache, cacheKey, points);
              return [symbol, points];
            }
          } catch {
            // try next
          }
        }

        const stooq = stooqSymbol(symbol);
        if (stooq) {
          const points = await fetchStooqHistory(stooq, { period1, period2 });
          if (points.length) {
            cacheSet(resolutionCache, symbol, { provider: "stooq", id: stooq });
            cacheSet(historyCache, cacheKey, points);
            return [symbol, points];
          }
        }
      }
    } catch (error) {
      const message = String(error?.message || "");
      if (message.includes("Too Many Requests") || message.includes("429")) {
        yahooBlockedUntilMs = nowMs() + 15 * 60 * 1000;
      }
    }

    cacheSet(historyCache, cacheKey, []);
    return [symbol, []];
  });

  pairs.forEach(([symbol, points]) => {
    out[symbol] = points;
  });

  return out;
}
