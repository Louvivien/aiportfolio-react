// One-off, user-requested correction. Dry-run unless --apply is supplied.
// Creation dates are explicit estimates, not evidence of broker executions.
import { mkdir, writeFile } from 'node:fs/promises';
import { initDb, getCollections, shutdown } from '../src/db.js';
import { day, positionLots } from '../src/finance.js';

const symbols = ['AZN', 'MRNA', 'SAN.PA', 'IDL.PA', 'ASY.PA'];
const apply = process.argv.includes('--apply');
try {
  await initDb();
  const { positions, monthlyReports } = getCollections();
  const docs = await positions.find({ symbol: { $in: symbols } }, {
    projection: { symbol: 1, created_at: 1, updated_at: 1, purchase_date: 1,
      closing_date: 1, is_closed: 1, purchase_lots: 1, date_estimates: 1 },
  }).toArray();
  if (docs.length !== symbols.length || new Set(docs.map((doc) => doc.symbol)).size !== symbols.length) {
    throw new Error('Expected exactly one record for each requested symbol. No changes applied.');
  }
  const now = new Date();
  const plans = docs.map((doc) => {
    if (doc.purchase_lots?.length) throw new Error(`Unexpected purchase_lots for ${doc.symbol}; review before changing dates.`);
    const entryDate = day(doc.created_at);
    if (!entryDate) throw new Error(`No valid database creation date for ${doc.symbol}.`);
    const updates = {};
    const estimates = { ...doc.date_estimates };
    for (const field of ['purchase_date', 'closing_date']) {
      if (field === 'closing_date' && !doc.is_closed) continue;
      if (day(doc[field])) continue;
      if (doc[field] != null && doc[field] !== '') throw new Error(`Invalid existing ${field} for ${doc.symbol}.`);
      updates[field] = new Date(`${entryDate}T00:00:00.000Z`);
      estimates[field] = { source: 'created_at', source_timestamp: doc.created_at,
        estimated: true, reason: 'User requested database-entry date for missing trade date', assigned_at: now };
    }
    const purchase = day(updates.purchase_date ?? doc.purchase_date);
    const closing = day(updates.closing_date ?? doc.closing_date);
    if (purchase && closing && closing < purchase) throw new Error(`Estimated closing date precedes purchase for ${doc.symbol}.`);
    return { doc, updates, estimates };
  }).filter((plan) => Object.keys(plan.updates).length);

  console.log(JSON.stringify({ apply, changes: plans.map(({ doc, updates }) => ({ symbol: doc.symbol, ...updates })) }, null, 2));
  if (apply && plans.length) {
    const backupDir = new URL('../../.git/financial-backups/', import.meta.url);
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    const backup = new URL(`trade-dates-${now.toISOString().replaceAll(':', '-')}.json`, backupDir);
    await writeFile(backup, JSON.stringify({ created_at: now, records: plans.map((plan) => plan.doc),
      changes: plans.map(({ doc, updates }) => ({ id: doc._id, ...updates })) }, null, 2), { mode: 0o600, flag: 'wx' });
    // Invalidate cached reports before the first write, so even a partial run cannot
    // leave a previously generated report presented as current.
    await monthlyReports.updateMany({}, { $set: { stale: true } });
    for (const { doc, updates, estimates } of plans) {
      const filter = { _id: doc._id, created_at: doc.created_at, updated_at: doc.updated_at ?? { $exists: false } };
      for (const field of Object.keys(updates)) filter[field] = doc[field] === undefined ? { $exists: false } : doc[field];
      const result = await positions.updateOne(filter, { $set: { ...updates, date_estimates: estimates, updated_at: now } });
      if (result.modifiedCount !== 1) throw new Error(`Record changed concurrently: ${doc.symbol}. Stopped; backup: ${backup.pathname}`);
    }
    console.log(`Updated ${plans.length} records. Backup: ${backup.pathname}`);
    const checked = await positions.find({ symbol: { $in: symbols } }).toArray();
    for (const doc of checked) {
      if (positionLots(doc).some((lot) => !lot.purchase_date || (lot.is_closed && !lot.closing_date))) {
        throw new Error(`Date verification failed for ${doc.symbol}.`);
      }
    }
    console.log('Verified: all five requested records have purchase and closing dates.');
  }
} finally {
  await shutdown();
}
