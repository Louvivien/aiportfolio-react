import yahooFinance from "yahoo-finance2";
import * as cheerio from "cheerio";

const NEWS_AGENDA_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MS = 10_000;

const DEFAULT_NEWS_PER_SYMBOL = 8;
const DEFAULT_NEWS_LIMIT = 100;
const DEFAULT_NEWS_DAYS_BACK = 14;
const DEFAULT_DAYS_AHEAD = 62;

const cache = new Map();

const BOURSORAMA_BASE_URL = "https://www.boursorama.com";
const BOURSORAMA_NEWS_IDS_BY_SYMBOL = new Map(
  [
    ["AM", "1rPAM"],
    ["AM.PA", "1rPAM"],
    ["EXA", "1rPEXA"],
    ["EXA.PA", "1rPEXA"],
    ["EXENS", "1rPEXENS"],
    ["EXENS.PA", "1rPEXENS"],
    ["HO", "1rPHO"],
    ["HO.PA", "1rPHO"],
    ["LBIRD", "1rPLBIRD"],
    ["LBIRD.PA", "1rPLBIRD"],
    ["NVDA", "NVDA"],
    ["PARRO", "1rPPARRO"],
    ["PARRO.PA", "1rPPARRO"],
    ["RHM", "1zRHM"],
    ["RHM.DE", "1zRHM"],
    ["SAF", "1rPSAF"],
    ["SAF.PA", "1rPSAF"],
    ["SOI", "1rPSOI"],
    ["SOI.PA", "1rPSOI"],
  ],
);

const ZONEBOURSE_BASE_URL = "https://www.zonebourse.com";
const ZONEBOURSE_AGENDA_PATHS_BY_SYMBOL = new Map(
  [
    ["AM", "/cours/action/DASSAULT-AVIATION-5215/agenda/"],
    ["AM.PA", "/cours/action/DASSAULT-AVIATION-5215/agenda/"],
    ["EXA", "/cours/action/EXAIL-TECHNOLOGIES-5158/agenda/"],
    ["EXA.PA", "/cours/action/EXAIL-TECHNOLOGIES-5158/agenda/"],
    ["EXENS", "/cours/action/EXOSENS-170812198/agenda/"],
    ["EXENS.PA", "/cours/action/EXOSENS-170812198/agenda/"],
    ["HAG", "/cours/action/HENSOLDT-AG-112902521/agenda/"],
    ["HO", "/cours/action/THALES-4715/agenda/"],
    ["HO.PA", "/cours/action/THALES-4715/agenda/"],
    ["HY9H", "/cours/action/HENSOLDT-AG-112902521/agenda/"],
    ["HY9H.F", "/cours/action/HENSOLDT-AG-112902521/agenda/"],
    ["LBIRD", "/cours/action/LUMIBIRD-5001/agenda/"],
    ["LBIRD.PA", "/cours/action/LUMIBIRD-5001/agenda/"],
    ["MSF", "/cours/action/MICROSOFT-CORPORATION-4835/agenda/"],
    ["MSF.DE", "/cours/action/MICROSOFT-CORPORATION-4835/agenda/"],
    ["MSFT", "/cours/action/MICROSOFT-CORPORATION-4835/agenda/"],
    ["MTE", "/cours/action/MICRON-TECHNOLOGY-INC-13639/agenda/"],
    ["MTE.DE", "/cours/action/MICRON-TECHNOLOGY-INC-13639/agenda/"],
    ["MU", "/cours/action/MICRON-TECHNOLOGY-INC-13639/agenda/"],
    ["NVDA", "/cours/action/NVIDIA-CORPORATION-57355629/agenda/"],
    ["PARRO", "/cours/action/PARROT-17496/agenda/"],
    ["PARRO.PA", "/cours/action/PARROT-17496/agenda/"],
    ["RHM", "/cours/action/RHEINMETALL-AG-436527/agenda/"],
    ["RHM.DE", "/cours/action/RHEINMETALL-AG-436527/agenda/"],
    ["SAF", "/cours/action/SAFRAN-4696/agenda/"],
    ["SAF.PA", "/cours/action/SAFRAN-4696/agenda/"],
    ["SOI", "/cours/action/SOITEC-4695/agenda/"],
    ["SOI.PA", "/cours/action/SOITEC-4695/agenda/"],
    ["URNU", "/cours/etf/GLOBAL-X-URANIUM-UCITS-ET-136849368/"],
    ["URNU.DE", "/cours/etf/GLOBAL-X-URANIUM-UCITS-ET-136849368/"],
  ],
);

