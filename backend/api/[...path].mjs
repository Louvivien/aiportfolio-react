import { createApp } from "../src/app.js";

let cachedApp;

async function getApp() {
  if (!cachedApp) {
    cachedApp = await createApp();
  }
  return cachedApp;
}

export default async function handler(req, res) {
  const url = req.url || "";
  if (!url.startsWith("/api")) {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ detail: "Not found" }));
    return;
  }

  const app = await getApp();
  return app(req, res);
}
