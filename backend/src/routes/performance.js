import { Router } from 'express';
import { getPersonalPerformance2026 } from '../personalPerformanceService.js';
import { getDb } from '../db.js';
const router = Router();
// Evidence is separate from position quantities and external flows: importing a
// broker trade here must not create a second holding or a second XIRR cash flow.
router.get('/2026/reconciliation', async (_req, res, next) => {
  try {
    const evidence = await getDb().collection('performance_inputs').findOne(
      { _id: 'personal-management-2026-identified-flows-v1' },
      { projection: { _id: 0, accounting_reconciliation: 1 } },
    );
    res.set('Cache-Control', 'no-store').json(evidence?.accounting_reconciliation ?? null);
  } catch (error) { next(error); }
});
router.get('/2026', async (_req, res, next) => {
  try { res.set('Cache-Control', 'no-store').json(await getPersonalPerformance2026()); }
  catch (error) { next(error); }
});
export default router;