const NASDAQ_SYMBOL_ALIASES = new Map([
  ["MSF", "MSFT"],
  ["MSF.DE", "MSFT"],
  ["MTE", "MU"],
  ["MTE.DE", "MU"],
]);

function nowMs() {
  return Date.now();
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }
  if (nowMs() - entry.ts > NEWS_AGENDA_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  cache.set(key, { ts: nowMs(), value });
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

async function fetchText(url, options = {}) {
  const response = await fetchWithTimeout(url, options);
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} fetching ${url}`);
    error.status = response.status;
    error.body = text;
    throw error;
  }
  return text;
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options);
  try {
    return JSON.parse(text);
  } catch (error) {
    const parseError = new Error(`Invalid JSON from ${url}`);
    parseError.cause = error;
    parseError.body = text;
    throw parseError;
  }
}

function cleanSymbol(value) {
  return String(value || "").toUpperCase().trim();
}

function symbolWithoutMarketSuffix(symbol) {
  return cleanSymbol(symbol).replace(/\.[A-Z0-9]+$/, "");
}

function cleanDisplayText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/â‚¬/g, "€")
    .replace(/Ã©/g, "é")
    .replace(/Ã¨/g, "è")
    .replace(/Ãª/g, "ê")
    .replace(/Ã«/g, "ë")
    .replace(/Ã /g, "à")
    .replace(/Ã¢/g, "â")
    .replace(/Ã´/g, "ô")
    .replace(/Ã¹/g, "ù")
    .replace(/Ã»/g, "û")
    .replace(/Ã§/g, "ç")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueSymbols(symbols) {
  return Array.from(new Set((symbols || []).map(cleanSymbol).filter(Boolean))).sort();
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)));
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

function toDate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const ms = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "object") {
    if (value.raw !== undefined) {
      return toDate(value.raw);
    }
    if (value.fmt !== undefined) {
      return toDate(value.fmt);
    }
    return null;
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDateTime(value) {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

function toIsoDateOnly(value) {
  const iso = toIsoDateTime(value);
  return iso ? iso.slice(0, 10) : null;
}

function toLocalIsoDate(value) {
  const date = toDate(value);
  if (!date) {
    return null;
  }
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return raw.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
  }
}

function mergeSymbols(left, right) {
  return Array.from(new Set([...(left || []), ...(right || [])].filter(Boolean))).sort();
}

function mergeTextList(left, right) {
  return Array.from(
    new Set([...(left || []), ...(right || [])].map(cleanDisplayText).filter(Boolean)),
  );
}

function truncateText(value, maxLength = 280) {
  const text = cleanDisplayText(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function yahooQuoteUrl(symbol) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

function nasdaqEarningsUrl(symbol) {
  return `https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(
    symbol.toLowerCase(),
  )}/earnings`;
}

function resolveNasdaqSymbol(symbol) {
  const upper = cleanSymbol(symbol);
  return NASDAQ_SYMBOL_ALIASES.get(upper) || symbolWithoutMarketSuffix(upper);
}

function zonebourseAgendaUrl(symbol) {
  const upper = cleanSymbol(symbol);
  const path =
    ZONEBOURSE_AGENDA_PATHS_BY_SYMBOL.get(upper) ||
    ZONEBOURSE_AGENDA_PATHS_BY_SYMBOL.get(symbolWithoutMarketSuffix(upper));
  if (!path || !path.endsWith("/agenda/")) {
    return null;
  }
  return `${ZONEBOURSE_BASE_URL}${path}`;
}

function boursoramaNewsUrl(symbol) {
  const upper = cleanSymbol(symbol);
  const id =
    BOURSORAMA_NEWS_IDS_BY_SYMBOL.get(upper) ||
    BOURSORAMA_NEWS_IDS_BY_SYMBOL.get(symbolWithoutMarketSuffix(upper));
  if (id) {
    return `${BOURSORAMA_BASE_URL}/cours/actualites/${encodeURIComponent(id)}/`;
  }

  const base = symbolWithoutMarketSuffix(upper);
  if (!base) {
    return null;
  }
  if (upper.endsWith(".PA")) {
    return `${BOURSORAMA_BASE_URL}/cours/actualites/1rP${encodeURIComponent(base)}/`;
  }
  if (upper.endsWith(".DE") || upper.endsWith(".F")) {
    return `${BOURSORAMA_BASE_URL}/cours/actualites/1z${encodeURIComponent(base)}/`;
  }
  if (/^[A-Z0-9-]+$/.test(base)) {
    return `${BOURSORAMA_BASE_URL}/cours/actualites/${encodeURIComponent(base)}/`;
  }
  return null;
}

function absoluteBoursoramaUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  return `${BOURSORAMA_BASE_URL}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function buildNewsKeys(item) {
  const keys = [];
  const uuid = normalizeText(item.uuid);
  if (uuid) {
    keys.push(`uuid:${uuid}`);
  }
  const url = normalizeUrl(item.url);
  if (url) {
    keys.push(`url:${url}`);
  }
  const title = normalizeText(item.title);
  if (title) {
    keys.push(`title-publisher:${title}:${normalizeText(item.publisher)}`);
    keys.push(`title:${title}`);
  }
  return keys.length
    ? keys
    : [`fallback:${normalizeText(item.date)}:${normalizeText(item.publisher)}`];
}

