import type { ApiEvent } from './http';
import { forbidden, unauthorized } from './errors';

export type Role = 'student' | 'instructor' | 'staff' | 'coordinator';
export const ROLES: readonly Role[] = ['student', 'instructor', 'staff', 'coordinator'];

export interface Principal {
  sub: string;
  email: string | null; // lower-cased, only when Cognito marks it verified
  name: string | null;
  roles: Set<Role>;
}

/**
 * API Gateway passes the verified token claims. Array claims such as cognito:groups arrive as a
 * real array, a JSON string, or the HTTP API format "[student instructor]"; accept all three.
 */
export function parseGroups(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== 'string') return [];
  const s = raw.trim();
  if (s.startsWith('[') && s.includes('"')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      /* fall through to the space/comma format */
    }
  }
  return s.replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean);
}

/**
 * Returns null for anonymous requests. Claims only exist when API Gateway's JWT authorizer (or the
 * local dev server) put them there; clients cannot inject requestContext.
 */
export function getPrincipal(event: ApiEvent): Principal | null {
  const claims = event.requestContext?.authorizer?.jwt?.claims as Record<string, unknown> | undefined;
  if (!claims || typeof claims.sub !== 'string') return null;
  // ID tokens carry email and groups; access tokens do not, so they cannot identify a student.
  if (claims.token_use !== undefined && claims.token_use !== 'id') return null;
  const verified = claims.email_verified === undefined || claims.email_verified === true || claims.email_verified === 'true';
  const email = typeof claims.email === 'string' && verified ? claims.email.trim().toLowerCase() : null;
  const roles = new Set<Role>(parseGroups(claims['cognito:groups']).filter((g): g is Role => (ROLES as string[]).includes(g)));
  const name = typeof claims.name === 'string' ? claims.name : null;
  return { sub: claims.sub, email, name, roles };
}

export function requirePrincipal(event: ApiEvent): Principal {
  const p = getPrincipal(event);
  if (!p) throw unauthorized();
  return p;
}

export function hasAnyRole(p: Principal, ...roles: Role[]): boolean {
  return roles.some((r) => p.roles.has(r));
}

export function requireRole(p: Principal, ...roles: Role[]): void {
  if (!hasAnyRole(p, ...roles)) throw forbidden(`Requires role: ${roles.join(' or ')}`);
}

/** Highest role, used where one value must be stored (users.role, audit actor_role). */
export function primaryRole(p: Principal): Role | null {
  for (const r of ['coordinator', 'staff', 'instructor', 'student'] as Role[]) if (p.roles.has(r)) return r;
  return null;
}
