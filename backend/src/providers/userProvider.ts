import { query } from '../lib/db';
import { primaryRole, type Principal } from '../lib/auth';

/**
 * Record the signed-in user (called once per sign-in from GET /me). Authorization never depends on
 * this table: it uses the verified token claims, so a failed upsert does not lock anyone out.
 */
export async function recordSignIn(p: Principal): Promise<void> {
  const role = primaryRole(p);
  if (!role || !p.email) return;
  await query(
    `INSERT INTO users (cognito_sub, name, email, role, last_login_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (cognito_sub) DO UPDATE
       SET name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role, last_login_at = now()`,
    [p.sub, p.name ?? p.email, p.email, role],
  );
}