function buildNewsKey(item) {
  return buildNewsKeys(item)[0];
}

function isDateBetween(dateValue, start, end) {
  const date = toDate(dateValue);
  if (!date) {
    return false;
  }
  return date >= start && date <= end;
}

function mapSearchNews(symbol, rawItem) {
  const title = typeof rawItem?.title === "string" ? rawItem.title.trim() : "";
  const date = toIsoDateTime(rawItem?.providerPublishTime);
  if (!title || !date) {
    return null;
  }

  const relatedTickers = Array.isArray(rawItem?.relatedTickers)
    ? rawItem.relatedTickers.map(cleanSymbol).filter(Boolean)
    : [];

  return {
    id: "",
    title,
    date,
    symbols: mergeSymbols([symbol], relatedTickers),
    publisher: rawItem?.publisher ?? null,
    url: rawItem?.link ?? null,
    source: "Yahoo Finance",
    uuid: rawItem?.uuid ?? null,
  };
}

function isLowValueGoogleNewsTitle(title) {
  return [
    /cours action/i,
    /cotation bourse/i,
    /cotation euronext/i,
    /prix de l'action/i,
    /-\s*Turbo\s*\|/i,
    /stock price,\s*quote\s*&\s*chart/i,
    /stock chart\s*\|/i,
    /technical analysis\s*\|/i,
  ].some((pattern) => pattern.test(title));
}

async function fetchGoogleNews(symbol, limit) {
  const query = `"${symbol}" actualité bourse`;
  const params = new URLSearchParams({
    q: query,
    hl: "fr",
    gl: "FR",
    ceid: "FR:fr",
  });
  const rss = await fetchText(`https://news.google.com/rss/search?${params.toString()}`, {
    headers: {
      Accept: "application/rss+xml,application/xml,text/xml,*/*",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    },
  });
  const $ = cheerio.load(rss, { xmlMode: true });
  const items = [];

  $("item").each((_, element) => {
    if (items.length >= limit) {
      return false;
    }
    const node = $(element);
    const title = node.find("title").first().text().trim();
    const link = node.find("link").first().text().trim();
    const date = toIsoDateTime(node.find("pubDate").first().text().trim());
    const publisher = node.find("source").first().text().trim() || null;

    if (!title || !date || isLowValueGoogleNewsTitle(title)) {
      return undefined;
    }

    items.push({
      id: "",
      title,
      date,
      symbols: [symbol],
      publisher,
      url: link || null,
      source: "Google News",
      uuid: null,
    });
    return undefined;
  });

  return items;
}

