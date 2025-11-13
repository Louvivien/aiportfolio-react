import { ObjectId } from "mongodb";

export function toObjectId(value) {
  if (!value) {
    return null;
  }
  if (value instanceof ObjectId) {
    return value;
  }
  try {
    return new ObjectId(String(value));
  } catch (error) {
    return null;
  }
}

export function asBoolean(value) {
  if (value === true) {
    return true;
  }
  if (typeof value === "string") {
    const normalised = value.trim().toLowerCase();
    return ["1", "true", "yes", "y", "on"].includes(normalised);
  }
  if (typeof value === "number") {
    return value === 1;
  }
  return false;
}

export function normaliseNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function withStringId(document) {
  if (!document) {
    return null;
  }
  return {
    ...document,
    _id: document._id ? String(document._id) : undefined,
    id: document._id ? String(document._id) : document.id,
  };
}

export function uniqueUppercaseSymbols(documents) {
  const set = new Set();
  for (const doc of documents) {
    if (doc?.symbol) {
      set.add(String(doc.symbol).toUpperCase());
    }
  }
  return Array.from(set);
}

export function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

export function parseDateInput(value) {
  if (!value && value !== 0) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const date = new Date(`${trimmed}T00:00:00.000Z`);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

export function toIsoDateTime(value) {
  const date = parseDateInput(value);
  return date ? date.toISOString() : null;
}

export function toIsoDateOnly(value) {
  const iso = toIsoDateTime(value);
  return iso ? iso.slice(0, 10) : null;
}
