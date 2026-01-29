const DEFAULT_TIMEOUT_MS = 12_000;
const FUNDAMENTALS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const FUNDAMENTALS_TYPES = [
  "annualTotalRevenue",
  "annualDilutedEPS",
  "annualNetIncome",
  "annualStockholdersEquity",
  "annualCurrentAssets",
  "annualInventory",
  "annualCurrentLiabilities",
];

const fundamentalsCache = new Map();
const inflight = new Map();

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
  const res = await fetchWithTimeout(url, options);
  const text = await res.text();
  if (!res.ok) {
    const error = new Error(`HTTP ${res.status} fetching fundamentals`);
    error.status = res.status;
    error.body = text;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    const parseError = new Error("Invalid JSON fetching fundamentals");
    parseError.cause = error;
    parseError.body = text;
    throw parseError;
  }
}

function extractTimeseriesPoints(item, type) {
  const raw = Array.isArray(item?.[type]) ? item[type] : [];
  const points = [];
  for (const entry of raw) {
    const date = entry?.asOfDate;
    const value = safeNumber(entry?.reportedValue?.raw ?? entry?.reportedValue);
    if (!date || value === null) {
      continue;
    }
    points.push({ date, value });
  }
  points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return points;
}

function parseTimeseriesResponse(json) {
  const map = new Map();
  const results = json?.timeseries?.result;
  if (!Array.isArray(results)) {
    return map;
  }
  for (const item of results) {
    const type = item?.meta?.type?.[0];
    if (!type || typeof type !== "string") {
      continue;
    }
    map.set(type, extractTimeseriesPoints(item, type));
  }
  return map;
}

function takeLast(points, count) {
  if (!Array.isArray(points) || !points.length) {
    return [];
  }
  if (!count || count <= 0) {
    return [...points];
  }
  return points.slice(Math.max(0, points.length - count));
}

function computeYoYGrowth(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return [];
  }
  const out = [];
  for (let idx = 1; idx < points.length; idx += 1) {
    const prev = points[idx - 1]?.value ?? null;
    const current = points[idx]?.value ?? null;
    if (prev === null || current === null || prev <= 0) {
      continue;
    }
    out.push({ date: points[idx].date, value: ((current / prev) - 1) * 100 });
  }
  return out;
}

function computeCagrPercent(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return null;
  }
  const first = points[0]?.value ?? null;
  const last = points[points.length - 1]?.value ?? null;
  if (first === null || last === null || first <= 0 || last <= 0) {
    return null;
  }
  const years = points.length - 1;
  if (years <= 0) {
    return null;
  }
  const cagr = Math.pow(last / first, 1 / years) - 1;
  const pct = cagr * 100;
  return Number.isFinite(pct) ? pct : null;
}

function computeMean(values) {
  if (!values.length) {
    return null;
  }
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

function mapByDate(points) {
  const map = new Map();
  for (const point of points || []) {
    if (!point?.date) {
      continue;
    }
    map.set(point.date, point.value);
  }
  return map;
}

function computeRoeSeries(netIncomePoints, equityPoints) {
  const netIncomeByDate = mapByDate(netIncomePoints);
  const equityByDate = mapByDate(equityPoints);
  const dates = Array.from(netIncomeByDate.keys()).filter((date) => equityByDate.has(date));
  dates.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out = [];
  for (const date of dates) {
    const netIncome = safeNumber(netIncomeByDate.get(date));
    const equity = safeNumber(equityByDate.get(date));
    if (netIncome === null || equity === null || equity === 0) {
      continue;
    }
    out.push({ date, value: (netIncome / equity) * 100 });
  }
  return out;
}

function computeLatestQuickRatio(currentAssetsPoints, inventoryPoints, currentLiabilitiesPoints) {
  const assetsByDate = mapByDate(currentAssetsPoints);
  const inventoryByDate = mapByDate(inventoryPoints);
  const liabilitiesByDate = mapByDate(currentLiabilitiesPoints);
  const dates = Array.from(assetsByDate.keys())
    .filter((date) => inventoryByDate.has(date) && liabilitiesByDate.has(date))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  for (let idx = dates.length - 1; idx >= 0; idx -= 1) {
    const date = dates[idx];
    const assets = safeNumber(assetsByDate.get(date));
    const inventory = safeNumber(inventoryByDate.get(date));
    const liabilities = safeNumber(liabilitiesByDate.get(date));
    if (assets === null || inventory === null || liabilities === null || liabilities === 0) {
      continue;
    }
    const quick = (assets - inventory) / liabilities;
    if (!Number.isFinite(quick)) {
      continue;
    }
    return { date, value: quick };
  }
  return { date: null, value: null };
}

async function fetchYahooFundamentalsTimeseries(symbol) {
  const period2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(
    symbol,
  )}?type=${encodeURIComponent(FUNDAMENTALS_TYPES.join(","))}&period1=0&period2=${period2}`;
  return fetchJson(url, {
    headers: { Accept: "application/json,text/plain,*/*" },
  });
}

export async function getFundamentalsSnapshot(symbol) {
  const upper = String(symbol || "").toUpperCase().trim();
  if (!upper) {
    return null;
  }

  const cached = cacheGet(fundamentalsCache, upper, FUNDAMENTALS_CACHE_TTL_MS);
  if (cached) {
    return cached;
  }

  if (inflight.has(upper)) {
    return inflight.get(upper);
  }

  const request = (async () => {
    try {
      const json = await fetchYahooFundamentalsTimeseries(upper);
      const series = parseTimeseriesResponse(json);

      const revenue = series.get("annualTotalRevenue") ?? [];
      const revenueGrowth = computeYoYGrowth(revenue);
      const revenueGrowthRecent = takeLast(revenueGrowth, 5);
      const revenueGrowthMin =
        revenueGrowthRecent.length > 0
          ? Math.min(...revenueGrowthRecent.map((point) => point.value))
          : null;

      const eps = series.get("annualDilutedEPS") ?? [];
      const epsRecent = takeLast(eps, 4);
      const epsLatest = eps.length ? eps[eps.length - 1].value : null;
      const epsCagrPct = computeCagrPercent(epsRecent);

      const netIncome = series.get("annualNetIncome") ?? [];
      const equity = series.get("annualStockholdersEquity") ?? [];
      const roeSeries = computeRoeSeries(netIncome, equity);
      const roeRecent = takeLast(roeSeries, 5);
      const roe5yAvgPct = computeMean(roeRecent.map((point) => point.value));

      const currentAssets = series.get("annualCurrentAssets") ?? [];
      const inventory = series.get("annualInventory") ?? [];
      const currentLiabilities = series.get("annualCurrentLiabilities") ?? [];
      const quick = computeLatestQuickRatio(currentAssets, inventory, currentLiabilities);

      const snapshot = {
        revenueGrowthMinYoY5yPct:
          revenueGrowthMin === null || Number.isNaN(revenueGrowthMin) ? null : revenueGrowthMin,
        epsDiluted: epsLatest === null || Number.isNaN(epsLatest) ? null : epsLatest,
        epsCagrPct,
        roe5yAvgPct,
        quickRatio: quick.value,
      };

      cacheSet(fundamentalsCache, upper, snapshot);
      if (fundamentalsCache.size > 4000) {
        fundamentalsCache.clear();
      }
      return snapshot;
    } catch {
      return null;
    } finally {
      inflight.delete(upper);
    }
  })();

  inflight.set(upper, request);
  return request;
}

export { FUNDAMENTALS_CACHE_TTL_MS };
