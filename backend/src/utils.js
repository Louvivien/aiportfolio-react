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
