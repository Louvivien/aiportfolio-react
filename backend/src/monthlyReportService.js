import { positionLots, lotContribution, sum, previousDay } from "./finance.js";
import { loadFxRates, currencyConverter } from "./fxService.js";
import { ObjectId } from "mongodb";
import { getCollections } from "./db.js";
import { fetchCustomApiDailySeries } from "./customApiService.js";
import { getPrices, getPriceHistory } from "./priceService.js";
import {
  ensureArray,
  normaliseNumber,
  toIsoDateTime,
  toObjectId,
  uniqueUppercaseSymbols,
} from "./utils.js";

const MONTHLY_REPORT_VERSION = 4;
let indexPromise;
const generatingReports = new Map();

const pad2 = (value) => String(value).padStart(2, "0");

function monthKeyFromParts(year, monthIndex) {
  return `${year}-${pad2(monthIndex + 1)}`;
}

function monthParts(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || "").trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    return null;
  }
  return { year, monthIndex: monthNumber - 1, key: `${year}-${pad2(monthNumber)}` };
}

function dateOnlyUtc(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

function monthBounds(month) {
  const parts = monthParts(month);
  if (!parts) {
    return null;
  }
  const { year, monthIndex, key } = parts;
  return {
    month: key,
    periodStart: dateOnlyUtc(year, monthIndex, 1),
    periodEnd: dateOnlyUtc(year, monthIndex + 1, 0),
    historyStart: new Date(Date.UTC(year, monthIndex, -7)),
  };
}

function currentMonthKey(referenceDate = new Date()) {
  return monthKeyFromParts(referenceDate.getFullYear(), referenceDate.getMonth());
}

export function latestCompletedMonthKey(referenceDate = new Date()) {
  const date = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  date.setMonth(date.getMonth() - 1);
  return monthKeyFromParts(date.getFullYear(), date.getMonth());
}

function completedMonthsSinceYearStart(referenceDate = new Date()) {
  const latest = monthParts(latestCompletedMonthKey(referenceDate));
  if (!latest || latest.year !== referenceDate.getFullYear()) {
    return [];
  }
  return Array.from({ length: latest.monthIndex + 1 }, (_, monthIndex) =>
    monthKeyFromParts(referenceDate.getFullYear(), monthIndex),
  );
}

export function normalizeReportMonth(value) {
  return monthParts(value)?.key ?? null;
}

function isCompletedMonth(month, referenceDate = new Date()) {
  const normalized = normalizeReportMonth(month);
  return Boolean(normalized && normalized < currentMonthKey(referenceDate));
}

async function ensureMonthlyReportIndexes() {
  if (!indexPromise) {
    const { monthlyReports } = getCollections();
    indexPromise = monthlyReports.createIndex({ month: 1 }, { unique: true }).catch((error) => {
      indexPromise = undefined;
      throw error;
    });
  }
  await indexPromise;
}

function reportError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function safeNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const num = normaliseNumber(value, NaN);
  return Number.isFinite(num) ? num : fallback;
}

