// Snapshot the seeded requirement trees (local DB) into test/fixtures/requirements.json so the
// audit tests run without a database. Re-run after changing db/seed_v4_requirements.sql:
//   DATABASE_URL=postgres://cs361:cs361-local-only@localhost:5432/cs361 DB_SSL=disable npx tsx scripts/export-requirements-fixture.ts
import { writeFileSync } from 'fs';
import { query } from '../src/lib/db';
import { loadRules } from '../src/providers/graduationProvider';

(async () => {
  const { rows } = await query("SELECT id, code FROM curricula WHERE code IN ('applied-cs', 'cis-cs', 'cnc') ORDER BY code");
  const out: Record<string, unknown> = {};
  for (const r of rows) out[r.code] = await loadRules(r.id);
  writeFileSync('test/fixtures/requirements.json', JSON.stringify(out, null, 1) + '\n');
  console.log('wrote test/fixtures/requirements.json');
  process.exit(0);
})();
