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

export const config = {
  mongodbUri,
  mongodbDb: MONGODB_DB || MONGODB_DATABASE || MONGODB_DEFAULT_DB || inferredDb || "aiportfolio",
  port: Number(PORT) || 4000,
};
