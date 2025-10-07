import express from "express";
import cors from "cors";
import { initDb } from "./db.js";
import positionsRouter from "./routes/positions.js";
import tagsRouter from "./routes/tags.js";

let appPromise;

async function buildApp() {
  await initDb();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.use("/api/tags", tagsRouter);
  app.use("/api/positions", positionsRouter);

  app.use((err, req, res, next) => {
    // eslint-disable-next-line no-console
    console.error(err);
    const status = err?.status || 500;
    const detail = err?.message || "Internal server error";
    res.status(status).json({ detail });
  });

  return app;
}

export async function createApp() {
  if (!appPromise) {
    appPromise = buildApp();
  }
  return appPromise;
}

export default createApp;