function parseBoursoramaNewsDate(dateValue, timeValue) {
  const dateText = cleanDisplayText(dateValue);
  const timeText = cleanDisplayText(timeValue);
  const dateMatch = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dateText);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeText);
  if (!dateMatch || !timeMatch) {
    return null;
  }

  const day = dateMatch[1];
  const month = dateMatch[2];
  const year = dateMatch[3];
  const hour = timeMatch[1];
  const minute = timeMatch[2];
  const monthNumber = Number(month);
  const offset = monthNumber >= 4 && monthNumber <= 10 ? "+02:00" : "+01:00";
  return toIsoDateTime(`${year}-${month}-${day}T${hour}:${minute}:00${offset}`);
}

async function fetchBoursoramaNews(symbol, limit) {
  const url = boursoramaNewsUrl(symbol);
  if (!url) {
    return [];
  }

  const html = await fetchText(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    },
  });
  const $ = cheerio.load(html);
  const items = [];

  $(".c-list-details-news__line").each((_, element) => {
    if (items.length >= limit) {
      return false;
    }

    const node = $(element);
    const titleNode = node.find(".c-list-details-news__subject[href]").first();
    const title = cleanDisplayText(titleNode.attr("title") || titleNode.text());
    const href = absoluteBoursoramaUrl(titleNode.attr("href"));
    const times = node
      .find(".c-source__time")
      .map((__, timeNode) => cleanDisplayText($(timeNode).text()))
      .get();
    const date = parseBoursoramaNewsDate(times[0], times[1]);
    const publisher = cleanDisplayText(node.find(".c-source__name").first().text()) || "Boursorama";

    if (!title || !date || !href || isLowValueGoogleNewsTitle(title)) {
      return undefined;
    }

    items.push({
      id: "",
      title,
      date,
      symbols: [symbol],
      publisher,
      url: href,
      source: "Boursorama",
      uuid: null,
    });
    return undefined;
  });

  return items;
}

function isNasdaqEligibleSymbol(symbol) {
  return /^[A-Z][A-Z0-9-]*$/.test(symbol);
}

function formatNasdaqTimeLabel(value) {
  switch (cleanDisplayText(value).toLowerCase()) {
    case "time-after-hours":
      return "Après clôture";
    case "time-pre-market":
      return "Avant ouverture";
    case "time-not-supplied":
    case "":
      return null;
    default:
      return cleanDisplayText(value) || null;
  }
}

function parseNasdaqAsOfDateOnly(value) {
  const raw = String(value || "").trim();
  const match = /^[A-Za-z]{3},\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/.exec(raw);
  if (match) {
    const monthIndex = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ].indexOf(match[1].toLowerCase());
    if (monthIndex !== -1) {
      const year = match[3];
      const month = String(monthIndex + 1).padStart(2, "0");
      const day = String(Number(match[2])).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
  }

  return toIsoDateOnly(value);
}

