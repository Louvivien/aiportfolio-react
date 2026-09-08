import { loadFxRates, currencyConverter } from "../fxService.js";
import { addValuation } from "../valuationService.js";
import { buildTagSummary } from "../tagSummaryService.js";
import { recordSale, previewSale } from "../saleService.js";
import { positionLots, safePeRatio, sum, holdingsAt } from "../finance.js";
import { Router } from "express";
import { ObjectId } from "mongodb";
import { getCollections } from "../db.js";
import {
  computePriceEntryFromDailySeries,
  fetchCustomApiDailySeries,
  fetchCustomApiIntradaySeries,
  getCustomApiPricesForPositions,
} from "../customApiService.js";
import { getPrices, getPriceHistory } from "../priceService.js";
import { fetchForumPosts } from "../forumService.js";
import { FUNDAMENTALS_CACHE_TTL_MS, getFundamentalsSnapshot } from "../fundamentalsService.js";
import { getNewsAgendaForSymbols } from "../newsAgendaService.js";
import {
  asBoolean,
  ensureArray,
  guessBoursoramaForumUrl,
  normaliseNumber,
  normalizeForumUrl,
  parseDateInput,
  toIsoDateOnly,
  toIsoDateTime,
  toObjectId,
  uniqueUppercaseSymbols,
  withStringId,
} from "../utils.js";

const router = Router();

async function upsertTagsReturnIds(names) {
  const now = new Date();
  const cleaned = (names || [])
    .map((name) => (typeof name === "string" ? name.trim() : ""))
    .filter(Boolean);

  if (!cleaned.length) {
    return [];
  }

  const { tags } = getCollections();
  const ids = [];
  for (const name of cleaned) {
    const existing = await tags.findOne({ name });
    if (existing) {
      ids.push(existing._id);
    } else {
      const result = await tags.insertOne({ name, created_at: now, updated_at: now });
      ids.push(result.insertedId);
    }
  }
  return ids;
}

async function getTagNames(tagIds) {
  if (!tagIds?.length) {
    return [];
  }
  const { tags } = getCollections();
  const docs = await tags
    .find({ _id: { $in: tagIds.map((id) => new ObjectId(id)) } })
    .toArray();
  const map = new Map(docs.map((doc) => [String(doc._id), doc.name]));
  return tagIds
    .map((id) => {
      const key = String(id);
      return map.has(key) ? map.get(key) : null;
    })
    .filter(Boolean);
}

const parseNullableNumber = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const num = normaliseNumber(value, NaN);
  return Number.isFinite(num) ? num : null;
};

const normalizeLotId = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const cleaned = typeof value === "string" ? value.trim() : String(value).trim();
  return cleaned ? cleaned.slice(0, 80) : null;
};

const normalizePurchaseLot = (value, fallbackDate, index) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const quantity = normaliseNumber(value.quantity, NaN);
  const costPrice = normaliseNumber(value.cost_price ?? value.costPrice, NaN);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }
  if (!Number.isFinite(costPrice) || costPrice < 0) {
    return null;
  }

  const parsedDate = parseDateInput(value.purchase_date ?? value.purchaseDate) ?? fallbackDate ?? null;
  const stopLossSet =
    value.stop_loss_set === undefined && value.stopLossSet === undefined
      ? null
      : asBoolean(value.stop_loss_set ?? value.stopLossSet);
  const isClosed = asBoolean(value.is_closed ?? value.closed);
  const closingPrice = parseNullableNumber(value.closing_price ?? value.closingPrice);
  const closingDate = parseDateInput(value.closing_date ?? value.closingDate);
  return {
    id: normalizeLotId(value.id) ?? `lot-${index + 1}`,
    quantity,
    cost_price: costPrice,
    purchase_date: parsedDate,
    stop_loss_set: stopLossSet,
    is_closed: isClosed,
    closing_price: isClosed ? closingPrice : null,
    closing_date: isClosed ? closingDate : null,
  };
};

const normalizePurchaseLots = (value, fallbackDate = null) => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((lot, index) => normalizePurchaseLot(lot, fallbackDate, index))
    .filter(Boolean);
};

const summarizePurchaseLots = (lots) => {
  const summary = {
    count: 0,
    closedCount: 0,
    quantity: 0,
    invested: 0,
    averageCost: null,
    firstDate: null,
    openQuantity: 0,
    openInvested: 0,
    openAverageCost: null,
    closedQuantity: 0,
    closedInvested: 0,
    closedProceeds: 0,
    averageClosingPrice: null,
    latestClosingDate: null,
    allClosed: false,
  };

  for (const lot of lots || []) {
    const quantity = normaliseNumber(lot?.quantity, NaN);
    const costPrice = normaliseNumber(lot?.cost_price, NaN);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(costPrice)) {
      continue;
    }
    summary.count += 1;
    summary.quantity += quantity;
    summary.invested += quantity * costPrice;
    const lotDate = parseDateInput(lot?.purchase_date);
    if (lotDate && (!summary.firstDate || lotDate < summary.firstDate)) {
      summary.firstDate = lotDate;
    }
    if (asBoolean(lot?.is_closed)) {
      summary.closedCount += 1;
      summary.closedQuantity += quantity;
      summary.closedInvested += quantity * costPrice;
      const closingPrice = parseNullableNumber(lot?.closing_price);
      if (closingPrice !== null) {
        summary.closedProceeds += quantity * closingPrice;
      }
      const closingDate = parseDateInput(lot?.closing_date);
      if (closingDate && (!summary.latestClosingDate || closingDate > summary.latestClosingDate)) {
        summary.latestClosingDate = closingDate;
      }
    } else {
      summary.openQuantity += quantity;
      summary.openInvested += quantity * costPrice;
    }
  }

  if (summary.quantity > 0) {
    summary.averageCost = summary.invested / summary.quantity;
  }
  if (summary.openQuantity > 0) {
    summary.openAverageCost = summary.openInvested / summary.openQuantity;
  }
  if (summary.closedQuantity > 0) {
    summary.averageClosingPrice = summary.closedProceeds / summary.closedQuantity;
  }
  summary.allClosed = summary.count > 0 && summary.closedCount === summary.count;

  return summary;
};

