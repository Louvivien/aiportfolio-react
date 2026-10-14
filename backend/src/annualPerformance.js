import { createHash } from 'node:crypto';
import { validDate } from './personalPerformance.js';
import { positionLots } from './finance.js';

export const LEGACY_PERFORMANCE_ID = 'personal-management-2026-identified-flows-v1';
export const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export function performanceYear(value) {
  const year = Number(value);
  if (!/^\d{4}$/.test(String(value)) || !Number.isInteger(year) || year < 2026 || year > 2100) fail(400, 'Année invalide (2026–2100).');
  return year;
}
export function financialPositions(docs) {
  return docs.map((doc) => ({ position_id: String(doc._id), symbol: doc.symbol, custom_source: Boolean(doc.api_url),
    lots: positionLots(doc).map((l) => ({ id: l.id ?? null, quantity: l.quantity, cost_price: l.cost_price,
      purchase_date: l.purchase_date, is_closed: l.is_closed, closing_date: l.closing_date, closing_price: l.closing_price })) }))
    .sort((a, b) => a.position_id.localeCompare(b.position_id));
}
export const positionsFingerprint = (docs) => createHash('sha256').update(JSON.stringify(financialPositions(docs))).digest('hex');
export function newAnnualInput(scope = {}) {
  return { dated_movements: [], opening_cash_eur: null, current_cash_eur: null, current_cash_date: null,
    flow_history_complete: false, transfers_reviewed: false, scope_complete: false, performance_scope: scope };
}
export function validateAnnualInputPatch(year, patch, today) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) fail(400, 'Données invalides.');
  const allowed = new Set(['dated_movements', 'opening_cash_eur', 'opening_cash_status', 'current_cash_eur', 'current_cash_date', 'flow_history_complete', 'transfers_reviewed', 'scope_complete']);
  if (Object.keys(patch).some((key) => !allowed.has(key))) fail(400, 'Champ non modifiable.');
  for (const key of ['opening_cash_eur', 'current_cash_eur']) if (key in patch && (typeof patch[key] !== 'number' || !Number.isFinite(patch[key]) || patch[key] < 0 || !Number.isSafeInteger(Math.round(patch[key] * 100)) || Math.abs(patch[key] * 100 - Math.round(patch[key] * 100)) > 1e-6)) fail(400, 'Les liquidités doivent être un montant EUR positif ou nul, au centime.');
  if ('current_cash_eur' in patch || 'current_cash_date' in patch) {
    if (!('current_cash_eur' in patch) || !validDate(patch.current_cash_date) || patch.current_cash_date < `${year}-01-01` || patch.current_cash_date > `${year}-12-31` || patch.current_cash_date > today) fail(400, 'Renseigner ensemble le solde et sa date dans l’année, sans date future.');
  }
  if ('opening_cash_status' in patch && !['estimated', 'user_confirmed', 'documented'].includes(patch.opening_cash_status)) fail(400, 'Statut des liquidités invalide.');
  for (const key of ['flow_history_complete', 'transfers_reviewed', 'scope_complete']) if (key in patch && typeof patch[key] !== 'boolean') fail(400, 'Confirmation invalide.');
  if ('dated_movements' in patch) {
    if (!Array.isArray(patch.dated_movements) || patch.dated_movements.length > 5000) fail(400, 'Liste de flux invalide.');
    const ids = new Set();
    patch = { ...patch, dated_movements: patch.dated_movements.map((m) => {
      if (!m || typeof m.id !== 'string' || !/^[\w:.-]{1,150}$/.test(m.id) || ids.has(m.id)) fail(400, 'Identifiant de flux absent ou dupliqué.');
      ids.add(m.id);
      if (!validDate(m.date) || m.date < `${year}-01-01` || m.date > `${year}-12-31` || m.date > today) fail(400, 'Date de flux hors période ou future.');
      if (!['deposit', 'withdrawal', 'promotion'].includes(m.direction) || m.currency !== 'EUR' || !Number.isSafeInteger(m.amount_cents) || m.amount_cents <= 0 || typeof m.external_to_combined_scope !== 'boolean' || typeof m.date_confirmed !== 'boolean') fail(400, 'Flux invalide : montant EUR positif, type et nature externe requis.');
      return { id: m.id, date: m.date, direction: m.direction, currency: 'EUR', amount_cents: m.amount_cents,
        external_to_combined_scope: m.external_to_combined_scope, date_confirmed: m.date_confirmed,
        ...(typeof m.account === 'string' ? { account: m.account.slice(0, 100) } : {}),
        note: typeof m.note === 'string' ? m.note.slice(0, 1000) : '' };
    }) };
  }
  return patch;
}

// A reopening preserves the old close in history. Its successor is updated only
// after the user reviews and explicitly validates a new closing snapshot.
export function rolloverState(state, snapshot, next, updateNext, now) {
  if (!snapshot.complete || !Number.isFinite(snapshot.total_eur) || snapshot.cash_eur === null) fail(400, 'Clôture non valorisée.');
  if (next?.closing_snapshot) fail(409, 'L’année suivante est déjà clôturée. Réouvrir les années suivantes en commençant par la plus récente.');
  if ((next?.opening_snapshot || Number.isFinite(next?.input?.opening_cash_eur)) && !updateNext) fail(409, 'Confirmer explicitement la mise à jour de l’ouverture suivante.');
  if (next?.opening_snapshot && next.opening_source_year !== state._id) fail(409, 'L’ouverture suivante a une autre origine ; rapprochement nécessaire.');
  const result = next ? structuredClone(next) : { _id: state._id + 1, revision: 0, input: newAnnualInput(state.input.performance_scope) };
  result.opening_snapshot = structuredClone(snapshot);
  result.opening_source_year = state._id;
  result.opening_source_revision = state.revision + 1;
  result.opening_needs_review = false;
  result.input.opening_cash_eur = snapshot.cash_eur;
  result.input.opening_cash_status = 'user_confirmed';
  result.input.performance_scope = structuredClone(state.input.performance_scope ?? {});
  result.revision += 1;
  result.updated_at = now;
  return result;
}