async function fetchNasdaqEarningsAgenda(symbol, start, end) {
  const nasdaqSymbol = resolveNasdaqSymbol(symbol);
  if (!isNasdaqEligibleSymbol(nasdaqSymbol)) {
    return [];
  }

  const params = new URLSearchParams({ symbol: nasdaqSymbol });
  const json = await fetchJson(`https://api.nasdaq.com/api/calendar/earnings?${params.toString()}`, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    },
  });
  const eventDate = parseNasdaqAsOfDateOnly(json?.data?.asOf);
  const rows = Array.isArray(json?.data?.rows) ? json.data.rows : [];
  const startDate = toLocalIsoDate(start);
  const endDate = toLocalIsoDate(end);
  if (!eventDate || !rows.length || eventDate < startDate || eventDate > endDate) {
    return [];
  }

  return rows
    .filter((row) => cleanSymbol(row?.symbol) === nasdaqSymbol)
    .map((row) => {
      const companyName = cleanDisplayText(row?.name) || null;
      const fiscalQuarterEnding = cleanDisplayText(row?.fiscalQuarterEnding);
      const details = [
        companyName ? `Société: ${companyName}` : null,
        fiscalQuarterEnding ? `Période fiscale: ${fiscalQuarterEnding}` : null,
        cleanDisplayText(row?.epsForecast) ? `BPA estimé: ${cleanDisplayText(row.epsForecast)}` : null,
        cleanDisplayText(row?.noOfEsts)
          ? `Nombre d'estimations: ${cleanDisplayText(row.noOfEsts)}`
          : null,
        cleanDisplayText(row?.lastYearRptDt)
          ? `Dernière publication comparable: ${cleanDisplayText(row.lastYearRptDt)}`
          : null,
        cleanDisplayText(row?.lastYearEPS)
          ? `BPA comparable N-1: ${cleanDisplayText(row.lastYearEPS)}`
          : null,
      ].filter(Boolean);

      return {
        id: `agenda:${symbol}:earnings:${eventDate}:nasdaq`,
        title: `${symbol} résultats${fiscalQuarterEnding ? ` (${fiscalQuarterEnding})` : ""}`,
        date: eventDate,
        end_date: null,
        symbols: [symbol],
        event_type: "earnings",
        source: "Nasdaq",
        url: nasdaqEarningsUrl(nasdaqSymbol),
        company_name: companyName,
        time_label: formatNasdaqTimeLabel(row?.time),
        details,
      };
    })
    .filter((event) => Boolean(event.date));
}

function parseZonebourseAgendaDate(value, start) {
  const raw = cleanDisplayText(value);
  if (!raw) {
    return null;
  }

  if (/^aujourd['’]?hui$/i.test(raw)) {
    return toLocalIsoDate(start);
  }

  const dateMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (dateMatch) {
    const day = String(Number(dateMatch[1])).padStart(2, "0");
    const month = String(Number(dateMatch[2])).padStart(2, "0");
    return `${dateMatch[3]}-${month}-${day}`;
  }

  return toIsoDateOnly(raw);
}

function inferAgendaEventType(title) {
  const normalized = normalizeText(title);
  if (normalized.includes("détachement de dividende")) {
    return "ex_dividend";
  }
  if (normalized.includes("publication des résultats")) {
    return "earnings";
  }
  if (normalized.includes("présentation des résultats")) {
    return "earnings_call";
  }
  if (normalized.includes("publication évolution de l'activité")) {
    return "sales_update";
  }
  if (normalized.includes("assemblée générale annuelle")) {
    return "annual_meeting";
  }
  if (normalized.includes("assemblée générale")) {
    return "shareholder_meeting";
  }
  if (normalized.includes("présentation aux actionnaires")) {
    return "shareholder_presentation";
  }
  if (normalized.includes("réunion du conseil")) {
    return "board_meeting";
  }
  if (normalized.includes("journée analyste") || normalized.includes("investisseur")) {
    return "investor_day";
  }
  return "event";
}

function extractZonebourseCompanyName($) {
  const ogTitle = cleanDisplayText($("meta[property='og:title']").attr("content"));
  if (ogTitle) {
    return ogTitle.split(":")[0]?.trim() || null;
  }
  const title = cleanDisplayText($("title").first().text());
  return title ? title.split(":")[0]?.trim() || null : null;
}

async function fetchZonebourseAgenda(symbol, start, end) {
  const url = zonebourseAgendaUrl(symbol);
  if (!url) {
    return [];
  }

  const html = await fetchText(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    },
  });
  const $ = cheerio.load(html);
  const companyName = extractZonebourseCompanyName($);
  const events = [];

  $("#next-events-card table tbody tr").each((_, row) => {
    const cells = $(row).find("td").toArray();
    if (cells.length < 2) {
      return undefined;
    }

    const date = parseZonebourseAgendaDate($(cells[0]).text(), start);
    const titleElement = $(cells[1]).find("[title]").first();
    const title = cleanDisplayText(titleElement.text() || $(cells[1]).text());
    const detail = truncateText(titleElement.attr("title"));
    const timeLabel = cells[2] ? cleanDisplayText($(cells[2]).text()) || null : null;

    if (!date || !title || !isDateBetween(date, start, end)) {
      return undefined;
    }

    events.push({
      id: `agenda:${symbol}:${inferAgendaEventType(title)}:${date}:zonebourse:${normalizeText(title)}`,
      title,
      date,
      end_date: null,
      symbols: [symbol],
      event_type: inferAgendaEventType(title),
      source: "Zonebourse",
      url,
      company_name: companyName,
      time_label: timeLabel,
      details: mergeTextList(
        companyName ? [`Société: ${companyName}`] : [],
        detail && normalizeText(detail) !== normalizeText(title) ? [detail] : [],
      ),
    });
    return undefined;
  });

  return events;
}

