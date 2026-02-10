import { Router } from "express";
import { ObjectId } from "mongodb";
import { getCollections } from "../db.js";
import {
  computePriceEntryFromDailySeries,
  fetchCustomApiDailySeries,
  getCustomApiPricesForPositions,
} from "../customApiService.js";
import { getPrices, getPriceHistory } from "../priceService.js";
import { fetchForumPosts } from "../forumService.js";
import { FUNDAMENTALS_CACHE_TTL_MS, getFundamentalsSnapshot } from "../fundamentalsService.js";
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

const FUNDAMENTALS_VERSION = 2;

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

function computeEffectivePrice(doc, priceEntry) {
  const isClosed = asBoolean(doc?.is_closed);
  const closing = doc?.closing_price;
  const live = priceEntry?.current;
  if (isClosed && closing !== null && closing !== undefined) {
    return normaliseNumber(closing, 0);
  }
  return normaliseNumber(live, 0);
}

function enrichDocument(doc, priceEntry, tagNames) {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const isClosed = asBoolean(doc?.is_closed);
  const resolvedClosingDate = isClosed
    ? parseDateInput(doc?.closing_date) ?? parseDateInput(doc?.updated_at)
    : null;
  const liveRaw = priceEntry?.current;
  const live =
    liveRaw === null || liveRaw === undefined ? null : normaliseNumber(liveRaw, NaN);

  const purchaseDate = parseDateInput(doc?.purchase_date) ?? parseDateInput(doc?.created_at);

  const costRaw = doc?.cost_price;
  const cost =
    costRaw === null || costRaw === undefined ? null : normaliseNumber(costRaw, NaN);

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
    !isClosed ||
    (resolvedClosingDate &&
      toIsoDateOnly(resolvedClosingDate) === toIsoDateOnly(new Date()));
  const intradayChange = intradayAllowed && end !== null && prev !== null ? end - prev : null;
  const intradayPct =
    intradayAllowed && end !== null && prev !== null ? ((end / prev) - 1) * 100 : null;

  let price1yBase = null;
  let change1yPct = null;
  if (end !== null && end !== 0) {
    if (
      purchaseDate &&
      purchaseDate > oneYearAgo &&
      cost !== null &&
      Number.isFinite(cost) &&
      cost !== 0
    ) {
      price1yBase = cost;
    } else if (historic !== null && Number.isFinite(historic) && historic !== 0) {
      price1yBase = historic;
    }

    if (price1yBase !== null) {
      change1yPct = ((end / price1yBase) - 1) * 100;
    }
  }

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

  const epsForPe =
    parseNullableNumber(snapshot?.epsDilutedPositive) ?? parseNullableNumber(snapshot?.epsDiluted);
  const computedPeRatio = computePeRatio(end, epsForPe);
  const peRatioValue = isOverrideEnabled(overrides, "pe_ratio")
    ? storedPeRatio
    : computedPeRatio ?? storedPeRatio;

  const computedPegRatio = computePegRatio(peRatioValue, parseNullableNumber(snapshot?.epsCagrPct));
  const pegRatioValue = isOverrideEnabled(overrides, "peg_ratio")
    ? storedPegRatio
    : computedPegRatio ?? storedPegRatio;

  const safeDoc = doc && typeof doc === "object" ? { ...doc } : doc;
  if (safeDoc && Object.prototype.hasOwnProperty.call(safeDoc, "api_token")) {
    delete safeDoc.api_token;
  }

  const enriched = {
    ...safeDoc,
    purchase_date: toIsoDateTime(doc?.purchase_date),
    created_at: toIsoDateTime(doc?.created_at),
    updated_at: toIsoDateTime(doc?.updated_at),
    fundamentals_updated_at: toIsoDateTime(doc?.fundamentals_updated_at),
    fundamentals_snapshot_updated_at: toIsoDateTime(doc?.fundamentals_snapshot_updated_at),
    fundamentals_snapshot: snapshot,
    closing_date: toIsoDateTime(resolvedClosingDate),
    current_price: end,
    long_name: priceEntry?.long_name ?? null,
    intraday_change: intradayChange,
    intraday_change_pct: intradayPct,
    currency: priceEntry?.currency ?? null,
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
  };
  return withStringId(enriched);
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

function computePeRatio(currentPrice, eps) {
  const price = normaliseNumber(currentPrice, NaN);
  const epsValue = normaliseNumber(eps, NaN);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(epsValue) || epsValue === 0) {
    return null;
  }
  const pe = price / epsValue;
  return Number.isFinite(pe) ? pe : null;
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
          !disabled && (!doc?.fundamentals_snapshot || doc.fundamentals_snapshot === null || snapshotStale);
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

    const result = docs.map((doc) => {
      const sym = String(doc.symbol || "").toUpperCase();
      const apiKey = doc?._id ? String(doc._id) : null;
      const priceEntry = doc?.api_url && apiKey ? apiPriceMap[apiKey] ?? {} : priceMap[sym] ?? {};
      const tagNames = ensureArray(doc.tags)
        .map((id) => tagNamesMap[String(id)])
        .filter(Boolean);
      return enrichDocument(doc, priceEntry, tagNames);
    });

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
    const isClosed = Boolean(body.is_closed);
    const doc = {
      symbol: String(body.symbol || "").toUpperCase(),
      display_name: displayName,
      api_url: apiUrl,
      api_token: isCustomApi ? apiToken : null,
      quantity: normaliseNumber(body.quantity, 0),
      cost_price: normaliseNumber(body.cost_price, 0),
      tags: tagIds,
      is_closed: isClosed,
      closing_price:
        body.closing_price === null || body.closing_price === undefined
          ? null
          : normaliseNumber(body.closing_price),
      closing_date: isClosed ? closingDate ?? now : null,
      purchase_date: purchaseDate ?? now,
      boursorama_forum_url: isCustomApi
        ? null
        : normalizeForumUrl(body.boursorama_forum_url, body.symbol),
      revenue_growth_yoy_pct: parseNullableNumber(body.revenue_growth_yoy_pct),
      pe_ratio: parseNullableNumber(body.pe_ratio),
      peg_ratio: parseNullableNumber(body.peg_ratio),
      roe_5y_avg_pct: parseNullableNumber(body.roe_5y_avg_pct),
      quick_ratio: parseNullableNumber(body.quick_ratio),
      indicator_disabled: isCustomApi ? true : asBoolean(body.indicator_disabled),
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
    const inserted = await positions.findOne({ _id: result.insertedId });
    if (!inserted) {
      return res.status(500).json({ detail: "Failed to create position" });
    }

    let priceEntry = {};
    const symbol = inserted?.symbol ? String(inserted.symbol).toUpperCase() : null;
    if (inserted.api_url) {
      const series = await fetchCustomApiDailySeries(inserted.api_url, inserted.api_token);
      priceEntry = computePriceEntryFromDailySeries(series);

      if (body.purchase_date === undefined && series.length) {
        const inferred = new Date(series[0].ts);
        inserted.purchase_date = inferred;
        await positions.updateOne({ _id: inserted._id }, { $set: { purchase_date: inferred } });
      }
    } else {
      const priceMap = symbol ? await getPrices([symbol]) : {};
      priceEntry = priceMap[symbol] ?? {};
    }
    const tagNames = await getTagNames(inserted?.tags);
    const response = enrichDocument(inserted, priceEntry, tagNames);
    res.status(201).json(response);
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

    const nextIsClosed =
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

    if (
      nextIsClosed &&
      !hasClosingDate &&
      body.is_closed === undefined &&
      parseDateInput(existing?.closing_date) === null &&
      parseDateInput(existing?.updated_at) !== null
    ) {
      updates.closing_date = parseDateInput(existing.updated_at);
    }

    if (Object.keys(updates).length) {
      updates.updated_at = new Date();
      await positions.updateOne({ _id: objectId }, { $set: updates });
    }

    const doc = await positions.findOne({ _id: objectId });
    if (!doc) {
      return res.status(404).json({ detail: "Position not found" });
    }
    const symbol = doc?.symbol ? String(doc.symbol).toUpperCase() : null;
    let priceEntry = {};
    if (doc.api_url) {
      const series = await fetchCustomApiDailySeries(doc.api_url, doc.api_token);
      priceEntry = computePriceEntryFromDailySeries(series);
    } else {
      const priceMap = symbol ? await getPrices([symbol]) : {};
      priceEntry = priceMap[symbol] ?? {};
    }
    const tagNames = await getTagNames(doc?.tags);
    const response = enrichDocument(doc, priceEntry, tagNames);
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
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get("/summary", async (req, res, next) => {
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

    let totalMarketValue = 0;
    let totalUnrealisedPl = 0;

    docs.forEach((doc) => {
      if (asBoolean(doc.is_closed)) {
        return;
      }
      const sym = String(doc.symbol || "").toUpperCase();
      const apiKey = doc?._id ? String(doc._id) : null;
      const priceEntry = doc?.api_url && apiKey ? apiPriceMap[apiKey] ?? {} : priceMap[sym] ?? {};
      const current = priceEntry.current;
      if (current === null || current === undefined) {
        return;
      }
      const qty = normaliseNumber(doc.quantity);
      const cost = normaliseNumber(doc.cost_price);

      totalMarketValue += current * qty;
      totalUnrealisedPl += (current - cost) * qty;
    });

    res.json({
      total_market_value: totalMarketValue,
      total_unrealized_pl: totalUnrealisedPl,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/summary/debug", async (req, res, next) => {
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

    let total = 0;
    const rows = [];
    docs.forEach((doc) => {
      if (asBoolean(doc.is_closed)) {
        return;
      }
      const sym = String(doc.symbol || "").toUpperCase();
      const qty = normaliseNumber(doc.quantity);
      const apiKey = doc?._id ? String(doc._id) : null;
      const entry = doc?.api_url && apiKey ? apiPriceMap[apiKey] ?? {} : priceMap[sym] ?? {};
      const current = entry.current;

      if (current === null || current === undefined) {
        rows.push({
          symbol: sym,
          qty,
          used_price: null,
          subtotal: 0,
          note: doc?.api_url ? "missing live price (custom API)" : "missing live price",
        });
        return;
      }

      const subtotal = current * qty;
      total += subtotal;
      rows.push({
        symbol: sym,
        qty,
        used_price: current,
        subtotal,
        note: "",
      });
    });

    res.json({ total_market_value: total, rows });
  } catch (error) {
    next(error);
  }
});

router.get("/tags/summary", async (req, res, next) => {
  try {
    const { positions, tags } = getCollections();
    const docs = await positions.find().limit(1000).toArray();
    const apiDocs = docs.filter((doc) => Boolean(doc?.api_url));
    const stockDocs = docs.filter((doc) => !doc?.api_url);
    const symbols = uniqueUppercaseSymbols(stockDocs);
    const [priceMap, apiPriceMap] = await Promise.all([
      getPrices(symbols),
      getCustomApiPricesForPositions(apiDocs),
    ]);

    const allTagIds = new Set();
    docs.forEach((doc) => ensureArray(doc.tags).forEach((tag) => allTagIds.add(String(tag))));
    const tagDocs = Array.from(allTagIds).length
      ? await tags
          .find({ _id: { $in: Array.from(allTagIds).map((id) => new ObjectId(id)) } })
          .toArray()
      : [];
    const tagNameMap = new Map(tagDocs.map((doc) => [String(doc._id), doc.name]));

    const buckets = new Map();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    docs.forEach((doc) => {
      if (asBoolean(doc.is_closed)) {
        return;
      }
      const sym = String(doc.symbol || "").toUpperCase();
      const apiKey = doc?._id ? String(doc._id) : null;
      const priceEntry = doc?.api_url && apiKey ? apiPriceMap[apiKey] ?? {} : priceMap[sym] ?? {};
      const current = priceEntry.current;
      if (current === null || current === undefined) {
        return;
      }
      const change = priceEntry.change;
      const price10d = priceEntry.price_10d;

      const qty = normaliseNumber(doc.quantity);
      const cost = normaliseNumber(doc.cost_price);

      const mvNow = current * qty;
      const mvPrev =
        change !== null && change !== undefined ? (current - change) * qty : null;
      const mv10d =
        price10d !== null && price10d !== undefined ? price10d * qty : null;
      const purchaseDate = parseDateInput(doc?.purchase_date) ?? parseDateInput(doc?.created_at);
      const basePrice1y = purchaseDate && purchaseDate > oneYearAgo ? cost : priceEntry?.price_1y;
      const mv1y =
        basePrice1y !== null && basePrice1y !== undefined ? normaliseNumber(basePrice1y, 0) * qty : null;
      const pl = (current - cost) * qty;

      ensureArray(doc.tags).forEach((tagId) => {
        const name = tagNameMap.get(String(tagId));
        if (!name) {
          return;
        }
        const bucket =
          buckets.get(name) ||
          buckets.set(name, {
            tag: name,
            total_quantity: 0,
            total_market_value: 0,
            total_unrealized_pl: 0,
            _mv_prev_base: 0,
            _mv_prev_now: 0,
            _mv_10d_base: 0,
            _mv_10d_now: 0,
            _mv_1y_base: 0,
            _mv_1y_now: 0,
          }).get(name);

        bucket.total_quantity += qty;
        bucket.total_market_value += mvNow;
        bucket.total_unrealized_pl += pl;

        if (mvPrev !== null && mvPrev !== 0) {
          bucket._mv_prev_base += mvPrev;
          bucket._mv_prev_now += mvNow - mvPrev;
        }
        if (mv10d !== null && mv10d !== 0) {
          bucket._mv_10d_base += mv10d;
          bucket._mv_10d_now += mvNow - mv10d;
        }
        if (mv1y !== null && mv1y !== 0) {
          bucket._mv_1y_base += mv1y;
          bucket._mv_1y_now += mvNow - mv1y;
        }
      });
    });

    const output = [];
    buckets.forEach((bucket) => {
      const prevDen = bucket._mv_prev_base;
      const prevNum = bucket._mv_prev_now;
      const tenDen = bucket._mv_10d_base;
      const tenNum = bucket._mv_10d_now;
      const oneDen = bucket._mv_1y_base;
      const oneNum = bucket._mv_1y_now;

      output.push({
        tag: bucket.tag,
        total_quantity: bucket.total_quantity,
        total_market_value: bucket.total_market_value,
        total_unrealized_pl: bucket.total_unrealized_pl,
        intraday_change_pct: prevDen ? (prevNum / prevDen) * 100 : null,
        change_10d_pct: tenDen ? (tenNum / tenDen) * 100 : null,
        change_1y_pct: oneDen ? (oneNum / oneDen) * 100 : null,
      });
    });

    res.json(output);
  } catch (error) {
    next(error);
  }
});

router.get("/tags/timeseries", async (req, res, next) => {
  try {
    const { positions, tags } = getCollections();
    const { period = "6mo", interval = "1d" } = req.query;
    const docs = await positions.find().limit(1000).toArray();

    const openPositions = docs.filter((doc) => !asBoolean(doc.is_closed));
    if (!openPositions.length) {
      return res.json({ tags: {}, total: [] });
    }

    const openApiPositions = openPositions.filter((doc) => Boolean(doc?.api_url));
    const openStockPositions = openPositions.filter((doc) => !doc?.api_url);

    const symbols = uniqueUppercaseSymbols(openStockPositions);
    const historyMap = symbols.length ? await getPriceHistory(symbols, { period, interval }) : {};

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

    const tagSeries = new Map();
    const totalSeries = new Map();

    openPositions.forEach((doc) => {
      const sym = String(doc.symbol || "").toUpperCase();
      const apiKey = doc?._id ? String(doc._id) : null;
      const history = doc?.api_url && apiKey ? apiHistoryMap[apiKey] ?? [] : historyMap[sym] ?? [];
      const qty = normaliseNumber(doc.quantity);
      const cost = normaliseNumber(doc.cost_price);
      const purchaseDateCutoff =
        toIsoDateOnly(doc.purchase_date) ?? toIsoDateOnly(doc.created_at);

      if (!history.length || qty === 0) {
        return;
      }

      const tagNames = ensureArray(doc.tags)
        .map((id) => tagNameMap.get(String(id)))
        .filter(Boolean);

      history.forEach((point) => {
        const { date, close } = point;
        if (!date || close === null || close === undefined) {
          return;
        }
        if (purchaseDateCutoff && date < purchaseDateCutoff) {
          return;
        }
        const mv = close * qty;
        const pl = (close - cost) * qty;

        const totalEntry =
          totalSeries.get(date) ||
          totalSeries.set(date, { date, market_value: 0, unrealized_pl: 0 }).get(date);
        totalEntry.market_value += mv;
        totalEntry.unrealized_pl += pl;

        tagNames.forEach((name) => {
          const bucket =
            tagSeries.get(name) ||
            tagSeries
              .set(name, new Map())
              .get(name);
          const entry =
            bucket.get(date) || bucket.set(date, { date, market_value: 0, unrealized_pl: 0 }).get(date);
          entry.market_value += mv;
          entry.unrealized_pl += pl;
        });
      });
    });

    const tagsOutput = {};
    tagSeries.forEach((series, name) => {
      const sorted = Array.from(series.values()).sort((a, b) =>
        a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
      );
      tagsOutput[name] = sorted;
    });

    const totalOutput = Array.from(totalSeries.values()).sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    );

    res.json({ tags: tagsOutput, total: totalOutput });
  } catch (error) {
    next(error);
  }
});

export default router;
