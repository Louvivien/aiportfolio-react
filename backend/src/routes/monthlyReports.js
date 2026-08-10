import { Router } from "express";
import {
  generateMonthlyReport,
  getMonthlyReport,
  listMonthlyReports,
  normalizeReportMonth,
} from "../monthlyReportService.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const generationDisabled =
      req.query.ensureLatest === "false" || req.query.ensureYearToDate === "false";
    const ensureYearToDate = !generationDisabled;
    const ensureLatest = req.query.ensureLatest === "true";
    const limitValue = Number(req.query.limit);
    const limit = Number.isFinite(limitValue)
      ? Math.min(120, Math.max(1, Math.floor(limitValue)))
      : 36;
    res.json(await listMonthlyReports({ ensureYearToDate, ensureLatest, limit }));
  } catch (error) {
    next(error);
  }
});

router.get("/:month", async (req, res, next) => {
  try {
    const month = normalizeReportMonth(req.params.month);
    if (!month) {
      return res.status(400).json({ detail: "Invalid report month. Expected YYYY-MM." });
    }
    res.json(await getMonthlyReport(month));
  } catch (error) {
    next(error);
  }
});

router.post("/:month/regenerate", async (req, res, next) => {
  try {
    const month = normalizeReportMonth(req.params.month);
    if (!month) {
      return res.status(400).json({ detail: "Invalid report month. Expected YYYY-MM." });
    }
    res.json(await generateMonthlyReport(month, { force: true }));
  } catch (error) {
    next(error);
  }
});

export default router;
