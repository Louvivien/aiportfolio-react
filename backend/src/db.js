import { MongoClient } from "mongodb";
import { config } from "./config.js";

let cachedClient;
let cachedDb;
let connectingPromise;

export async function initDb() {
  if (cachedDb) {
    return cachedDb;
  }
  if (connectingPromise) {
    return connectingPromise;
  }

  const client = new MongoClient(config.mongodbUri, {
    ...config.mongodbOptions,
  });

  connectingPromise = client
    .connect()
    .then((connected) => {
      cachedClient = connected;
      cachedDb = connected.db(config.mongodbDb);
      return cachedDb;
    })
    .catch((error) => {
      connectingPromise = undefined;
      if (!error?.status) {
        error.status = 503;
      }
      if (!error?.message) {
        error.message = "Failed to connect to MongoDB";
      }
      throw error;
    });

  return connectingPromise;
}

export function getDb() {
  if (!cachedDb) {
    throw new Error("Database has not been initialised. Call initDb() first.");
  }
  return cachedDb;
}

export function getCollections() {
  const db = getDb();
  return {
    positions: db.collection("positions"),
    tags: db.collection("tags"),
  };
}

export async function shutdown() {
  if (cachedClient) {
    await cachedClient.close();
    cachedClient = undefined;
    cachedDb = undefined;
    connectingPromise = undefined;
  }
}