const defaultPurchaseLotsFromPosition = (position, fallbackDate = null) => {
  const quantity = normaliseNumber(position?.quantity, NaN);
  const costPrice = normaliseNumber(position?.cost_price, NaN);
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(costPrice) || costPrice < 0) {
    return [];
  }
  const purchaseDate =
    parseDateInput(position?.purchase_date) ??
    fallbackDate ??
    parseDateInput(position?.created_at) ??
    null;
  const isClosed = asBoolean(position?.is_closed);
  return [
    {
      id: "lot-1",
      quantity,
      cost_price: costPrice,
      purchase_date: purchaseDate,
      stop_loss_set: asBoolean(position?.stop_loss_set),
      is_closed: isClosed,
      closing_price: isClosed ? parseNullableNumber(position?.closing_price) : null,
      closing_date: isClosed
        ? parseDateInput(position?.closing_date) ?? parseDateInput(position?.updated_at)
        : null,
    },
  ];
};

const parseQueryNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)));
};

const FUNDAMENTALS_VERSION = 3;

const normalizeDisplayName = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const cleaned = typeof value === "string" ? value.trim() : String(value).trim();
  return cleaned ? cleaned : null;
};

const normalizeApiToken = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const cleaned = typeof value === "string" ? value.trim() : String(value).trim();
  return cleaned ? cleaned : null;
};

