import { Router } from "express";
import { ObjectId } from "mongodb";
import { getCollections } from "../db.js";
import { getPrices, getPriceHistory } from "../priceService.js";
import {
  asBoolean,
  ensureArray,
  normaliseNumber,
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
  const enriched = {
    ...doc,
    purchase_date: toIsoDateTime(doc?.purchase_date),
    created_at: toIsoDateTime(doc?.created_at),
    updated_at: toIsoDateTime(doc?.updated_at),
    current_price: computeEffectivePrice(doc, priceEntry),
    long_name: priceEntry?.long_name ?? null,
    intraday_change: priceEntry?.change ?? null,
    intraday_change_pct: priceEntry?.change_pct ?? null,
    currency: priceEntry?.currency ?? null,
    price_10d: priceEntry?.price_10d ?? null,
    change_10d_pct: priceEntry?.change_10d_pct ?? null,
    tags: tagNames,
  };
  return withStringId(enriched);
}

router.get("/", async (req, res, next) => {
  try {
    const { positions } = getCollections();
    const docs = await positions.find().limit(1000).toArray();
    const symbols = uniqueUppercaseSymbols(docs);
    const priceMap = await getPrices(symbols);

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

    const result = docs.map((doc) => {
      const sym = String(doc.symbol || "").toUpperCase();
      const priceEntry = priceMap[sym] ?? {};
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
    const tagIds = await upsertTagsReturnIds(body.tags || []);
    const now = new Date();
    const purchaseDate = parseDateInput(body.purchase_date);
    const doc = {
      symbol: String(body.symbol || "").toUpperCase(),
      quantity: normaliseNumber(body.quantity, 0),
      cost_price: normaliseNumber(body.cost_price, 0),
      tags: tagIds,
      is_closed: Boolean(body.is_closed),
      closing_price:
        body.closing_price === null || body.closing_price === undefined
          ? null
          : normaliseNumber(body.closing_price),
      purchase_date: purchaseDate ?? now,
      created_at: now,
      updated_at: now,
    };

    const result = await positions.insertOne(doc);
    const inserted = await positions.findOne({ _id: result.insertedId });

    const symbol = inserted?.symbol ? String(inserted.symbol).toUpperCase() : null;
    const priceMap = symbol ? await getPrices([symbol]) : {};
    const tagNames = await getTagNames(inserted?.tags);
    const response = enrichDocument(inserted, priceMap[symbol] ?? {}, tagNames);
    res.status(201).json(response);
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
      updates.is_closed = Boolean(body.is_closed);
    }
    if (body.closing_price !== undefined) {
      updates.closing_price =
        body.closing_price === null || body.closing_price === undefined
          ? null
          : normaliseNumber(body.closing_price);
    }
    if (body.tags !== undefined) {
      updates.tags = await upsertTagsReturnIds(body.tags || []);
    }
    if (body.purchase_date !== undefined) {
      const parsedDate = parseDateInput(body.purchase_date);
      updates.purchase_date = parsedDate ?? null;
    }

    if (Object.keys(updates).length) {
      updates.updated_at = new Date();
      await positions.updateOne({ _id: objectId }, { $set: updates });
    }

    const doc = await positions.findOne({ _id: objectId });
    const symbol = doc?.symbol ? String(doc.symbol).toUpperCase() : null;
    const priceMap = symbol ? await getPrices([symbol]) : {};
    const tagNames = await getTagNames(doc?.tags);
    const response = enrichDocument(doc, priceMap[symbol] ?? {}, tagNames);
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
    const symbols = uniqueUppercaseSymbols(docs);
    const priceMap = await getPrices(symbols);

    let totalMarketValue = 0;
    let totalUnrealisedPl = 0;

    docs.forEach((doc) => {
      if (asBoolean(doc.is_closed)) {
        return;
      }
      const sym = String(doc.symbol || "").toUpperCase();
      const priceEntry = priceMap[sym] ?? {};
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
    const symbols = uniqueUppercaseSymbols(docs);
    const priceMap = await getPrices(symbols);

    let total = 0;
    const rows = [];
    docs.forEach((doc) => {
      if (asBoolean(doc.is_closed)) {
        return;
      }
      const sym = String(doc.symbol || "").toUpperCase();
      const qty = normaliseNumber(doc.quantity);
      const entry = priceMap[sym] ?? {};
      const current = entry.current;

      if (current === null || current === undefined) {
        rows.push({
          symbol: sym,
          qty,
          used_price: null,
          subtotal: 0,
          note: "missing live price",
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
    const symbols = uniqueUppercaseSymbols(docs);
    const priceMap = await getPrices(symbols);

    const allTagIds = new Set();
    docs.forEach((doc) => ensureArray(doc.tags).forEach((tag) => allTagIds.add(String(tag))));
    const tagDocs = Array.from(allTagIds).length
      ? await tags
          .find({ _id: { $in: Array.from(allTagIds).map((id) => new ObjectId(id)) } })
          .toArray()
      : [];
    const tagNameMap = new Map(tagDocs.map((doc) => [String(doc._id), doc.name]));

    const buckets = new Map();

    docs.forEach((doc) => {
      if (asBoolean(doc.is_closed)) {
        return;
      }
      const sym = String(doc.symbol || "").toUpperCase();
      const priceEntry = priceMap[sym] ?? {};
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
      });
    });

    const output = [];
    buckets.forEach((bucket) => {
      const prevDen = bucket._mv_prev_base;
      const prevNum = bucket._mv_prev_now;
      const tenDen = bucket._mv_10d_base;
      const tenNum = bucket._mv_10d_now;

      output.push({
        tag: bucket.tag,
        total_quantity: bucket.total_quantity,
        total_market_value: bucket.total_market_value,
        total_unrealized_pl: bucket.total_unrealized_pl,
        intraday_change_pct: prevDen ? (prevNum / prevDen) * 100 : null,
        change_10d_pct: tenDen ? (tenNum / tenDen) * 100 : null,
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

    const symbols = uniqueUppercaseSymbols(openPositions);
    const historyMap = await getPriceHistory(symbols, { period, interval });

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
      const history = historyMap[sym] ?? [];
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