function agendaEvent(symbol, type, title, dateValue, endDateValue = null) {
  const date = toIsoDateOnly(dateValue);
  if (!date) {
    return null;
  }
  const endDate = toIsoDateOnly(endDateValue);
  return {
    id: `agenda:${symbol}:${type}:${date}:${endDate || ""}`,
    title,
    date,
    end_date: endDate && endDate !== date ? endDate : null,
    symbols: [symbol],
    event_type: type,
    source: "Yahoo Finance",
    url: yahooQuoteUrl(symbol),
    company_name: null,
    time_label: null,
    details: [],
  };
}

function addEventIfInRange(events, event, start, end) {
  if (!event || !isDateBetween(event.date, start, end)) {
    return;
  }
  events.push(event);
}

function addEarningsEvent(events, symbol, dates, start, end) {
  const validDates = (dates || [])
    .map((value) => ({ value, date: toDate(value) }))
    .filter((entry) => entry.date)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (!validDates.length) {
    return;
  }

  const first = validDates[0].value;
  const last = validDates[validDates.length - 1].value;
  const event = agendaEvent(symbol, "earnings", `${symbol} earnings`, first, last);
  addEventIfInRange(events, event, start, end);
}

function extractAgenda(symbol, quote, summary, start, end) {
  const events = [];
  const calendar = summary?.calendarEvents;
  const earningsDates = Array.isArray(calendar?.earnings?.earningsDate)
    ? calendar.earnings.earningsDate
    : [];

  if (earningsDates.length) {
    addEarningsEvent(events, symbol, earningsDates, start, end);
  } else {
    const quoteEarningsDates = [
      quote?.earningsTimestampStart,
      quote?.earningsTimestamp,
      quote?.earningsTimestampEnd,
    ].filter(Boolean);
    addEarningsEvent(events, symbol, quoteEarningsDates, start, end);
  }

  addEventIfInRange(
    events,
    agendaEvent(symbol, "ex_dividend", `${symbol} ex-dividend date`, calendar?.exDividendDate),
    start,
    end,
  );
  addEventIfInRange(
    events,
    agendaEvent(
      symbol,
      "dividend",
      `${symbol} dividend payment`,
      calendar?.dividendDate ?? quote?.dividendDate,
    ),
    start,
    end,
  );

  return events;
}

function isSameFallbackAgendaEvent(fallback, preferred) {
  if (!fallback || !preferred || fallback.date !== preferred.date) {
    return false;
  }
  const fallbackSymbols = fallback.symbols || [];
  const preferredSymbols = preferred.symbols || [];
  const hasSameSymbol = fallbackSymbols.some((symbol) => preferredSymbols.includes(symbol));
  if (!hasSameSymbol) {
    return false;
  }

  if (fallback.event_type === preferred.event_type) {
    return true;
  }
  return fallback.event_type === "earnings" && preferred.event_type === "earnings";
}

