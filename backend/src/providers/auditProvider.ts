import { query } from '../lib/db';

export interface AuditEntry {
  id: string;
  changedAt: string;
  entityType: string;
  changeType: 'INSERT' | 'UPDATE' | 'DELETE';
  summary: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  source: 'api' | 'db' | null;
  changedFields: { field: string; before: unknown; after: unknown }[];
}

const IGNORED = new Set(['version', 'updated_at', 'created_at', 'id']);

function diff(oldV: Record<string, unknown> | null, newV: Record<string, unknown> | null) {
  const keys = new Set([...Object.keys(oldV ?? {}), ...Object.keys(newV ?? {})]);
  const out: AuditEntry['changedFields'] = [];
  for (const k of keys) {
    if (IGNORED.has(k)) continue;
    const before = oldV?.[k] ?? null;
    const after = newV?.[k] ?? null;
    if (JSON.stringify(before) !== JSON.stringify(after)) out.push({ field: k, before, after });
  }
  return out;
}

/** Groups of audited tables, so a page can ask for the history it is about. */
export const ENTITY_GROUPS = {
  plan: ['curriculum_courses', 'courses', 'course_prerequisites', 'curriculum_elective_courses'],
  requirements: ['grad_requirement_categories', 'grad_requirement_courses', 'curricula'],
} as const;
export type EntityGroup = keyof typeof ENTITY_GROUPS;

/**
 * Change history (FR8), newest first. Filter by curriculum code, table group, source, and page by
 * "before" id. Course rows are shared by all curricula, so they match any curriculum filter.
 */
export async function listChanges(opts: { curriculumCode?: string; group?: EntityGroup; source?: 'api' | 'db'; before?: string; limit: number }) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.curriculumCode) {
    params.push(opts.curriculumCode);
    where.push(`(summary LIKE $${params.length} || ' %' OR summary = $${params.length} OR entity_type = 'courses')`);
  }
  if (opts.group) {
    params.push(ENTITY_GROUPS[opts.group]);
    where.push(`entity_type = ANY($${params.length}::text[])`);
  }
  if (opts.source) {
    params.push(opts.source);
    where.push(`source = $${params.length}`);
  }
  if (opts.before) {
    params.push(opts.before);
    where.push(`changed_at < (SELECT changed_at FROM curriculum_edit_log WHERE id = $${params.length}::uuid)`);
  }
  params.push(opts.limit);
  const { rows } = await query(
    `SELECT id, changed_at, entity_type, change_type, summary, actor_email, actor_role, source, old_value, new_value
     FROM curriculum_edit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY changed_at DESC, id DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map<AuditEntry>((r) => ({
    id: r.id,
    changedAt: new Date(r.changed_at).toISOString(),
    entityType: r.entity_type,
    changeType: r.change_type,
    summary: r.summary,
    actorEmail: r.actor_email,
    actorRole: r.actor_role,
    source: r.source,
    changedFields: diff(r.old_value, r.new_value),
  }));
}
