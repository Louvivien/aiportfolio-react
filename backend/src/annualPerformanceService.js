import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';
import { getPrices, getPriceHistory } from './priceService.js';
import { loadFxRates } from './fxService.js';
import { calculatePersonalPerformance } from './personalPerformance.js';
import { parisDate, performancePositions, reconstructSecurities } from './personalPerformanceValuation.js';
import { LEGACY_PERFORMANCE_ID, performanceYear, fail, financialPositions, positionsFingerprint, newAnnualInput, validateAnnualInputPatch, rolloverState } from './annualPerformance.js';

const missingSnapshot = (date, reason) => ({ date, known_value_eur: 0, complete: false, missing_symbols: [reason], position_count: 0, positions: [] });
export async function annualState(year, db = getDb()) {
  year = performanceYear(year);
  const stored = await db.collection('performance_years').findOne({ _id: year });
  if (stored) return stored;
  const legacy = await db.collection('performance_inputs').findOne({ _id: LEGACY_PERFORMANCE_ID });
  return { _id: year, revision: 0, input: year === 2026 && legacy ? legacy : newAnnualInput(legacy?.performance_scope), persisted: false };
}
export async function securitiesSnapshot(docs, input, date, historical) {
  const scoped = performancePositions(docs, input);
  const symbols = [...new Set(scoped.filter((d) => !d.api_url).map((d) => d.symbol))];
  const prices = await getPrices(symbols);
  const oldOpening = date === '2025-12-31';
  const requiredDates = oldOpening ? ['2025-12-30', date] : [date];
  const [histories, fx] = await Promise.all([
    historical ? getPriceHistory(symbols, { period: `${Math.max(13, Math.ceil((Date.now() - Date.parse(date)) / (28 * 86400000)) + 1)}mo`, requiredDates }) : {},
    loadFxRates(),
  ]);
  return reconstructSecurities(scoped, prices, histories, fx, date, historical, input.opening_quotes, input.opening_inventory,
    { details: true, allowPreviousQuote: !oldOpening });
}
export async function annualReport(year, state, docs, today = parisDate(), valueSecurities = securitiesSnapshot) {
  year = performanceYear(year);
  if (state.closing_snapshot && state.closed_report) return state.closed_report;
  const openingDate = `${year - 1}-12-31`, end = `${year}-12-31`, start = `${year}-01-01`;
  const input = structuredClone(state.input);
  let opening = state.opening_snapshot;
  if (!opening) opening = year === 2026 ? await valueSecurities(docs, input, openingDate, true)
    : missingSnapshot(openingDate, 'Valider la clôture de l’année précédente.');
  if (state.opening_needs_review) opening = { ...opening, complete: false, missing_symbols: ['La clôture précédente a été réouverte ; valider sa nouvelle version.'] };
  const asOf = today < start ? start : today > end ? end : today;
  const current = today >= start && today <= end ? await valueSecurities(docs, input, today, false)
    : missingSnapshot(asOf, today < start ? 'Année non commencée.' : 'Préparer et valider la clôture annuelle.');
  const fingerprint = positionsFingerprint(performancePositions(docs, input));
  const needsCash = state.cash_needs_review || (state.cash_fingerprint && state.cash_fingerprint !== fingerprint);
  if (needsCash) input.current_cash_eur = null;
  const report = calculatePersonalPerformance(input, opening, current, asOf, year);
  if (needsCash) report.missing.push('Les opérations ou flux ont changé : confirmer le solde global des liquidités.');
  if (today < start) report.missing.push('Année non commencée.');
  return { ...report, year, revision: state.revision, closed: false };
}
export async function getAnnualPerformance(year) {
  const state = await annualState(year);
  const docs = await getDb().collection('positions').find().toArray();
  return annualReport(Number(year), state, docs);
}
export async function annualManagement(year) {
  const db = getDb(), state = await annualState(year, db);
  const docs = await db.collection('positions').find().toArray();
  const report = await annualReport(Number(year), state, docs);
  const storedYears = await db.collection('performance_years').find({}, { projection: { _id: 1, closing_snapshot: 1 } }).toArray();
  return { year: Number(year), revision: state.revision, today: parisDate(), closed: Boolean(state.closing_snapshot),
    opening_source_year: state.opening_source_year ?? null, opening_needs_review: state.opening_needs_review ?? false,
    input: state.input, report, years: [...new Set([2026, Number(parisDate().slice(0, 4)), Number(year), ...storedYears.map((s) => s._id)])].sort(),
    opening_snapshot: state.opening_snapshot ?? report.opening, closing_snapshot: state.closing_snapshot ?? null };
}
function checkRevision(state, revision) {
  if (!Number.isInteger(revision) || state.revision !== revision) fail(409, 'Les données ont changé. Recharger avant de réessayer.');
}
async function storeVersion(db, before, after, action, session) {
  const opts = session ? { session } : {};
  await db.collection('performance_history').insertOne({ year: before._id, action, recorded_at: new Date(), before, after }, opts);
  if (before.persisted === false) {
    try { const { persisted, ...doc } = after; await db.collection('performance_years').insertOne(doc, opts); }
    catch (error) { if (error.code === 11000) fail(409, 'Cette année a été modifiée ; recharger.'); throw error; }
  } else {
    const result = await db.collection('performance_years').replaceOne({ _id: before._id, revision: before.revision }, after, opts);
    if (!result.matchedCount) fail(409, 'Modification simultanée ; recharger.');
  }
}
async function transaction(fn) {
  const db = getDb(), session = db.client.startSession();
  try { return await session.withTransaction(() => fn(db, session)); } finally { await session.endSession(); }
}
export async function updateAnnualInput(year, body) {
  year = performanceYear(year);
  const state = await annualState(year);
  checkRevision(state, body.revision);
  if (state.closing_snapshot) fail(409, 'Réouvrir l’année avant de modifier ses données.');
  const patch = validateAnnualInputPatch(year, body.patch, parisDate());
  if (state.opening_source_year && ('opening_cash_eur' in patch || 'opening_cash_status' in patch)) fail(409, 'Les liquidités initiales proviennent de la clôture précédente : corriger cette clôture.');
  const docs = await getDb().collection('positions').find().toArray();
  const after = { ...state, input: { ...state.input, ...patch, updated_at: new Date() }, revision: state.revision + 1, updated_at: new Date() };
  if (state.opening_snapshot && ('opening_cash_eur' in patch || 'opening_cash_status' in patch)) {
    after.opening_snapshot = { ...state.opening_snapshot, cash_eur: after.input.opening_cash_eur,
      total_eur: state.opening_snapshot.known_value_eur + after.input.opening_cash_eur, cash_status: after.input.opening_cash_status };
  }
  if ('dated_movements' in patch) {
    const previous = new Map((state.input.dated_movements ?? []).map((m) => [m.id, m]));
    // Preserve documentary provenance; editable fields alone come from the form.
    after.input.dated_movements = patch.dated_movements.map((m) => ({ ...previous.get(m.id), ...m }));
    after.cash_needs_review = true;
  }
  if ('current_cash_eur' in patch) {
    after.input.current_cash_status = 'user_confirmed';
    after.cash_needs_review = false;
    after.cash_fingerprint = positionsFingerprint(performancePositions(docs, after.input));
  }
  await transaction((db, session) => storeVersion(db, state, after, 'edit_inputs', session));
  return { revision: after.revision };
}
export async function prepareNextYear(year, revision) {
  year = performanceYear(year);
  const state = await annualState(year); checkRevision(state, revision);
  if (year >= 2100 || year > Number(parisDate().slice(0, 4))) fail(400, 'Seule la prochaine année peut être préparée à l’avance.');
  const next = { _id: year + 1, revision: 0, input: newAnnualInput(state.input.performance_scope), created_at: new Date() };
  await transaction(async (db, session) => {
    if (!await db.collection('performance_years').findOne({ _id: year + 1 }, { session }))
      await storeVersion(db, { _id: year + 1, revision: 0, persisted: false }, next, 'prepare_year', session);
  });
  return { year: year + 1 };
}
export async function previewAnnualClose(year, body, { today = parisDate(), valueSecurities = securitiesSnapshot } = {}) {
  year = performanceYear(year);
  const date = `${year}-12-31`;
  if (today <= date) fail(400, 'La clôture se prépare à partir du 1er janvier suivant, avec les cours du 31 décembre.');
  validateAnnualInputPatch(year, { current_cash_eur: body.cash_eur, current_cash_date: date }, today);
  const state = await annualState(year); checkRevision(state, body.revision);
  if (state.closing_snapshot) fail(409, 'Réouvrir l’année avant de corriger sa clôture.');
  if (state.opening_needs_review) fail(409, 'Valider d’abord la clôture précédente.');
  const docs = await getDb().collection('positions').find().toArray();
  const opening = state.opening_snapshot ?? (year === 2026 ? await valueSecurities(docs, state.input, `${year - 1}-12-31`, true) : null);
  if (!opening?.complete) fail(400, 'La situation initiale doit être valorisée avant la clôture.');
  const securities = await valueSecurities(docs, state.input, date, true);
  const snapshot = { ...securities, cash_eur: body.cash_eur, total_eur: securities.complete ? securities.known_value_eur + body.cash_eur : null,
    captured_at: new Date().toISOString(), scope: state.input.performance_scope, cash_status: 'user_confirmed' };
  const input = { ...state.input, current_cash_eur: body.cash_eur, current_cash_date: date };
  const report = calculatePersonalPerformance(input, opening, snapshot, date, year);
  const next = await getDb().collection('performance_years').findOne({ _id: year + 1 });
  const preview = { _id: randomUUID(), year, revision: state.revision, next_revision: next?.revision ?? null,
    fingerprint: positionsFingerprint(performancePositions(docs, input)), snapshot, report,
    input, source_positions: financialPositions(performancePositions(docs, input)),
    created_at: new Date(), expires_at: new Date(Date.now() + 30 * 60 * 1000),
    updates_next_opening: Boolean(next?.opening_snapshot || Number.isFinite(next?.input?.opening_cash_eur)) };
  await getDb().collection('performance_previews').insertOne(preview);
  return preview;
}
export async function commitAnnualClose(year, body) {
  year = performanceYear(year);
  if (typeof body.preview_id !== 'string') fail(400, 'Prévisualisation requise.');
  return transaction(async (db, session) => {
    const options = { session };
    const state = await db.collection('performance_years').findOne({ _id: year }, options);
    if (!state) fail(409, 'Initialiser l’année avant de la clôturer.');
    if (state.opening_needs_review) fail(409, 'Valider d’abord la clôture précédente.');
    const preview = await db.collection('performance_previews').findOne({ _id: body.preview_id, year }, options);
    if (!preview || preview.expires_at < new Date()) fail(409, 'Prévisualisation expirée ; préparer à nouveau.');
    checkRevision(state, preview.revision);
    if (!Number.isFinite((preview.report.indicative ?? preview.report).net_gain_eur)) fail(400, 'Les données de clôture ne permettent pas de calculer le gain ; compléter les informations manquantes.');
    if (state.closing_snapshot) fail(409, 'Année déjà clôturée.');
    const docs = await db.collection('positions').find({}, options).toArray();
    if (preview.fingerprint !== positionsFingerprint(performancePositions(docs, state.input))) fail(409, 'Les positions ont changé ; préparer à nouveau.');
    const next = await db.collection('performance_years').findOne({ _id: year + 1 }, options);
    if ((next?.revision ?? null) !== preview.next_revision) fail(409, 'L’année suivante a changé ; préparer à nouveau.');
    const now = new Date();
    const nextState = rolloverState(state, preview.snapshot, next, body.update_next_opening === true, now);
    const after = { ...state, input: { ...state.input, current_cash_eur: preview.snapshot.cash_eur, current_cash_date: preview.snapshot.date },
      closing_snapshot: preview.snapshot, closed_report: { ...preview.report, year, closed: true, revision: state.revision + 1 },
      closed_source_positions: preview.source_positions, revision: state.revision + 1, updated_at: now };
    await storeVersion(db, state, after, 'close_year', session);
    await storeVersion(db, next ?? { _id: year + 1, revision: 0, persisted: false }, nextState, 'rollover_opening', session);
    await db.collection('performance_previews').deleteOne({ _id: preview._id }, options);
    return { year, next_year: year + 1, revision: after.revision };
  });
}
export async function reopenAnnualYear(year, revision) {
  year = performanceYear(year);
  return transaction(async (db, session) => {
    const state = await db.collection('performance_years').findOne({ _id: year }, { session });
    if (!state?.closing_snapshot) fail(409, 'Année non clôturée.');
    checkRevision(state, revision);
    const next = await db.collection('performance_years').findOne({ _id: year + 1 }, { session });
    if (next?.closing_snapshot) fail(409, 'Réouvrir d’abord l’année suivante.');
    const { closing_snapshot, closed_report, closed_source_positions, ...rest } = state;
    const after = { ...rest, revision: state.revision + 1, updated_at: new Date() };
    await storeVersion(db, state, after, 'reopen_year', session);
    if (next?.opening_source_year === year) await storeVersion(db, next, { ...next, opening_needs_review: true, revision: next.revision + 1, updated_at: new Date() }, 'previous_year_reopened', session);
    return { revision: after.revision };
  });
}
export async function annualAudit(year) {
  const state = await annualState(year), db = getDb();
  const docs = await db.collection('positions').find().toArray();
  return { exported_at: new Date().toISOString(), version: 'annual-performance-v1',
    report: await annualReport(Number(year), state, docs), inputs: state.input,
    opening_snapshot: state.opening_snapshot ?? null, closing_snapshot: state.closing_snapshot ?? null,
    source_positions: state.closed_source_positions ?? financialPositions(performancePositions(docs, state.input)),
    history: await db.collection('performance_history').find({ year: Number(year) }).sort({ recorded_at: 1 }).toArray() };
}