function sortHistory(points) {
  return (Array.isArray(points) ? points : [])
    .map((point) => {
      const date =
        typeof point?.date === "string"
          ? point.date.slice(0, 10)
          : point?.ts
            ? new Date(point.ts).toISOString().slice(0, 10)
            : null;
      const close = safeNumber(point?.close ?? point?.value, null);
      return date && close !== null && close > 0 ? { date, close } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function performancePercent(startValue, performanceValue) {
  return startValue > 0 && performanceValue !== null ? (performanceValue / startValue) * 100 : null;
}

function buildPerformance(startValue, endValue) {
  const performanceValue = endValue === null || startValue === null ? null : endValue - startValue;
  return {
    start_value: startValue,
    end_value: endValue,
    performance_value: performanceValue,
    performance_pct: performancePercent(startValue, performanceValue),
  };
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

function historyPeriodForMonth(bounds) {
  const [year, month] = bounds.month.split("-").map(Number);
  const now = new Date();
  const diffMonths = (now.getFullYear() - year) * 12 + (now.getMonth() + 1 - month);
  return `${Math.max(2, diffMonths + 2)}mo`;
}

async function loadTagNames(docs) {
  const { tags } = getCollections();
  const ids = Array.from(
    new Set(docs.flatMap((doc) => ensureArray(doc?.tags).map((tag) => String(tag)))),
  )
    .map((id) => toObjectId(id))
    .filter(Boolean);
  if (!ids.length) {
    return new Map();
  }
  const tagDocs = await tags.find({ _id: { $in: ids } }).toArray();
  return new Map(tagDocs.map((doc) => [String(doc._id), doc.name]));
}

async function loadHistories(docs, bounds) {
  const stockDocs = docs.filter((doc) => !doc?.api_url);
  const apiDocs = docs.filter((doc) => Boolean(doc?.api_url));
  const symbols = uniqueUppercaseSymbols(stockDocs);
  const [stockHistory, stockPrices] = symbols.length
    ? await Promise.all([
        getPriceHistory(symbols, {
          period: historyPeriodForMonth(bounds),
          interval: "1d",
          requiredDates: [previousDay(bounds.periodStart), bounds.periodEnd],
        }),
        getPrices(symbols),
      ])
    : [{}, {}];

  const apiPairs = apiDocs.length
    ? await mapWithConcurrency(apiDocs, 4, async (doc) => {
        const id = doc?._id ? String(doc._id) : null;
        if (!id || !doc?.api_url) {
          return [id, []];
        }
        const points = await fetchCustomApiDailySeries(doc.api_url, doc.api_token, {
          startDate: bounds.historyStart,
        });
        return [id, points];
      })
    : [];

  const apiHistory = {};
  apiPairs.forEach(([id, points]) => {
    if (id) {
      apiHistory[id] = sortHistory(points);
    }
  });

  const normalizedStockHistory = {};
  Object.entries(stockHistory || {}).forEach(([symbol, points]) => {
    normalizedStockHistory[symbol] = sortHistory(points);
  });

  return { stockHistory: normalizedStockHistory, apiHistory, stockPrices };
}

function positionLabel(doc, priceEntry = null) {
  return doc?.display_name || priceEntry?.long_name || doc?.long_name || doc?.symbol || "Position";
}

function positionCurrency(doc, priceEntry = null) {
  return priceEntry?.currency || doc?.currency || (doc?.api_url ? "USD" : null);
}

function addAggregate(bucket, row) {
  bucket.start_value = sum([bucket.start_value, row.start_value]);
  bucket.end_value = sum([bucket.end_value, row.end_value]);
  bucket.performance_value = sum([bucket.performance_value, row.performance_value]);
}

function responseDate(value) {
  return toIsoDateTime(value);
}

function normalizeStoredReport(doc) {
  if (!doc) {
    return null;
  }
  return {
    ...doc,
    _id: doc._id ? String(doc._id) : undefined,
    id: doc._id ? String(doc._id) : doc.id,
    generated_at: responseDate(doc.generated_at),
    created_at: responseDate(doc.created_at),
    updated_at: responseDate(doc.updated_at),
  };
}

function listItem(doc) {
  return {
    id: doc._id ? String(doc._id) : doc.id,
    month: doc.month,
    period_start: doc.period_start,
    period_end: doc.period_end,
    generated_at: responseDate(doc.generated_at),
    performance_value: doc.summary?.performance_value ?? null,
    performance_pct: doc.summary?.performance_pct ?? null,
    start_value: doc.summary?.start_value ?? null,
    end_value: doc.summary?.end_value ?? null,
    positions_count: doc.summary?.positions_count ?? 0,
    tags_count: doc.summary?.tags_count ?? 0,
  };
}

async function buildMonthlyReportDocument(month) {
  const bounds = monthBounds(month);
  if (!bounds) {
    throw reportError(400, "Invalid report month. Expected YYYY-MM.");
  }
  if (!isCompletedMonth(bounds.month)) {
    throw reportError(400, "Monthly reports are only available for completed months.");
  }

  const { positions } = getCollections();
  const docs = await positions.find().limit(1000).toArray();
  const [tagNameMap, histories, fx] = await Promise.all([
    loadTagNames(docs),
    loadHistories(docs, bounds),
    loadFxRates(),
  ]);

  return buildMonthlyReportFromData(month, docs, tagNameMap, histories, fx);
}

export function buildMonthlyReportFromData(month, docs, tagNameMap, histories, fx) {
  const bounds = monthBounds(month);
  if (!bounds) throw reportError(400, "Invalid report month. Expected YYYY-MM.");
  const positionBuckets = new Map();
  const tagBuckets = new Map();
  const skipped = [];
  let lotsIncluded = 0;
  let lotsSkipped = 0;
  let incomplete = false;
  const incompleteTags = new Set();

  for (const doc of docs) {
    const positionId = doc?._id ? String(doc._id) : null;
    const symbol = String(doc?.symbol || "").toUpperCase();
    const apiKey = doc?._id ? String(doc._id) : null;
    const series = doc?.api_url && apiKey
      ? histories.apiHistory[apiKey] ?? []
      : histories.stockHistory[symbol] ?? [];
    const priceEntry = doc?.api_url ? null : histories.stockPrices[symbol] ?? null;
    const tagNames = ensureArray(doc?.tags)
      .map((id) => tagNameMap.get(String(id)))
      .filter(Boolean);
    const lots = positionLots(doc);
    const convert = currencyConverter(fx, positionCurrency(doc, priceEntry));
    const notes = [];
    let includedForPosition = false;

    const bucket = {
      position_id: positionId,
      symbol,
      name: positionLabel(doc, priceEntry),
      currency: "EUR",
      quote_currency: positionCurrency(doc, priceEntry),
      tags: tagNames,
      quantity: 0,
      start_value: 0,
      end_value: 0,
      performance_value: 0,
      performance_pct: null,
      start_date: null,
      end_date: null,
      start_price: null,
      end_price: null,
      start_basis: null,
      end_basis: null,
      included_lots: 0,
      skipped_lots: 0,
      notes,
      incomplete: false,
      lots: [],
    };

    for (const lot of lots) {
      const contribution = lotContribution(lot, series, bounds, convert);
      bucket.lots.push({ lot_id: lot.id ?? null, purchase_date: lot.purchase_date,
        closing_date: lot.closing_date, ...contribution });
      if (contribution.skipped) {
        if (contribution.incomplete) {
          incomplete = true;
          bucket.incomplete = true;
          tagNames.forEach((tag) => incompleteTags.add(tag));
        }
        lotsSkipped += 1;
        bucket.skipped_lots += 1;
        if (contribution.reason) {
          notes.push(contribution.reason);
        }
        continue;
      }

      includedForPosition = true;
      lotsIncluded += 1;
      bucket.included_lots += 1;
      bucket.quantity += contribution.quantity;
      bucket.start_value += contribution.start_value;
      bucket.end_value += contribution.end_value;
      bucket.performance_value += contribution.performance_value;
      if (!bucket.start_date || contribution.start_date < bucket.start_date) {
        bucket.start_date = contribution.start_date;
      }
      if (!bucket.end_date || contribution.end_date > bucket.end_date) {
        bucket.end_date = contribution.end_date;
      }
      bucket.start_basis =
        bucket.start_basis === null
          ? contribution.start_basis
          : bucket.start_basis === contribution.start_basis
            ? bucket.start_basis
            : "mixed";
      bucket.end_basis =
        bucket.end_basis === null
          ? contribution.end_basis
          : bucket.end_basis === contribution.end_basis
            ? bucket.end_basis
            : "mixed";
    }

    bucket.coverage = buildPerformance(bucket.start_value, bucket.end_value);
    if (!includedForPosition) {
      skipped.push({
        position_id: positionId,
        symbol,
        name: positionLabel(doc, priceEntry),
        reason: notes[0] || "No eligible lot for report period.",
        incomplete: bucket.incomplete,
      });
      continue;
    }

    if (bucket.incomplete) {
      bucket.start_value = null;
      bucket.end_value = null;
      bucket.performance_value = null;
    }
    bucket.performance_pct = performancePercent(bucket.start_value, bucket.performance_value);
    bucket.start_price = bucket.quantity && bucket.start_value !== null ? bucket.start_value / bucket.quantity : null;
    bucket.end_price = bucket.quantity && bucket.end_value !== null ? bucket.end_value / bucket.quantity : null;
    bucket.notes = Array.from(new Set(notes)).slice(0, 3);
    positionBuckets.set(positionId || symbol || new ObjectId().toString(), bucket);

    for (const tag of tagNames) {
      const tagBucket =
        tagBuckets.get(tag) ||
        tagBuckets
          .set(tag, {
            tag,
            start_value: 0,
            end_value: 0,
            performance_value: 0,
            performance_pct: null,
            positions_count: 0,
            _positions: new Set(),
            coverage: { start_value: 0, end_value: 0, performance_value: 0 },
          })
          .get(tag);
      addAggregate(tagBucket, bucket);
      addAggregate(tagBucket.coverage, bucket.coverage);
      tagBucket._positions.add(positionId || symbol);
    }
  }

  const positionsOutput = Array.from(positionBuckets.values())
    .map((row) => ({
      ...row,
      performance_pct: performancePercent(row.start_value, row.performance_value),
    }))
    .sort((a, b) => Math.abs(b.performance_value) - Math.abs(a.performance_value));

  const tagsOutput = Array.from(tagBuckets.values())
    .map((row) => ({
      tag: row.tag,
      start_value: row.start_value,
      end_value: row.end_value,
      performance_value: row.performance_value,
      performance_pct: performancePercent(row.start_value, row.performance_value),
      positions_count: row._positions.size,
      incomplete: incompleteTags.has(row.tag),
      coverage: buildPerformance(row.coverage.start_value, row.coverage.end_value),
      ...(incompleteTags.has(row.tag) ? { start_value: null, end_value: null, performance_value: null, performance_pct: null } : {}),
    }))
    .sort((a, b) => Math.abs(b.performance_value) - Math.abs(a.performance_value));

  const totalStart = sum(positionsOutput.map((row) => row.start_value));
  const totalEnd = sum(positionsOutput.map((row) => row.end_value));
  const summary = {
    ...buildPerformance(totalStart, totalEnd),
    incomplete,
    coverage: positionsOutput.length || !incomplete ? buildPerformance(
      sum(positionsOutput.map((row) => row.coverage.start_value)),
      sum(positionsOutput.map((row) => row.coverage.end_value)),
    ) : buildPerformance(null, null),
    ...(incomplete ? { start_value: null, end_value: null, performance_value: null, performance_pct: null } : {}),
    positions_count: positionsOutput.length,
    tags_count: tagsOutput.length,
    positions_total: docs.length,
    positions_skipped: skipped.length,
    lots_included: lotsIncluded,
    lots_skipped: lotsSkipped,
  };

  const now = new Date();
  return {
    calculation_version: MONTHLY_REPORT_VERSION,
    currency: "EUR",
    methodology: "Lot P/L / basis; basis includes purchases during the month; end includes sale proceeds. Excludes unrecorded cash, fees and dividends. Not a time-weighted or money-weighted account return.",
    stale: false,
    month: bounds.month,
    period_start: bounds.periodStart,
    period_end: bounds.periodEnd,
    generated_at: now,
    updated_at: now,
    summary,
    tags: tagsOutput,
    positions: positionsOutput,
    skipped_positions: skipped,
  };
}

async function generateMonthlyReportOnce(month, { force = false } = {}) {
  const normalized = normalizeReportMonth(month);
  if (!normalized) {
    throw reportError(400, "Invalid report month. Expected YYYY-MM.");
  }

  await ensureMonthlyReportIndexes();
  const { monthlyReports } = getCollections();
  if (!force) {
    const existing = await monthlyReports.findOne({ month: normalized });
    if (existing && existing.calculation_version === MONTHLY_REPORT_VERSION && !existing.stale) {
      return normalizeStoredReport(existing);
    }
  }

  const doc = await buildMonthlyReportDocument(normalized);
  await monthlyReports.updateOne(
    { month: normalized },
    {
      $set: doc,
      $setOnInsert: { created_at: doc.generated_at },
    },
    { upsert: true },
  );
  return normalizeStoredReport(await monthlyReports.findOne({ month: normalized }));
}

export async function generateMonthlyReport(month, options = {}) {
  const normalized = normalizeReportMonth(month);
  if (!normalized || !isCompletedMonth(normalized)) throw reportError(400, "Choose a completed month (YYYY-MM).");
  if (generatingReports.has(normalized)) return generatingReports.get(normalized);
  const pending = generateMonthlyReportOnce(normalized, options).finally(() => generatingReports.delete(normalized));
  generatingReports.set(normalized, pending);
  return pending;
}

export async function ensureLatestMonthlyReport() {
  const dueMonth = latestCompletedMonthKey();
  if (!dueMonth) {
    return null;
  }
  return generateMonthlyReport(dueMonth);
}

export async function ensureYearToDateMonthlyReports() {
  await ensureMonthlyReportIndexes();
  const months = completedMonthsSinceYearStart();
  if (!months.length) {
    return [];
  }

  const { monthlyReports } = getCollections();
  const existingDocs = await monthlyReports
    .find({ month: { $in: months }, calculation_version: MONTHLY_REPORT_VERSION, stale: { $ne: true } }, { projection: { month: 1 } })
    .toArray();
  const existingMonths = new Set(existingDocs.map((doc) => doc.month));
  const missingMonths = months.filter((month) => !existingMonths.has(month));

  for (const month of missingMonths) {
    await generateMonthlyReport(month);
  }

  return missingMonths;
}

export function buildMonthlyReportList(docs, { ensureYearToDate = true, ensureLatest = false, limit = 36, referenceDate = new Date() } = {}) {
  const months = new Map(docs.map((doc) => [doc.month, doc]));
  const due = latestCompletedMonthKey(referenceDate);
  const requested = ensureYearToDate ? completedMonthsSinceYearStart(referenceDate) : [];
  if (ensureLatest || ensureYearToDate) requested.push(due);
  for (const month of requested) if (!months.has(month)) months.set(month, null);
  return { latest_due_month: due, reports: [...months.entries()]
    .filter(([month]) => isCompletedMonth(month, referenceDate))
    .sort(([a], [b]) => b.localeCompare(a)).slice(0, limit)
    .map(([month, doc]) => {
      const bounds = monthBounds(month);
      const stale = !doc || doc.stale || doc.calculation_version !== MONTHLY_REPORT_VERSION;
      return { ...(doc ? listItem(doc) : { month, period_start: bounds.periodStart, period_end: bounds.periodEnd, generated_at: null,
        positions_count: 0, tags_count: 0 }),
        needs_generation: Boolean(stale),
        ...(stale ? { start_value: null, end_value: null, performance_value: null, performance_pct: null } : {}) };
    }) };
}

export async function listMonthlyReports(options = {}) {
  // Listing is a database read. Rebuild only the month the user opens.
  const { monthlyReports } = getCollections();
  const docs = await monthlyReports.find().sort({ month: -1 }).limit(options.limit ?? 36).toArray();
  return buildMonthlyReportList(docs, options);
}

export async function getMonthlyReport(month) {
  const normalized = normalizeReportMonth(month);
  if (!normalized) {
    throw reportError(400, "Invalid report month. Expected YYYY-MM.");
  }
  await ensureMonthlyReportIndexes();
  const { monthlyReports } = getCollections();
  const existing = await monthlyReports.findOne({ month: normalized });
  if (existing && existing.calculation_version === MONTHLY_REPORT_VERSION && !existing.stale) {
    return normalizeStoredReport(existing);
  }
  return generateMonthlyReport(normalized);
}