const normalizeApiUrl = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const cleaned = typeof value === "string" ? value.trim() : String(value).trim();
  if (!cleaned) {
    return null;
  }
  try {
    const url = new URL(cleaned);
    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

async function enrichDocument(doc, priceEntry, tagNames) {
  const isClosed = asBoolean(doc?.is_closed);
  const resolvedClosingDate = isClosed
    ? parseDateInput(doc?.closing_date)
    : null;
  const liveRaw = priceEntry?.current;


  const resolvedPurchaseLots = positionLots(doc);

  const historicRaw = priceEntry?.price_1y;
  const historic =
    historicRaw === null || historicRaw === undefined ? null : normaliseNumber(historicRaw, NaN);

  const endPriceRaw = isClosed ? doc?.closing_price : liveRaw;
  const endPrice =
    endPriceRaw === null || endPriceRaw === undefined
      ? null
      : normaliseNumber(endPriceRaw, NaN);
  const end = endPrice !== null && Number.isFinite(endPrice) ? endPrice : null;

  const prevCloseRaw = priceEntry?.previous_close;
  const prevClose =
    prevCloseRaw === null || prevCloseRaw === undefined ? null : normaliseNumber(prevCloseRaw, NaN);
  let prev =
    prevClose !== null && Number.isFinite(prevClose) && prevClose !== 0 ? prevClose : null;

  if (!isClosed && prev === null && end !== null && priceEntry?.change !== null && priceEntry?.change !== undefined) {
    const changeVal = normaliseNumber(priceEntry.change, NaN);
    const derivedPrev = Number.isFinite(changeVal) ? end - changeVal : NaN;
    if (Number.isFinite(derivedPrev) && derivedPrev !== 0) {
      prev = derivedPrev;
    }
  }

  const price10dRaw = priceEntry?.price_10d;
  const price10d =
    price10dRaw === null || price10dRaw === undefined ? null : normaliseNumber(price10dRaw, NaN);
  const tenBase = price10d !== null && Number.isFinite(price10d) && price10d !== 0 ? price10d : null;
  const change10dPct = end !== null && tenBase !== null ? ((end / tenBase) - 1) * 100 : null;

  const intradayAllowed =
    toIsoDateOnly(priceEntry?.quote_date) === toIsoDateOnly(new Date()) && (!isClosed ||
    (resolvedClosingDate &&
      toIsoDateOnly(resolvedClosingDate) === toIsoDateOnly(new Date())));
  const intradayChange = intradayAllowed && end !== null && prev !== null ? end - prev : null;
  const intradayPct =
    intradayAllowed && end !== null && prev !== null ? ((end / prev) - 1) * 100 : null;

  const price1yBase = historic;
  const change1yPct = end !== null && historic > 0 ? (end / historic - 1) * 100 : null;

  const overrides = normaliseOverrides(doc?.fundamentals_overrides);
  const snapshot =
    doc?.fundamentals_snapshot && typeof doc.fundamentals_snapshot === "object"
      ? doc.fundamentals_snapshot
      : null;

  const storedRevenueGrowth = parseNullableNumber(doc?.revenue_growth_yoy_pct);
  const storedPeRatio = parseNullableNumber(doc?.pe_ratio);
  const storedPegRatio = parseNullableNumber(doc?.peg_ratio);
  const storedRoe5yAvg = parseNullableNumber(doc?.roe_5y_avg_pct);
  const storedQuickRatio = parseNullableNumber(doc?.quick_ratio);

  const snapshotRevenueGrowth = parseNullableNumber(snapshot?.revenueGrowthLatestYoYPct);
  const snapshotRoe5yAvg = parseNullableNumber(snapshot?.roe5yAvgPct);
  const snapshotQuickRatio = parseNullableNumber(snapshot?.quickRatio);

  const revenueGrowthValue = isOverrideEnabled(overrides, "revenue_growth_yoy_pct")
    ? storedRevenueGrowth
    : snapshotRevenueGrowth ?? storedRevenueGrowth;
  const roe5yAvgValue = isOverrideEnabled(overrides, "roe_5y_avg_pct")
    ? storedRoe5yAvg
    : snapshotRoe5yAvg ?? storedRoe5yAvg;
  const quickRatioValue = isOverrideEnabled(overrides, "quick_ratio")
    ? storedQuickRatio
    : snapshotQuickRatio ?? storedQuickRatio;

  const computedPeRatio = safePeRatio(end, priceEntry?.currency, snapshot, doc.symbol);
  const peRatioValue = isOverrideEnabled(overrides, "pe_ratio") ? storedPeRatio : computedPeRatio;

  const computedPegRatio = computePegRatio(peRatioValue, parseNullableNumber(snapshot?.epsCagrPct));
  const pegRatioValue = isOverrideEnabled(overrides, "peg_ratio")
    ? storedPegRatio
    : computedPegRatio;

  const safeDoc = doc && typeof doc === "object" ? { ...doc } : doc;
  if (safeDoc && Object.prototype.hasOwnProperty.call(safeDoc, "api_token")) {
    delete safeDoc.api_token;
  }

  const enriched = {
    ...safeDoc,
    purchase_lots: resolvedPurchaseLots.map((lot) => ({
      ...lot,
      purchase_date: toIsoDateTime(lot.purchase_date),
      stop_loss_set:
        lot.stop_loss_set === null || lot.stop_loss_set === undefined
          ? asBoolean(doc?.stop_loss_set)
          : asBoolean(lot.stop_loss_set),
      is_closed: asBoolean(lot.is_closed),
      closing_price: asBoolean(lot.is_closed) ? parseNullableNumber(lot.closing_price) : null,
      closing_date: asBoolean(lot.is_closed) ? toIsoDateTime(lot.closing_date) : null,
    })),
    purchase_date: toIsoDateTime(doc?.purchase_date),
    created_at: toIsoDateTime(doc?.created_at),
    updated_at: toIsoDateTime(doc?.updated_at),
    fundamentals_updated_at: toIsoDateTime(doc?.fundamentals_updated_at),
    fundamentals_snapshot_updated_at: toIsoDateTime(doc?.fundamentals_snapshot_updated_at),
    fundamentals_snapshot: snapshot,
    closing_date: toIsoDateTime(resolvedClosingDate),
    current_price: parseNullableNumber(priceEntry?.current),
    quote_date: toIsoDateOnly(priceEntry?.quote_date),
    previous_close: prev,
    long_name: priceEntry?.long_name ?? null,
    intraday_change: intradayChange,
    intraday_change_pct: intradayPct,
    currency: priceEntry?.currency ?? doc?.currency ?? null,
    price_10d: tenBase,
    change_10d_pct: change10dPct,
    price_1y: price1yBase,
    change_1y_pct: change1yPct,
    tags: tagNames,
    boursorama_forum_url: doc?.boursorama_forum_url ?? guessBoursoramaForumUrl(doc?.symbol),
    revenue_growth_yoy_pct: revenueGrowthValue,
    pe_ratio: peRatioValue,
    peg_ratio: pegRatioValue,
    roe_5y_avg_pct: roe5yAvgValue,
    quick_ratio: quickRatioValue,
    indicator_disabled: asBoolean(doc?.indicator_disabled),
    stop_loss_set: asBoolean(doc?.stop_loss_set),
  };
  return addValuation(withStringId(enriched), doc);
}

function isMissingIndicatorField(value) {
  return value === null || value === undefined || value === "";
}

function normaliseOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function isOverrideEnabled(overrides, key) {
  return Boolean(overrides && overrides[key]);
}

function computePegRatio(pe, growthPct) {
  const peValue = normaliseNumber(pe, NaN);
  const growthValue = normaliseNumber(growthPct, NaN);
  if (
    !Number.isFinite(peValue) ||
    peValue <= 0 ||
    !Number.isFinite(growthValue) ||
    growthValue <= 0
  ) {
    return null;
  }
  const peg = peValue / growthValue;
  return Number.isFinite(peg) ? peg : null;
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

function resolveStartDate(period) {
  if (!period) {
    const fallback = new Date();
    fallback.setMonth(fallback.getMonth() - 6);
    return fallback;
  }

  const match = /^(\d+)([a-z]+)$/.exec(String(period).trim());
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

router.get("/", async (req, res, next) => {
  try {
    const { positions } = getCollections();
    const docs = await positions.find().limit(1000).toArray();
    const apiDocs = docs.filter((doc) => Boolean(doc?.api_url));
    const stockDocs = docs.filter((doc) => !doc?.api_url);
    const symbols = uniqueUppercaseSymbols(stockDocs);
    const [priceMap, apiPriceMap] = await Promise.all([
      getPrices(symbols),
      getCustomApiPricesForPositions(apiDocs),
    ]);

    const uniqueTagIds = new Set();
    docs.forEach((doc) => {
      ensureArray(doc.tags).forEach((tagId) => uniqueTagIds.add(String(tagId)));
    });
    const tagNamesMap = {};
    if (uniqueTagIds.size) {
      const { tags } = getCollections();
      const ids = Array.from(uniqueTagIds).map((id) => new ObjectId(id));
      const tagDocs = await tags.find({ _id: { $in: ids } }).toArray();
      tagDocs.forEach((tag) => {
        tagNamesMap[String(tag._id)] = tag.name;
      });
    }

    const now = new Date();
    const docsNeedingFundamentals = docs
      .map((doc) => {
        const sym = String(doc.symbol || "").toUpperCase();
        const disabled = Boolean(doc?.api_url) || asBoolean(doc?.indicator_disabled);
        const fundamentalsVersion = normaliseNumber(doc?.fundamentals_version, 0);
        const overrides = normaliseOverrides(doc?.fundamentals_overrides);
        const snapshotUpdatedAt = parseDateInput(doc?.fundamentals_snapshot_updated_at);
        const snapshotStale =
          snapshotUpdatedAt === null ||
          now.getTime() - snapshotUpdatedAt.getTime() > FUNDAMENTALS_CACHE_TTL_MS;
        const needsSnapshot =
          !disabled && (!doc?.fundamentals_snapshot || doc.fundamentals_snapshot === null || snapshotStale || fundamentalsVersion < FUNDAMENTALS_VERSION);
        const needsRevenueGrowth =
          !isOverrideEnabled(overrides, "revenue_growth_yoy_pct") &&
          (isMissingIndicatorField(doc?.revenue_growth_yoy_pct) ||
            fundamentalsVersion < FUNDAMENTALS_VERSION);
        const needsRoe =
          !isOverrideEnabled(overrides, "roe_5y_avg_pct") &&
          isMissingIndicatorField(doc?.roe_5y_avg_pct);
        const needsQuick =
          !isOverrideEnabled(overrides, "quick_ratio") && isMissingIndicatorField(doc?.quick_ratio);
        const needsAny = !disabled && (needsSnapshot || needsRevenueGrowth || needsRoe || needsQuick);
        return {
          doc,
          sym,
          disabled,
          overrides,
          fundamentalsVersion,
          needsSnapshot,
          needsRevenueGrowth,
          needsRoe,
          needsQuick,
          needsAny,
        };
      })
      .filter((entry) => entry.needsAny && entry.sym);

    if (docsNeedingFundamentals.length) {
      await mapWithConcurrency(docsNeedingFundamentals, 3, async (entry) => {
        const { doc, sym, overrides, fundamentalsVersion, needsSnapshot } = entry;
        const fundamentals = needsSnapshot
          ? await getFundamentalsSnapshot(sym)
          : doc?.fundamentals_snapshot && typeof doc.fundamentals_snapshot === "object"
            ? doc.fundamentals_snapshot
            : null;
        if (!fundamentals) {
          return;
        }

        const updates = {};
        if (needsSnapshot) {
          updates.fundamentals_snapshot = fundamentals;
          updates.fundamentals_snapshot_updated_at = now;
          doc.fundamentals_snapshot = fundamentals;
          doc.fundamentals_snapshot_updated_at = now;
        }
        if (
          !isOverrideEnabled(overrides, "revenue_growth_yoy_pct") &&
          (isMissingIndicatorField(doc?.revenue_growth_yoy_pct) ||
            fundamentalsVersion < FUNDAMENTALS_VERSION) &&
          fundamentals.revenueGrowthLatestYoYPct !== null
        ) {
          updates.revenue_growth_yoy_pct = fundamentals.revenueGrowthLatestYoYPct;
          doc.revenue_growth_yoy_pct = fundamentals.revenueGrowthLatestYoYPct;
        }
        if (
          !isOverrideEnabled(overrides, "roe_5y_avg_pct") &&
          isMissingIndicatorField(doc?.roe_5y_avg_pct) &&
          fundamentals.roe5yAvgPct !== null
        ) {
          updates.roe_5y_avg_pct = fundamentals.roe5yAvgPct;
          doc.roe_5y_avg_pct = fundamentals.roe5yAvgPct;
        }
        if (
          !isOverrideEnabled(overrides, "quick_ratio") &&
          isMissingIndicatorField(doc?.quick_ratio) &&
          fundamentals.quickRatio !== null
        ) {
          updates.quick_ratio = fundamentals.quickRatio;
          doc.quick_ratio = fundamentals.quickRatio;
        }

        if (Object.keys(updates).length) {
          updates.fundamentals_version = FUNDAMENTALS_VERSION;
          doc.fundamentals_version = FUNDAMENTALS_VERSION;
          await positions.updateOne({ _id: doc._id }, { $set: updates });
        }
      });
    }

    const result = await Promise.all(docs.map((doc) => {
      const sym = String(doc.symbol || "").toUpperCase();
      const apiKey = doc?._id ? String(doc._id) : null;
      const priceEntry = doc?.api_url && apiKey ? apiPriceMap[apiKey] ?? {} : priceMap[sym] ?? {};
      const tagNames = ensureArray(doc.tags)
        .map((id) => tagNamesMap[String(id)])
        .filter(Boolean);
      return enrichDocument(doc, priceEntry, tagNames);
    }));

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { positions } = getCollections();
    const body = req.body || {};

    const displayName = normalizeDisplayName(body.display_name);
    const apiUrl = normalizeApiUrl(body.api_url);
    const apiToken = normalizeApiToken(body.api_token);
    const apiUrlProvided = body.api_url !== undefined;
    if (apiUrlProvided && String(body.api_url ?? "").trim() && !apiUrl) {
      return res.status(400).json({ detail: "Invalid api_url (must be an http/https URL)." });
    }
    const isCustomApi = Boolean(apiUrl);

    const tagIds = await upsertTagsReturnIds(body.tags || []);
    const now = new Date();
    const purchaseDate = parseDateInput(body.purchase_date);
    const closingDate = parseDateInput(body.closing_date);
    const requestedClosed = Boolean(body.is_closed);
    const requestedQuantity = normaliseNumber(body.quantity, 0);
    const requestedCostPrice = normaliseNumber(body.cost_price, 0);
    const purchaseLots = normalizePurchaseLots(body.purchase_lots, purchaseDate ?? now);
    const resolvedPurchaseLots = purchaseLots.length
      ? purchaseLots
      : defaultPurchaseLotsFromPosition(
          {
            quantity: requestedQuantity,
            cost_price: requestedCostPrice,
            purchase_date: purchaseDate ?? now,
          },
          now,
        );
    const lotSummary = summarizePurchaseLots(resolvedPurchaseLots);
    const isClosed = requestedClosed || lotSummary.allClosed;
    const effectiveQuantity =
      lotSummary.openQuantity > 0 ? lotSummary.openQuantity : lotSummary.quantity;
    const effectiveCostPrice =
      lotSummary.openQuantity > 0 ? lotSummary.openAverageCost : lotSummary.averageCost;
    const doc = {
      symbol: String(body.symbol || "").toUpperCase(),
      display_name: displayName,
      api_url: apiUrl,
      api_token: isCustomApi ? apiToken : null,
      quantity: effectiveQuantity > 0 ? effectiveQuantity : requestedQuantity,
      cost_price: effectiveCostPrice ?? requestedCostPrice,
      purchase_lots: resolvedPurchaseLots,
      tags: tagIds,
      is_closed: isClosed,
      closing_price: isClosed
        ? body.closing_price === null || body.closing_price === undefined
          ? lotSummary.averageClosingPrice
          : normaliseNumber(body.closing_price)
        : null,
      closing_date: isClosed ? closingDate ?? lotSummary.latestClosingDate ?? now : null,
      purchase_date: purchaseDate ?? lotSummary.firstDate ?? now,
      boursorama_forum_url: isCustomApi
        ? null
        : normalizeForumUrl(body.boursorama_forum_url, body.symbol),
      revenue_growth_yoy_pct: parseNullableNumber(body.revenue_growth_yoy_pct),
      pe_ratio: parseNullableNumber(body.pe_ratio),
      peg_ratio: parseNullableNumber(body.peg_ratio),
      roe_5y_avg_pct: parseNullableNumber(body.roe_5y_avg_pct),
      quick_ratio: parseNullableNumber(body.quick_ratio),
      indicator_disabled: isCustomApi ? true : asBoolean(body.indicator_disabled),
      stop_loss_set: asBoolean(body.stop_loss_set),
      created_at: now,
      updated_at: now,
    };

    const fundamentalsOverrides = {};
    if (!isMissingIndicatorField(doc.revenue_growth_yoy_pct)) {
      fundamentalsOverrides.revenue_growth_yoy_pct = true;
    }
    if (!isMissingIndicatorField(doc.pe_ratio)) {
      fundamentalsOverrides.pe_ratio = true;
    }
    if (!isMissingIndicatorField(doc.peg_ratio)) {
      fundamentalsOverrides.peg_ratio = true;
    }
    if (!isMissingIndicatorField(doc.roe_5y_avg_pct)) {
      fundamentalsOverrides.roe_5y_avg_pct = true;
    }
    if (!isMissingIndicatorField(doc.quick_ratio)) {
      fundamentalsOverrides.quick_ratio = true;
    }

    if (Object.keys(fundamentalsOverrides).length) {
      doc.fundamentals_overrides = fundamentalsOverrides;
      doc.fundamentals_version = FUNDAMENTALS_VERSION;
      doc.fundamentals_updated_at = now;
    }

    const result = await positions.insertOne(doc);
    await getCollections().monthlyReports.updateMany({}, { $set: { stale: true } });
    const inserted = await positions.findOne({ _id: result.insertedId });
    if (!inserted) {
      return res.status(500).json({ detail: "Failed to create position" });
    }

    let priceEntry = {};
    const symbol = inserted?.symbol ? String(inserted.symbol).toUpperCase() : null;
    if (inserted.api_url) {
      const now = new Date();
      const todayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const intradayStart = new Date(todayStartMs - 36 * 60 * 60 * 1000);

      const [series, intradaySeries] = await Promise.all([
        fetchCustomApiDailySeries(inserted.api_url, inserted.api_token),
        fetchCustomApiIntradaySeries(inserted.api_url, inserted.api_token, { startDate: intradayStart, limit: 5000 }),
      ]);

      priceEntry = computePriceEntryFromDailySeries(series, { intradayPoints: intradaySeries });

    } else {
      const priceMap = symbol ? await getPrices([symbol]) : {};
      priceEntry = priceMap[symbol] ?? {};
    }
    const tagNames = await getTagNames(inserted?.tags);
    const response = await enrichDocument(inserted, priceEntry, tagNames);
    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
});

router.get("/news-agenda", async (req, res, next) => {
  try {
    const { positions } = getCollections();
    const includeClosed = req.query.includeClosed === "true";
    const docs = await positions.find().limit(1000).toArray();
    const stockDocs = docs.filter(
      (doc) => !doc?.api_url && (includeClosed || !asBoolean(doc?.is_closed)),
    );
    const symbols = uniqueUppercaseSymbols(stockDocs);

    const result = await getNewsAgendaForSymbols(symbols, {
      newsPerSymbol: parseQueryNumber(req.query.newsPerSymbol, 8, 1, 10),
      newsLimit: parseQueryNumber(req.query.newsLimit, 100, 1, 100),
      newsDaysBack: parseQueryNumber(req.query.newsDaysBack, 14, 1, 365),
      daysAhead: parseQueryNumber(req.query.daysAhead, 62, 1, 730),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/:id/forum/posts", async (req, res, next) => {
  try {
    const { positions } = getCollections();
    const { id } = req.params;
    const objectId = toObjectId(id);
    if (!objectId) {
      return res.status(400).json({ detail: "Invalid position id" });
    }
    const doc = await positions.findOne({ _id: objectId });
    if (!doc) {
      return res.status(404).json({ detail: "Position not found" });
    }
    const forumUrl = normalizeForumUrl(doc.boursorama_forum_url, doc.symbol);
    if (!forumUrl) {
      return res.status(404).json({ detail: "Forum details unavailable" });
    }
    const posts = await fetchForumPosts(forumUrl, { limit: 3 });
    res.json({ forum_url: forumUrl, posts });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/sales", async (req, res, next) => {
  try {
    const id = toObjectId(req.params.id);
    if (!id) return res.status(400).json({ detail: "Invalid position id" });
    res.json(await recordSale(getCollections(), id, req.body || {}));
  } catch (error) { next(error); }
});

router.post("/:id/sales/preview", async (req, res, next) => {
  try {
    const id = toObjectId(req.params.id);
    if (!id) return res.status(400).json({ detail: "Invalid position id" });
    res.json(await previewSale(getCollections(), id, req.body || {}));
  } catch (error) { next(error); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { positions } = getCollections();
    const { id } = req.params;
    const objectId = toObjectId(id);
    if (!objectId) {
      return res.status(400).json({ detail: "Invalid position id" });
    }

    const existing = await positions.findOne({ _id: objectId });
    if (!existing) {
      return res.status(404).json({ detail: "Position not found" });
    }

    const updates = {};
    const body = req.body || {};
    const existingApiUrl = typeof existing.api_url === "string" ? existing.api_url : null;

    if (body.display_name !== undefined) {
      updates.display_name = normalizeDisplayName(body.display_name);
    }

    let nextApiUrl = existingApiUrl;
    if (body.api_url !== undefined) {
      const normalisedUrl = normalizeApiUrl(body.api_url);
      if (String(body.api_url ?? "").trim() && !normalisedUrl) {
        return res.status(400).json({ detail: "Invalid api_url (must be an http/https URL)." });
      }
      nextApiUrl = normalisedUrl;
      updates.api_url = normalisedUrl;
      if (!normalisedUrl) {
        updates.api_token = null;
      }
    }

    const isCustomApi = Boolean(nextApiUrl);
    if (body.api_token !== undefined) {
      updates.api_token = isCustomApi ? normalizeApiToken(body.api_token) : null;
    }

    let nextIsClosed =
      body.is_closed !== undefined ? Boolean(body.is_closed) : asBoolean(existing.is_closed);
    const hasClosingDate = body.closing_date !== undefined;

    if (body.symbol !== undefined) {
      updates.symbol = String(body.symbol || "").toUpperCase();
    }
    if (body.quantity !== undefined) {
      updates.quantity = normaliseNumber(body.quantity);
    }
    if (body.cost_price !== undefined) {
      updates.cost_price = normaliseNumber(body.cost_price);
    }
    if (body.is_closed !== undefined) {
      updates.is_closed = nextIsClosed;
      if (!nextIsClosed) {
        updates.closing_date = null;
      } else if (!hasClosingDate) {
        updates.closing_date = parseDateInput(existing?.closing_date) ?? new Date();
      }
    }
    if (body.closing_price !== undefined) {
      updates.closing_price =
        body.closing_price === null || body.closing_price === undefined
          ? null
          : normaliseNumber(body.closing_price);
    }
    if (body.closing_date !== undefined) {
      const parsedDate = parseDateInput(body.closing_date);
      updates.closing_date = nextIsClosed ? parsedDate ?? null : null;
    }
    if (body.tags !== undefined) {
      updates.tags = await upsertTagsReturnIds(body.tags || []);
    }
    if (body.purchase_date !== undefined) {
      const parsedDate = parseDateInput(body.purchase_date);
      updates.purchase_date = parsedDate ?? null;
    }
    if (body.purchase_lots !== undefined) {
      const fallbackDate =
        parseDateInput(body.purchase_date) ?? parseDateInput(existing?.purchase_date) ?? new Date();
      const purchaseLots = normalizePurchaseLots(body.purchase_lots, fallbackDate);
      if (!purchaseLots.length) {
        return res.status(400).json({ detail: "At least one valid purchase lot is required." });
      }
      const lotSummary = summarizePurchaseLots(purchaseLots);
      const effectiveQuantity =
        lotSummary.openQuantity > 0 ? lotSummary.openQuantity : lotSummary.quantity;
      const effectiveCostPrice =
        lotSummary.openQuantity > 0 ? lotSummary.openAverageCost : lotSummary.averageCost;
      nextIsClosed = lotSummary.allClosed;
      updates.purchase_lots = purchaseLots;
      updates.quantity = effectiveQuantity;
      updates.cost_price = effectiveCostPrice ?? 0;
      updates.is_closed = nextIsClosed;
      updates.closing_price = nextIsClosed ? lotSummary.averageClosingPrice : null;
      updates.closing_date = nextIsClosed ? lotSummary.latestClosingDate ?? new Date() : null;
      if (body.purchase_date === undefined) {
        updates.purchase_date = lotSummary.firstDate ?? parseDateInput(existing?.purchase_date) ?? null;
      }
    }
    if (body.purchase_lots === undefined && Array.isArray(existing.purchase_lots) && existing.purchase_lots.length) {
      const lotFields = ["quantity", "cost_price", "purchase_date", "is_closed", "closing_price", "closing_date"];
      const touched = lotFields.filter((field) => body[field] !== undefined);
      if (touched.length && existing.purchase_lots.length > 1) {
        return res.status(400).json({ detail: "Update purchase_lots when editing a position with multiple lots." });
      }
      if (touched.length) {
        const lot = { ...existing.purchase_lots[0] };
        for (const field of lotFields) if (updates[field] !== undefined) lot[field] = updates[field];
        updates.purchase_lots = [lot];
      }
    }
    if (isCustomApi) {
      updates.boursorama_forum_url = null;
    } else if (body.boursorama_forum_url !== undefined) {
      updates.boursorama_forum_url = normalizeForumUrl(
        body.boursorama_forum_url,
        body.symbol ?? existing.symbol,
      );
    }
    if (body.revenue_growth_yoy_pct !== undefined) {
      updates.revenue_growth_yoy_pct = parseNullableNumber(body.revenue_growth_yoy_pct);
    }
    if (body.pe_ratio !== undefined) {
      updates.pe_ratio = parseNullableNumber(body.pe_ratio);
    }
    if (body.peg_ratio !== undefined) {
      updates.peg_ratio = parseNullableNumber(body.peg_ratio);
    }
    if (body.roe_5y_avg_pct !== undefined) {
      updates.roe_5y_avg_pct = parseNullableNumber(body.roe_5y_avg_pct);
    }
    if (body.quick_ratio !== undefined) {
      updates.quick_ratio = parseNullableNumber(body.quick_ratio);
    }
    if (isCustomApi) {
      updates.indicator_disabled = true;
    } else if (body.indicator_disabled !== undefined) {
      updates.indicator_disabled = asBoolean(body.indicator_disabled);
    }
    if (body.stop_loss_set !== undefined) {
      updates.stop_loss_set = asBoolean(body.stop_loss_set);
    }

    const existingOverrides = normaliseOverrides(existing?.fundamentals_overrides);
    const nextOverrides = { ...existingOverrides };
    let fundamentalsTouched = false;

    const numbersEqual = (left, right) => {
      if (left === null || left === undefined) {
        return right === null || right === undefined;
      }
      if (right === null || right === undefined) {
        return false;
      }
      return Math.abs(left - right) < 1e-9;
    };

    const applyOverrideUpdate = (key, value) => {
      if (value === null || value === undefined) {
        delete nextOverrides[key];
      } else {
        nextOverrides[key] = true;
      }
    };

    const touchFundamentalOverride = (key) => {
      const nextValue = updates[key];
      const prevValue = parseNullableNumber(existing?.[key]);
      const hadOverride = isOverrideEnabled(existingOverrides, key);

      if (!hadOverride && numbersEqual(prevValue, nextValue)) {
        delete updates[key];
        return;
      }
      fundamentalsTouched = true;
      applyOverrideUpdate(key, nextValue);
    };

    if (body.revenue_growth_yoy_pct !== undefined) {
      touchFundamentalOverride("revenue_growth_yoy_pct");
    }
    if (body.pe_ratio !== undefined) {
      touchFundamentalOverride("pe_ratio");
    }
    if (body.peg_ratio !== undefined) {
      touchFundamentalOverride("peg_ratio");
    }
    if (body.roe_5y_avg_pct !== undefined) {
      touchFundamentalOverride("roe_5y_avg_pct");
    }
    if (body.quick_ratio !== undefined) {
      touchFundamentalOverride("quick_ratio");
    }

    if (fundamentalsTouched) {
      const hasOverrides = Object.keys(nextOverrides).length > 0;
      updates.fundamentals_overrides = hasOverrides ? nextOverrides : null;
      updates.fundamentals_version = hasOverrides ? FUNDAMENTALS_VERSION : 0;
      updates.fundamentals_updated_at = hasOverrides ? new Date() : null;
    }

    if (Object.keys(updates).length) {
      updates.updated_at = new Date();
      await positions.updateOne({ _id: objectId }, { $set: updates });
      await getCollections().monthlyReports.updateMany({}, { $set: { stale: true } });
    }

    const doc = await positions.findOne({ _id: objectId });
    if (!doc) {
      return res.status(404).json({ detail: "Position not found" });
    }
    const symbol = doc?.symbol ? String(doc.symbol).toUpperCase() : null;
    let priceEntry = {};
    if (doc.api_url) {
      const now = new Date();
      const todayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const intradayStart = new Date(todayStartMs - 36 * 60 * 60 * 1000);

      const [series, intradaySeries] = await Promise.all([
        fetchCustomApiDailySeries(doc.api_url, doc.api_token),
        fetchCustomApiIntradaySeries(doc.api_url, doc.api_token, { startDate: intradayStart, limit: 5000 }),
      ]);

      priceEntry = computePriceEntryFromDailySeries(series, { intradayPoints: intradaySeries });
    } else {
      const priceMap = symbol ? await getPrices([symbol]) : {};
      priceEntry = priceMap[symbol] ?? {};
    }
    const tagNames = await getTagNames(doc?.tags);
    const response = await enrichDocument(doc, priceEntry, tagNames);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const { positions } = getCollections();
    const { id } = req.params;
    const objectId = toObjectId(id);
    if (!objectId) {
      return res.status(400).json({ detail: "Invalid position id" });
    }
    const result = await positions.deleteOne({ _id: objectId });
    if (!result.deletedCount) {
      return res.status(404).json({ detail: "Position not found" });
    }
    await getCollections().monthlyReports.updateMany({}, { $set: { stale: true } });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

async function valuedDocuments() {
  const { positions } = getCollections();
  const docs = await positions.find().limit(1000).toArray();
  const [prices, apiPrices] = await Promise.all([
    getPrices(uniqueUppercaseSymbols(docs.filter((doc) => !doc.api_url))),
    getCustomApiPricesForPositions(docs.filter((doc) => doc.api_url)),
  ]);
  return Promise.all(docs.map(async (doc) => {
    const entry = doc.api_url ? apiPrices[String(doc._id)] : prices[doc.symbol];
    return enrichDocument(doc, entry ?? {}, await getTagNames(doc.tags));
  }));
}

router.get("/summary", async (req, res, next) => {
  try {
    const docs = await valuedDocuments();
    res.json({ currency: "EUR", total_market_value: sum(docs.map((d) => d.valuation.market_value)),
      total_unrealized_pl: sum(docs.map((d) => d.valuation.unrealized_pl)),
      total_realized_pl: sum(docs.map((d) => d.valuation.realized_pl)) });
  } catch (error) { next(error); }
});
router.get("/summary/debug", async (req, res, next) => {
  try {
    const docs = await valuedDocuments();
    const rows = docs.map((d) => ({ symbol: d.symbol, quote_currency: d.currency,
      subtotal: d.valuation.market_value, fx: d.valuation.fx }));
    res.json({ currency: "EUR", total_market_value: sum(rows.map((r) => r.subtotal)), rows });
  } catch (error) { next(error); }
});
router.get("/tags/summary", async (req, res, next) => {
  try {
    const docs = await valuedDocuments();
    res.json(buildTagSummary(docs));
  } catch (error) { next(error); }
});

router.get("/tags/timeseries", async (req, res, next) => {
  try {
    const { positions, tags } = getCollections();
    const { period = "6mo", interval = "1d" } = req.query;
    const docs = await positions.find().limit(1000).toArray();

    const openPositions = docs;
    if (!openPositions.length) {
      return res.json({ tags: {}, total: [] });
    }

    const openApiPositions = openPositions.filter((doc) => Boolean(doc?.api_url));
    const openStockPositions = openPositions.filter((doc) => !doc?.api_url);

    const symbols = uniqueUppercaseSymbols(openStockPositions);
    const historyMap = symbols.length ? await getPriceHistory(symbols, { period, interval: "1d" }) : {};

    const apiHistoryMap = {};
    if (openApiPositions.length) {
      const startDate = resolveStartDate(period);
      const pairs = await mapWithConcurrency(openApiPositions, 4, async (doc) => {
        const apiKey = doc?._id ? String(doc._id) : null;
        if (!apiKey || !doc?.api_url) {
          return [apiKey, []];
        }
        const series = await fetchCustomApiDailySeries(doc.api_url, doc.api_token, { startDate });
        const points = series.map((point) => ({
          date: new Date(point.ts).toISOString().slice(0, 10),
          close: point.value,
        }));
        return [apiKey, points];
      });
      pairs.forEach((pair) => {
        const [apiKey, points] = pair || [];
        if (apiKey) {
          apiHistoryMap[apiKey] = Array.isArray(points) ? points : [];
        }
      });
    }

    const tagIds = new Set();
    openPositions.forEach((doc) =>
      ensureArray(doc.tags).forEach((tag) => tagIds.add(String(tag))),
    );
    const tagDocs = tagIds.size
      ? await tags
          .find({ _id: { $in: Array.from(tagIds).map((id) => new ObjectId(id)) } })
          .toArray()
      : [];
    const tagNameMap = new Map(tagDocs.map((doc) => [String(doc._id), doc.name]));

    const [fx, prices, apiPrices] = await Promise.all([
      loadFxRates(), getPrices(symbols), getCustomApiPricesForPositions(openApiPositions),
    ]);
    const sources = openPositions.map((doc) => {
      const history = doc.api_url ? apiHistoryMap[String(doc._id)] ?? [] : historyMap[doc.symbol] ?? [];
      const quote = doc.api_url ? apiPrices[String(doc._id)] : prices[doc.symbol];
      return { doc, history, convert: currencyConverter(fx, quote?.currency ?? doc.currency),
        tags: ensureArray(doc.tags).map((id) => tagNameMap.get(String(id))).filter(Boolean) };
    });
    const startDate = toIsoDateOnly(resolveStartDate(String(period)));
    const today = toIsoDateOnly(new Date());
    let dates = [...new Set(sources.flatMap((source) => source.history.map((p) => p.date)))].sort()
      .filter((date) => date >= startDate && date <= today);
    if (interval === "1wk" || interval === "1mo") {
      const sampled = new Map();
      for (const date of dates) {
        const week = new Date(`${date}T00:00:00Z`);
        week.setUTCDate(week.getUTCDate() - (week.getUTCDay() + 6) % 7);
        sampled.set(interval === "1mo" ? date.slice(0, 7) : toIsoDateOnly(week), date);
      }
      dates = [...sampled.values()];
    }
    const tagNames = [...new Set(sources.flatMap((source) => source.tags))];
    const tagsOutput = Object.fromEntries(tagNames.map((tag) => [tag, []]));
    const totalOutput = [];
    for (const date of dates) {
      const rows = sources.map((source) => ({ ...holdingsAt(source.doc, source.history, date, source.convert), tags: source.tags }));
      const aggregate = (selected) => ({ date, market_value: sum(selected.map((r) => r.market_value)),
        unrealized_pl: sum(selected.map((r) => r.unrealized_pl)) });
      totalOutput.push(aggregate(rows));
      for (const tag of tagNames) tagsOutput[tag].push(aggregate(rows.filter((r) => r.tags.includes(tag))));
    }

    res.json({ tags: tagsOutput, total: totalOutput });
  } catch (error) {
    next(error);
  }
});

export default router;
