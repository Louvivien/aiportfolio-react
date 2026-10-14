// Run from backend: node scripts/migrate-annual-performance.mjs [--apply]
// No positions, cash values, flows or performance targets are fabricated here.
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { BSON } from 'mongodb';
import { initDb, shutdown } from '../src/db.js';
import { LEGACY_PERFORMANCE_ID, positionsFingerprint } from '../src/annualPerformance.js';
import { performancePositions } from '../src/personalPerformanceValuation.js';
import { securitiesSnapshot } from '../src/annualPerformanceService.js';
const apply = process.argv.includes('--apply');
try {
  const db = await initDb();
  if (await db.collection('performance_years').findOne({ _id: 2026 })) {
    console.log(JSON.stringify({ already_migrated: true }));
  } else {
    const [input, docs] = await Promise.all([
      db.collection('performance_inputs').findOne({ _id: LEGACY_PERFORMANCE_ID }),
      db.collection('positions').find().toArray(),
    ]);
    assert.ok(input, 'Missing legacy inputs');
    const opening = await securitiesSnapshot(docs, input, '2025-12-31', true);
    assert.equal(opening.complete, true, 'Opening inventory must be valued before freezing it');
    const snapshot = { ...opening, cash_eur: input.opening_cash_eur,
      total_eur: input.opening_cash_eur === null ? null : opening.known_value_eur + input.opening_cash_eur,
      cash_status: input.opening_cash_status, captured_at: new Date().toISOString(), source: 'legacy_2026_reconciled_inputs', scope: input.performance_scope };
    const state = { _id: 2026, revision: 1, input, opening_snapshot: snapshot,
      cash_fingerprint: positionsFingerprint(performancePositions(docs, input)), cash_needs_review: false,
      created_at: new Date(), updated_at: new Date(), migration: 'annual-performance-v1' };
    let backup;
    if (apply) {
      const directory = resolve('../..', 'aiportfolio-reports');
      await fs.mkdir(directory, { recursive: true });
      backup = resolve(directory, `annual-performance-migration-${Date.now()}.ejson`);
      const bytes = BSON.EJSON.stringify({ input, positions: docs, state }, { relaxed: false });
      await fs.writeFile(backup, bytes, { mode: 0o600 });
      const session = db.client.startSession();
      try {
        await session.withTransaction(async () => {
          const latestInput = await db.collection('performance_inputs').findOne({ _id: LEGACY_PERFORMANCE_ID }, { session });
          assert.deepEqual(latestInput, input, 'Inputs changed during migration');
          const latestDocs = await db.collection('positions').find({}, { session }).toArray();
          assert.equal(positionsFingerprint(performancePositions(latestDocs, input)), state.cash_fingerprint, 'Positions changed during migration');
          await db.collection('performance_years').insertOne(state, { session });
          await db.collection('performance_history').insertOne({ year: 2026, action: 'migrate_2026', recorded_at: new Date(), before: null, after: state,
            backup_sha256: createHash('sha256').update(bytes).digest('hex') }, { session });
        });
      } finally { await session.endSession(); }
      await db.collection('performance_previews').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
      await db.collection('performance_history').createIndex({ year: 1, recorded_at: 1 });
    }
    console.log(JSON.stringify({ applied: apply, backup, opening_eur: snapshot.total_eur, cash_eur: input.current_cash_eur,
      flows_count: input.dated_movements.length, positions_unchanged: true, legacy_input_preserved: true }));
  }
} finally { await shutdown(); }
