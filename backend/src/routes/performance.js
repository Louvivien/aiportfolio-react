import { Router } from 'express';
import { getPersonalPerformance2026 } from '../personalPerformanceService.js';
const router = Router();
router.get('/2026', async (_req, res, next) => {
  try { res.set('Cache-Control', 'no-store').json(await getPersonalPerformance2026()); }
  catch (error) { next(error); }
});
export default router;
