const DEFAULT_TIMEOUT_MS = 12_000;
const SERIES_CACHE_TTL_MS = 15_000;

const seriesCache = new Map();
const inflight = new Map();
const portfoliosCache = new Map();
const portfoliosInflight = new Map();

function nowMs() {
  return Date.now();
}

function cacheGet(map, key, ttlMs) {
  const entry = map.get(key);
  if (!entry) {
    return null;
  }
  if (ttlMs > 0 && nowMs() - entry.ts > ttlMs) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(map, key, value) {
  map.set(key, { ts: nowMs(), value });
}

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseTimestamp(value) {
  if (!value && value !== 0) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }
  return null;
}

function toIsoDateOnly(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function buildAuthHeaders(apiToken) {
  const headers = {
    accept: "application/json",
  };
  const token = typeof apiToken === "string" ? apiToken.trim() : "";
  if (token) {
    headers["x-auth-token"] = token;
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

async function fetchWithTimeout(url, { timeoutMs = DEFAULT_TIMEOUT_MS, ...options } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options) {
  const response = await fetchWithTimeout(url, options);
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} fetching custom API series`);
    error.status = response.status;
    error.body = text;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    const parseError = new Error("Invalid JSON from custom API");
    parseError.cause = err;
    parseError.body = text;
    throw parseError;
  }
}

function extractPointSeries(json) {
  if (Array.isArray(json)) {
    return json;
  }
  if (Array.isArray(json?.data)) {
    return json.data;
  }
  if (Array.isArray(json?.prices)) {
    return json.prices;
  }
  if (Array.isArray(json?.results)) {
    return json.results;
  }
  return [];
}

function normalisePointSeriesFromJson(json, { maxPoints = 10_000 } = {}) {
  const raw = extractPointSeries(json);
  const points = [];

  for (const entry of raw) {
    const ts =
      parseTimestamp(entry?.timestamp) ??
      parseTimestamp(entry?.datetime) ??
      parseTimestamp(entry?.date) ??
      parseTimestamp(entry?.t);

    const value =
      safeNumber(entry?.equityValue) ??
      safeNumber(entry?.value) ??
      safeNumber(entry?.close) ??
      safeNumber(entry?.price) ??
      safeNumber(entry?.nav);

    if (ts === null || value === null) {
      continue;
    }
    points.push({ ts, value });
  }

  if (!points.length) {
    return [];
  }

  points.sort((a, b) => a.ts - b.ts);
  if (maxPoints > 0 && points.length > maxPoints) {
    return points.slice(points.length - maxPoints);
  }
  return points;
}

function normaliseDailySeriesFromJson(json) {
  const points = normalisePointSeriesFromJson(json);

  const byDay = new Map();
  for (const point of points) {
    const day = toIsoDateOnly(point.ts);
    const current = byDay.get(day);
    if (!current || point.ts >= current.ts) {
      byDay.set(day, point);
    }
  }

  return Array.from(byDay.values()).sort((a, b) => a.ts - b.ts);
}

function findPointAtOrBefore(points, targetMs) {
  if (!points.length) {
    return null;
  }
  let lo = 0;
  let hi = points.length - 1;
  let best = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const point = points[mid];
    if (point.ts <= targetMs) {
      best = point;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

const TRADINGAPP_EQUITY_PATH_RE = /^\/api\/strategies\/equity\/([^/]+)\/([^/]+)\/?$/;

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseTradingAppEquityUrl(apiUrl) {
  const trimmed = typeof apiUrl === "string" ? apiUrl.trim() : "";
  if (!trimmed) {
    return null;
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return null;
  }

  const match = TRADINGAPP_EQUITY_PATH_RE.exec(url.pathname);
  if (!match) {
    return null;
  }

  const userId = match[1];
  const strategyId = match[2];
  if (!userId || !strategyId) {
    return null;
  }

  return {
    origin: url.origin,
    userId,
    strategyId,
  };
}

async function fetchTradingAppPortfolioEquityMap(origin, userId, apiToken) {
  if (!origin || !userId) {
    return new Map();
  }

  const finalUrl = new URL(`/api/strategies/portfolios/${userId}`, origin).toString();
  const cached = cacheGet(portfoliosCache, finalUrl, SERIES_CACHE_TTL_MS);
  if (cached !== null) {
    return cached;
  }

  if (portfoliosInflight.has(finalUrl)) {
    return portfoliosInflight.get(finalUrl);
  }

  const promise = (async () => {
    const headers = buildAuthHeaders(apiToken);
    const json = await fetchJson(finalUrl, { headers });
    const portfolios = Array.isArray(json?.portfolios) ? json.portfolios : [];

    const map = new Map();
    for (const portfolio of portfolios) {
      const sid = portfolio?.strategy_id ? String(portfolio.strategy_id).trim() : "";
      if (!sid) {
        continue;
      }
      const currentValue = safeNumber(portfolio?.currentValue);
      if (currentValue === null) {
        continue;
      }
      const cashBuffer = safeNumber(portfolio?.cashBuffer) ?? 0;
      const equityValue = currentValue + cashBuffer;
      if (!Number.isFinite(equityValue)) {
        continue;
      }
      map.set(sid, equityValue);
    }

    cacheSet(portfoliosCache, finalUrl, map);
    return map;
  })()
    .catch(() => new Map())
    .finally(() => portfoliosInflight.delete(finalUrl));

  portfoliosInflight.set(finalUrl, promise);
  return promise;
}

async function fetchTradingAppEquityFallback(apiUrl, apiToken) {
  const parsed = parseTradingAppEquityUrl(apiUrl);
  if (!parsed) {
    return null;
  }

  const { origin, userId, strategyId } = parsed;
  const equityMap = await fetchTradingAppPortfolioEquityMap(origin, userId, apiToken);

  if (!equityMap || typeof equityMap.get !== "function") {
    return null;
  }

  const decoded = safeDecodeURIComponent(strategyId);
  const candidates = decoded === strategyId ? [strategyId] : [strategyId, decoded];

  for (const candidate of candidates) {
    const value = equityMap.get(candidate);
    if (value !== undefined && value !== null) {
      return safeNumber(value);
    }
  }

  return null;
}

export function computePriceEntryFromDailySeries(
  points,
  { currency = "USD", intradayPoints = null } = {},
) {
  const dailyPoints = Array.isArray(points) ? points : [];
  const intraday = Array.isArray(intradayPoints) ? intradayPoints : null;

  if (!dailyPoints.length && (!intraday || !intraday.length)) {
    return {
      current: null,
      previous_close: null,
      change: null,
      change_pct: null,
      long_name: null,
      currency,
      price_10d: null,
      price_1y: null,
    };
  }

  const currentSource = intraday && intraday.length ? intraday : dailyPoints;
  const last = currentSource[currentSource.length - 1];
  const current = safeNumber(last?.value);

  // Calculate true intraday: find first point of today (UTC) from intraday points when available.
  let previousClose = null;
  const now = new Date();
  const todayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  if (intraday && intraday.length) {
    for (const point of intraday) {
      if (point.ts >= todayStartMs) {
        previousClose = safeNumber(point.value);
        break;
      }
    }
    if (previousClose === null && intraday.length >= 2) {
      previousClose = safeNumber(intraday[intraday.length - 2].value);
    }
  } else if (dailyPoints.length >= 2) {
    // With daily points only, we can approximate the previous close as yesterday's close.
    previousClose = safeNumber(dailyPoints[dailyPoints.length - 2].value);
  }

  const change =
    current !== null && previousClose !== null ? current - previousClose : null;
  const changePct =
    current !== null && previousClose !== null && previousClose !== 0
      ? ((current / previousClose) - 1) * 100
      : null;

  const tenDaysMs = 10 * 24 * 60 * 60 * 1000;
  const yearMs = 365 * 24 * 60 * 60 * 1000;

  const dailyLast = dailyPoints.length ? dailyPoints[dailyPoints.length - 1] : last;
  const base10dPoint = dailyPoints.length
    ? findPointAtOrBefore(dailyPoints, dailyLast.ts - tenDaysMs)
    : null;
  const base1yPoint = dailyPoints.length
    ? findPointAtOrBefore(dailyPoints, dailyLast.ts - yearMs)
    : null;
  const price10d = base10dPoint ? safeNumber(base10dPoint.value) : null;
  const price1y = base1yPoint ? safeNumber(base1yPoint.value) : null;

  return {
    current,
    previous_close: previousClose,
    change,
    change_pct: changePct,
    long_name: null,
    currency,
    price_10d: price10d,
    price_1y: price1y,
  };
}

export async function fetchCustomApiDailySeries(apiUrl, apiToken, { startDate = null } = {}) {
  const trimmed = typeof apiUrl === "string" ? apiUrl.trim() : "";
  if (!trimmed) {
    return [];
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return [];
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return [];
  }

  if (startDate instanceof Date && !Number.isNaN(startDate.getTime())) {
    url.searchParams.set("startDate", startDate.toISOString());
  }

  const finalUrl = url.toString();
  const cached = cacheGet(seriesCache, finalUrl, SERIES_CACHE_TTL_MS);
  if (cached !== null) {
    return cached;
  }

  if (inflight.has(finalUrl)) {
    return inflight.get(finalUrl);
  }

  const promise = (async () => {
    const headers = buildAuthHeaders(apiToken);
    const json = await fetchJson(finalUrl, { headers });
    const series = normaliseDailySeriesFromJson(json);
    cacheSet(seriesCache, finalUrl, series);
    return series;
  })()
    .catch(() => [])
    .finally(() => inflight.delete(finalUrl));

  inflight.set(finalUrl, promise);
  return promise;
}

export async function fetchCustomApiIntradaySeries(
  apiUrl,
  apiToken,
  { startDate = null, limit = null } = {},
) {
  const trimmed = typeof apiUrl === "string" ? apiUrl.trim() : "";
  if (!trimmed) {
    return [];
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return [];
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return [];
  }

  if (startDate instanceof Date && !Number.isNaN(startDate.getTime())) {
    url.searchParams.set("startDate", startDate.toISOString());
  }
  if (limit !== null && limit !== undefined && !url.searchParams.has("limit")) {
    const parsed = Number(limit);
    if (Number.isFinite(parsed) && parsed > 0) {
      url.searchParams.set("limit", String(Math.floor(parsed)));
    }
  }

  const finalUrl = url.toString();
  const cached = cacheGet(seriesCache, finalUrl, SERIES_CACHE_TTL_MS);
  if (cached !== null) {
    return cached;
  }

  if (inflight.has(finalUrl)) {
    return inflight.get(finalUrl);
  }

  const promise = (async () => {
    const headers = buildAuthHeaders(apiToken);
    const json = await fetchJson(finalUrl, { headers });
    const series = normalisePointSeriesFromJson(json, { maxPoints: 20_000 });
    cacheSet(seriesCache, finalUrl, series);
    return series;
  })()
    .catch(() => [])
    .finally(() => inflight.delete(finalUrl));

  inflight.set(finalUrl, promise);
  return promise;
}

export async function getCustomApiPricesForPositions(docs) {
  const out = {};
  if (!Array.isArray(docs) || !docs.length) {
    return out;
  }

  const items = docs
    .map((doc) => {
      const apiUrl = doc?.api_url;
      if (!apiUrl) {
        return null;
      }
      const id = doc?._id ? String(doc._id) : doc?.id ? String(doc.id) : null;
      if (!id) {
        return null;
      }
      return {
        id,
        apiUrl,
        apiToken: doc?.api_token ?? null,
      };
    })
    .filter(Boolean);

  const MAX_CONCURRENCY = 4;
  let index = 0;
  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      const item = items[current];
      const now = new Date();
      const todayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const intradayStart = new Date(todayStartMs - 36 * 60 * 60 * 1000);

      const [dailySeries, intradaySeries] = await Promise.all([
        fetchCustomApiDailySeries(item.apiUrl, item.apiToken),
        fetchCustomApiIntradaySeries(item.apiUrl, item.apiToken, { startDate: intradayStart, limit: 5000 }),
      ]);

      let priceEntry = computePriceEntryFromDailySeries(dailySeries, { intradayPoints: intradaySeries });
      if (
        priceEntry.current === null &&
        (!dailySeries.length && !intradaySeries.length)
      ) {
        const fallbackEquity = await fetchTradingAppEquityFallback(item.apiUrl, item.apiToken);
        if (fallbackEquity !== null) {
          priceEntry = computePriceEntryFromDailySeries([{ ts: nowMs(), value: fallbackEquity }]);
        }
      }

      out[item.id] = priceEntry;
    }
  });

  await Promise.all(workers);
  return out;
}