function removeFallbackAgendaDuplicates(fallbackItems, preferredItems) {
  if (!preferredItems.length) {
    return fallbackItems;
  }
  return fallbackItems.filter(
    (item) => !preferredItems.some((preferred) => isSameFallbackAgendaEvent(item, preferred)),
  );
}

async function fetchSymbolNewsAgenda(symbol, options, start, end) {
  const [
    searchResult,
    quoteResult,
    summaryResult,
    googleNewsResult,
    boursoramaNewsResult,
    nasdaqResult,
    zonebourseResult,
  ] = await Promise.allSettled([
    yahooFinance.search(symbol, {
      quotesCount: 0,
      newsCount: options.newsPerSymbol,
      enableFuzzyQuery: false,
      lang: "fr-FR",
      region: "FR",
    }),
    yahooFinance.quote(symbol),
    yahooFinance.quoteSummary(
      symbol,
      { modules: ["calendarEvents"] },
      { validateResult: false },
    ),
    fetchGoogleNews(symbol, options.newsPerSymbol),
    fetchBoursoramaNews(symbol, options.newsPerSymbol),
    fetchNasdaqEarningsAgenda(symbol, start, end),
    fetchZonebourseAgenda(symbol, start, end),
  ]);

  const search = searchResult.status === "fulfilled" ? searchResult.value : null;
  const quote = quoteResult.status === "fulfilled" ? quoteResult.value : null;
  const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
  const googleNews = googleNewsResult.status === "fulfilled" ? googleNewsResult.value : [];
  const boursoramaNews =
    boursoramaNewsResult.status === "fulfilled" ? boursoramaNewsResult.value : [];
  const nasdaqAgenda = nasdaqResult.status === "fulfilled" ? nasdaqResult.value : [];
  const zonebourseAgenda = zonebourseResult.status === "fulfilled" ? zonebourseResult.value : [];

  const newsCutoff = new Date(start);
  newsCutoff.setDate(newsCutoff.getDate() - options.newsDaysBack);

  const yahooNews = (Array.isArray(search?.news) ? search.news : [])
    .map((item) => mapSearchNews(symbol, item))
    .filter(Boolean);
  const news = [...boursoramaNews, ...googleNews, ...yahooNews]
    .filter((item) => item && isDateBetween(item.date, newsCutoff, end));
  const yahooAgenda = removeFallbackAgendaDuplicates(
    extractAgenda(symbol, quote, summary, start, end),
    zonebourseAgenda,
  );
  const filteredNasdaqAgenda = removeFallbackAgendaDuplicates(nasdaqAgenda, zonebourseAgenda);
  const agenda = [...zonebourseAgenda, ...yahooAgenda, ...filteredNasdaqAgenda];
  const hasAnyData = news.length > 0 || agenda.length > 0;

  return {
    news,
    agenda,
    error:
      !hasAnyData &&
      searchResult.status === "rejected" &&
      quoteResult.status === "rejected" &&
      summaryResult.status === "rejected" &&
      googleNewsResult.status === "rejected" &&
      boursoramaNewsResult.status === "rejected" &&
      nasdaqResult.status === "rejected" &&
      zonebourseResult.status === "rejected"
        ? "No market data available"
        : null,
  };
}

function dedupeNews(items) {
  const map = new Map();
  const out = [];
  let duplicateCount = 0;

  for (const item of items) {
    const keys = buildNewsKeys(item);
    const existing = keys.map((key) => map.get(key)).find(Boolean);
    if (existing) {
      duplicateCount += 1;
      existing.symbols = mergeSymbols(existing.symbols, item.symbols);
      existing.publisher = existing.publisher || item.publisher || null;
      existing.source = existing.source || item.source || null;
      existing.url = existing.url || item.url || null;
      continue;
    }
    const normalized = {
      ...item,
      id: buildNewsKey(item),
      symbols: mergeSymbols(item.symbols, []),
    };
    out.push(normalized);
    keys.forEach((key) => map.set(key, normalized));
  }

  return {
    items: out.sort((a, b) => {
      const left = toDate(a.date)?.getTime() ?? 0;
      const right = toDate(b.date)?.getTime() ?? 0;
      return right - left;
    }),
    duplicateCount,
  };
}

