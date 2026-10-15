// Integration test against a disposable database; never touches the portfolio DB.
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
config.mongodbDb = `aiportfolio_annual_test_${Date.now()}`;
const { initDb, shutdown } = await import('../src/db.js');
const { annualReport, updateAnnualInput, previewAnnualClose, commitAnnualClose, reopenAnnualYear, prepareNextYear, annualAudit } = await import('../src/annualPerformanceService.js');
const { newAnnualInput, positionsFingerprint } = await import('../src/annualPerformance.js');
const db = await initDb();
assert.match(db.databaseName, /^aiportfolio_annual_test_\d+$/);
const input = { ...newAnnualInput({ excluded_symbols: ['SOXL'] }), scope_complete: true, transfers_reviewed: true, flow_history_complete: true,
  opening_cash_eur: 100, current_cash_eur: 50, current_cash_date: '2026-10-14' };
const snapshot = { date: '2025-12-31', known_value_eur: 900, cash_eur: 100, total_eur: 1000, complete: true, missing_symbols: [], position_count: 1, positions: [{ symbol: 'TEST', quantity: 10, value_eur: 900 }] };
const fixture = { _id: 2026, revision: 1, input, opening_snapshot: snapshot, cash_fingerprint: positionsFingerprint([]) };
const valueSecurities = async (_docs, _input, date) => ({ ...snapshot, date, known_value_eur: 1200, cash_eur: undefined, total_eur: undefined });
const clock = { today: '2027-01-02', valueSecurities };
try {
  await db.collection('performance_years').insertOne(fixture);
  const live = await annualReport(2026, fixture, [], '2026-10-14', valueSecurities);
  assert.equal(live.net_gain_eur, 250);
  const nextDay = await annualReport(2026, fixture, [], '2026-10-15', valueSecurities);
  assert.equal(nextDay.indicative.net_gain_eur, 250);
  assert.equal(nextDay.current.cash_date, '2026-10-14');
  const changedFlows = await annualReport(2026, { ...fixture, cash_needs_review: true }, [], '2026-10-15', valueSecurities);
  assert.equal(changedFlows.indicative, null); assert.equal(changedFlows.net_gain_eur, null);
  const changed = await annualReport(2026, fixture, [{ _id: 'a', symbol: 'TEST', quantity: 1, purchase_date: '2026-10-14' }], '2026-10-14', valueSecurities);
  assert.equal(changed.net_gain_eur, null); assert.match(changed.missing.join(), /confirmer le solde/);
  await assert.rejects(updateAnnualInput(2026, { revision: 0, patch: { opening_cash_eur: 0 } }), /changé/);
  await prepareNextYear(2026, 1);
  let next = await db.collection('performance_years').findOne({ _id: 2027 });
  assert.equal(next.input.current_cash_eur, null); assert.equal(next.opening_snapshot, undefined);
  const preview = await previewAnnualClose(2026, { revision: 1, cash_eur: 76.23 }, clock);
  assert.equal(preview.report.net_gain_eur, 276.23);
  // A concurrent correction makes the prepared close unusable.
  await updateAnnualInput(2026, { revision: 1, patch: { opening_cash_eur: 100 } });
  await assert.rejects(commitAnnualClose(2026, { preview_id: preview._id }), /changé/);
  const fresh = await previewAnnualClose(2026, { revision: 2, cash_eur: 76.23 }, clock);
  await commitAnnualClose(2026, { preview_id: fresh._id });
  const closed = await db.collection('performance_years').findOne({ _id: 2026 });
  next = await db.collection('performance_years').findOne({ _id: 2027 });
  assert.deepEqual(next.opening_snapshot, closed.closing_snapshot);
  assert.equal(next.input.opening_cash_eur, 76.23);
  assert.deepEqual(next.input.dated_movements, []);
  assert.equal((await annualReport(2026, closed, [], '2030-01-01', () => { throw new Error('Must not fetch live quotes'); })).net_gain_eur, 276.23);
  await assert.rejects(updateAnnualInput(2026, { revision: closed.revision, patch: { opening_cash_eur: 100 } }), /Réouvrir/);
  await reopenAnnualYear(2026, closed.revision);
  next = await db.collection('performance_years').findOne({ _id: 2027 });
  assert.equal(next.opening_needs_review, true);
  const suspended = await annualReport(2027, next, [], '2027-05-01', valueSecurities);
  assert.equal(suspended.net_gain_eur, null);
  const reopened = await db.collection('performance_years').findOne({ _id: 2026 });
  const corrected = await previewAnnualClose(2026, { revision: reopened.revision, cash_eur: 100 }, clock);
  await assert.rejects(commitAnnualClose(2026, { preview_id: corrected._id }), /explicitement/);
  await commitAnnualClose(2026, { preview_id: corrected._id, update_next_opening: true });
  next = await db.collection('performance_years').findOne({ _id: 2027 });
  assert.equal(next.opening_needs_review, false); assert.equal(next.input.opening_cash_eur, 100);
  assert.equal((await annualAudit(2026)).report.net_gain_eur, 300);
  const history = await db.collection('performance_history').find({ year: 2026, action: 'close_year' }).toArray();
  assert.equal(history.length, 2); assert.equal(history[0].after.closing_snapshot.cash_eur, 76.23);
  // Atomicity: a failed rollover must not close the source year.
  await reopenAnnualYear(2026, reopened.revision + 1);
  const r = await db.collection('performance_years').findOne({ _id: 2026 });
  const blocked = await previewAnnualClose(2026, { revision: r.revision, cash_eur: 100 }, clock);
  await db.collection('performance_years').updateOne({ _id: 2027 }, { $set: { closing_snapshot: next.opening_snapshot } });
  await assert.rejects(commitAnnualClose(2026, { preview_id: blocked._id, update_next_opening: true }), /déjà clôturée/);
  assert.equal((await db.collection('performance_years').findOne({ _id: 2026 })).closing_snapshot, undefined);
  await updateAnnualInput(2026, { revision: r.revision, patch: { opening_cash_eur: 101 } });
  const adjusted = await db.collection('performance_years').findOne({ _id: 2026 });
  assert.equal(adjusted.opening_snapshot.cash_eur, 101); assert.equal(adjusted.opening_snapshot.total_eur, 1001);
  const movement = { id: 'documented-flow', date: '2026-02-01', direction: 'deposit', currency: 'EUR', amount_cents: 10000, date_confirmed: true, external_to_combined_scope: true, source_record: 'original-document' };
  await db.collection('performance_years').updateOne({ _id: 2026 }, { $set: { 'input.dated_movements': [movement] } });
  await updateAnnualInput(2026, { revision: adjusted.revision, patch: { dated_movements: [{ ...movement, amount_cents: 12000 }] } });
  const edited = await db.collection('performance_years').findOne({ _id: 2026 });
  assert.equal(edited.input.dated_movements[0].source_record, 'original-document'); assert.equal(edited.cash_needs_review, true);
  console.log('Annual lifecycle passed: revision conflicts, cash invalidation, snapshot isolation, atomic rollover, explicit correction propagation, history and closed audit.');
} finally {
  try { for (const name of ['performance_years', 'performance_history', 'performance_previews']) await db.collection(name).deleteMany({}); } finally { await shutdown(); }
}
