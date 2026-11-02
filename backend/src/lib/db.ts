import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * TLS is verified against the AWS RDS CA bundle (shipped in dist/certs). Set DB_SSL=disable only
 * for the local Docker database. Do not put sslmode in DATABASE_URL: it overrides this object.
 */
function sslConfig() {
  if (process.env.DB_SSL === 'disable') return false;
  const caPath = process.env.DB_CA_PATH ?? path.join(__dirname, '..', 'certs', 'rds-global-bundle.pem');
  return { ca: readFileSync(caPath, 'utf8') };
}

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig(),
      // One Lambda execution environment serves one request at a time, so one connection is enough;
      // total connections then never exceed the function's concurrency.
      max: Number(process.env.DB_POOL_MAX ?? 1),
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 8000,
    });
    pool.on('error', (err) => console.error(JSON.stringify({ level: 'error', msg: 'idle client error', error: err.message })));
  }
  return pool;
}

export async function query<T extends QueryResultRow = any>(text: string, params: unknown[] = []) {
  return getPool().query<T>(text, params);
}

export interface Actor {
  email: string | null;
  role: string | null;
}

/**
 * Runs fn in a transaction. The actor is stored in transaction-local settings that the audit
 * triggers read (see db/migration_v4.sql), so every change is attributed to the signed-in user.
 */
export async function withTransaction<T>(actor: Actor | null, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    if (actor) {
      await client.query("SELECT set_config('app.actor_email', $1, true), set_config('app.actor_role', $2, true)", [
        actor.email ?? 'unknown',
        actor.role ?? '',
      ]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Used by /health: a cheap round trip with a short timeout. */
export async function ping(): Promise<boolean> {
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2500));
  const check = query('SELECT 1').then(() => true, () => false);
  return Promise.race([check, timeout]);
}
