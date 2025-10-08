import { createApp } from "../src/app.js";

let cachedApp;

async function getApp() {
  if (!cachedApp) {
    cachedApp = await createApp();
  }
  return cachedApp;
}

export default async function handler(req, res) {
  const app = await getApp();
  return app(req, res);
}
