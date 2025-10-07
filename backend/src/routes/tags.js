import { Router } from "express";
import { getCollections } from "../db.js";
import { withStringId } from "../utils.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const { tags } = getCollections();
    const docs = await tags.find().sort({ name: 1 }).toArray();
    res.json(docs.map((doc) => ({ id: String(doc._id), name: doc.name })));
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { tags } = getCollections();
    const { name } = req.body ?? {};
    if (!name) {
      return res.status(400).json({ detail: "name is required" });
    }
    const now = new Date();
    const result = await tags.insertOne({ name, created_at: now, updated_at: now });
    const doc = await tags.findOne({ _id: result.insertedId });
    res.status(201).json(withStringId(doc));
  } catch (error) {
    next(error);
  }
});

export default router;
