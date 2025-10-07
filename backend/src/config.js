import dotenv from "dotenv";

dotenv.config();

const { MONGODB_URI, PORT, MONGODB_DB } = process.env;

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is not set. Copy .env.example to .env and configure it.");
}

export const config = {
  mongodbUri: MONGODB_URI,
  mongodbDb: MONGODB_DB || "aiportfolio",
  port: Number(PORT) || 4000,
};
