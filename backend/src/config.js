import dotenv from "dotenv";

dotenv.config();

const {
  MONGODB_URI,
  MONGODB_URL,
  MONGODB_CONNECTION_STRING,
  MONGODB_CONN_STRING,
  MONGODB_ATLAS_URI,
  MONGODB_DB,
  MONGODB_DATABASE,
  MONGODB_DEFAULT_DB,
  MONGODB_SERVER_SELECTION_TIMEOUT_MS,
  MONGODB_CONNECT_TIMEOUT_MS,
  MONGODB_SOCKET_TIMEOUT_MS,
  PORT,
} = process.env;

const mongodbUri =
  MONGODB_URI ||
  MONGODB_URL ||
  MONGODB_CONNECTION_STRING ||
  MONGODB_CONN_STRING ||
  MONGODB_ATLAS_URI;

if (!mongodbUri) {
  throw new Error(
    "MongoDB connection string is not set. Configure `MONGODB_URI` or enable the Vercel MongoDB Atlas integration.",
  );
}

const inferDatabaseName = (uri) => {
  try {
    const normalised = uri.replace(/^mongodb(\+srv)?:\/\//i, "https://");
    const url = new URL(normalised);
    const path = url.pathname.replace(/^\//, "");
    return path || null;
  } catch {
    return null;
  }
};

const inferredDb = inferDatabaseName(mongodbUri);

const parsePositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const config = {
  mongodbUri,
  mongodbDb: MONGODB_DB || MONGODB_DATABASE || MONGODB_DEFAULT_DB || inferredDb || "aiportfolio",
  mongodbOptions: {
    serverSelectionTimeoutMS: parsePositiveNumber(MONGODB_SERVER_SELECTION_TIMEOUT_MS, 8000),
    connectTimeoutMS: parsePositiveNumber(MONGODB_CONNECT_TIMEOUT_MS, 8000),
    socketTimeoutMS: parsePositiveNumber(MONGODB_SOCKET_TIMEOUT_MS, 20000),
    maxIdleTimeMS: 60_000,
  },
  port: Number(PORT) || 4000,
};