function dedupeAgenda(items) {
  const map = new Map();
  let duplicateCount = 0;

  for (const item of items) {
    const itemSymbols = mergeSymbols(item.symbols, []);
    const key = `${itemSymbols.join(",")}:${item.event_type}:${item.date}:${item.end_date || ""}:${normalizeText(
      item.title,
    )}`;
    const existing = map.get(key);
    if (existing) {
      duplicateCount += 1;
      existing.symbols = mergeSymbols(existing.symbols, item.symbols);
      existing.details = mergeTextList(existing.details, item.details);
      existing.time_label = existing.time_label || item.time_label || null;
      existing.company_name = existing.company_name || item.company_name || null;
      existing.url = existing.url || item.url || null;
      existing.source = existing.source || item.source || null;
      existing.title = existing.symbols.length > 1
        ? `${existing.symbols.join(", ")} ${item.title.replace(/^[A-Z0-9.-]+\s+/, "")}`
        : existing.title;
      continue;
    }
    map.set(key, {
      ...item,
      id: `agenda:${key}`,
      symbols: itemSymbols,
      details: mergeTextList(item.details, []),
      time_label: item.time_label || null,
      company_name: item.company_name || null,
    });
  }

  return {
    items: Array.from(map.values()).sort((a, b) => {
      const left = toDate(a.date)?.getTime() ?? 0;
      const right = toDate(b.date)?.getTime() ?? 0;
      return left - right;
    }),
    duplicateCount,
  };
}

export async function getNewsAgendaForSymbols(symbols, options = {}) {
  const normalizedSymbols = uniqueSymbols(symbols);
  const normalizedOptions = {
    newsPerSymbol: clampNumber(
      options.newsPerSymbol,
      DEFAULT_NEWS_PER_SYMBOL,
      1,
      10,
    ),
    newsLimit: clampNumber(options.newsLimit, DEFAULT_NEWS_LIMIT, 1, 100),
    newsDaysBack: clampNumber(
      options.newsDaysBack,
      DEFAULT_NEWS_DAYS_BACK,
      1,
      365,
    ),
    daysAhead: clampNumber(options.daysAhead, DEFAULT_DAYS_AHEAD, 1, 730),
  };

  const cacheKey = JSON.stringify({ symbols: normalizedSymbols, ...normalizedOptions });
  const cached = cacheGet(cacheKey);
  if (cached) {
    return cached;
  }

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + normalizedOptions.daysAhead);

  const perSymbol = await mapWithConcurrency(
    normalizedSymbols,
    MAX_CONCURRENCY,
    async (symbol) => {
      try {
        return [symbol, await fetchSymbolNewsAgenda(symbol, normalizedOptions, start, end)];
      } catch {
        return [symbol, { news: [], agenda: [], error: "No market data available" }];
      }
    },
  );

  const errors = {};
  const news = [];
  const agenda = [];
  perSymbol.forEach(([symbol, result]) => {
    if (result?.error) {
      errors[symbol] = result.error;
    }
    news.push(...(result?.news || []));
    agenda.push(...(result?.agenda || []));
  });

  const dedupedNews = dedupeNews(news);
  const dedupedAgenda = dedupeAgenda(agenda);
  const value = {
    generated_at: new Date().toISOString(),
    symbols: normalizedSymbols,
    news: dedupedNews.items.slice(0, normalizedOptions.newsLimit),
    agenda: dedupedAgenda.items,
    deduped_count: dedupedNews.duplicateCount + dedupedAgenda.duplicateCount,
    errors,
  };

  cacheSet(cacheKey, value);
  return value;
}
