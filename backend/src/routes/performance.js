import { Router } from 'express';
import { annualState, getAnnualPerformance, annualManagement, updateAnnualInput, prepareNextYear, previewAnnualClose, commitAnnualClose, reopenAnnualYear, annualAudit } from '../annualPerformanceService.js';
const router = Router();
const handle = (fn) => async (req, res, next) => {
  try { res.set('Cache-Control', 'no-store').json(await fn(req)); } catch (error) { next(error); }
};
router.get('/:year/reconciliation', handle(async (req) => (await annualState(req.params.year)).input.accounting_reconciliation ?? null));
router.get('/:year/manage', handle((req) => annualManagement(req.params.year)));
router.get('/:year/audit', handle((req) => annualAudit(req.params.year)));
router.put('/:year/inputs', handle((req) => updateAnnualInput(req.params.year, req.body ?? {})));
router.post('/:year/prepare-next', handle((req) => prepareNextYear(req.params.year, req.body?.revision)));
router.post('/:year/close-preview', handle((req) => previewAnnualClose(req.params.year, req.body ?? {})));
router.post('/:year/close', handle((req) => commitAnnualClose(req.params.year, req.body ?? {})));
router.post('/:year/reopen', handle((req) => reopenAnnualYear(req.params.year, req.body?.revision)));
router.get('/:year', handle((req) => getAnnualPerformance(req.params.year)));
export default router;
