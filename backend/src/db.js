import { MongoClient } from "mongodb";
import { config } from "./config.js";

let client;
let database;

export async function initDb() {
  if (database) {
    return database;
  }
  client = new MongoClient(config.mongodbUri);
  await client.connect();
  database = client.db(config.mongodbDb);
  return database;
}

export function getDb() {
  if (!database) {
    throw new Error("Database has not been initialised. Call initDb() first.");
  }
  return database;
}

export function getCollections() {
  const db = getDb();
  return {
    positions: db.collection("positions"),
    tags: db.collection("tags"),
  };
}

export async function shutdown() {
  if (client) {
    await client.close();
    client = undefined;
    database = undefined;
  }
}
