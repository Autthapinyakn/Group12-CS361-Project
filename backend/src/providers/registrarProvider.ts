import { createHash } from 'crypto';
import { query, withTransaction, type Actor } from '../lib/db';
import { parseRegistrarCsv, type RowError } from '../domain/registrarCsv';
import { compareTerms, type Term } from '../domain/terms';

export interface ImportMeta {
  fileName: string | null;
  asOf: Term;
}

export interface BatchSummary {
  id: string;
  fileName: string | null;
  asOfTerm: string;
  status: 'applied' | 'partial' | 'failed';
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  studentsCount: number;
  errors: RowError[];
  uploadedBy: string | null;
  createdAt: string;
}

const MAX_STORED_ERRORS = 200;

function toSummary(r: any): BatchSummary {
  return {
    id: r.id,
    fileName: r.file_name,
    asOfTerm: `${r.as_of_semester}/${r.as_of_year}`,
    status: r.status,
    totalRows: r.total_rows,
    acceptedRows: r.accepted_rows,
    rejectedRows: r.rejected_rows,
    studentsCount: r.students_count,
    errors: r.errors,
    uploadedBy: r.uploaded_by_email,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/**
 * Import one registrar export. Guarantees:
 * - idempotent: the same file (SHA-256) is applied at most once;
 * - all-or-nothing in the database: one transaction; a failure leaves the previous snapshot intact;
 * - per-student snapshot: a student's course records are replaced by the file's rows;
 * - never moves a student back in time: a batch older than the student's current data is skipped.
 */
export async function importBatch(csvText: string, meta: ImportMeta, actor: Actor): Promise<{ duplicate: boolean; batch: BatchSummary }> {
  const sha = createHash('sha256').update(csvText, 'utf8').digest('hex');
  const { rows: existing } = await query("SELECT * FROM registrar_import_batches WHERE file_sha256 = $1 AND status <> 'failed'", [sha]);
  if (existing.length) return { duplicate: true, batch: toSummary(existing[0]) };

  const { rows: curricula } = await query('SELECT id, code FROM curricula');
  const curriculumIds = new Map<string, string>(curricula.map((c) => [c.code, c.id]));
  const parsed = parseRegistrarCsv(csvText, new Set(curriculumIds.keys()));

  const insertBatch = async (client: { query: typeof query } | null, status: string, errors: RowError[], accepted: number, students: number) => {
    const q = client ? client.query.bind(client) : query;
    const { rows } = await q(
      `INSERT INTO registrar_import_batches
         (file_name, file_sha256, as_of_year, as_of_semester, status, total_rows, accepted_rows, rejected_rows,
          students_count, errors, uploaded_by_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [meta.fileName, sha, meta.asOf.year, meta.asOf.semester, status, parsed.totalRows, accepted,
        parsed.totalRows - accepted, students, JSON.stringify(errors.slice(0, MAX_STORED_ERRORS)), actor.email],
    );
    return toSummary(rows[0]);
  };

  if (parsed.structuralError || parsed.students.length === 0) {
    const errors = parsed.structuralError
      ? [{ line: 1, studentCode: null, field: null, message: parsed.structuralError }, ...parsed.errors]
      : parsed.errors.length ? parsed.errors : [{ line: 0, studentCode: null, field: null, message: 'No valid student rows' }];
    return { duplicate: false, batch: await insertBatch(null, 'failed', errors, 0, 0) };
  }

  return withTransaction(actor, async (client) => {
    const errors = [...parsed.errors];
    // Skip students whose stored data is newer than this batch.
    const { rows: current } = await client.query(
      'SELECT student_code, data_as_of_year, data_as_of_semester FROM students WHERE student_code = ANY($1::text[])',
      [parsed.students.map((s) => s.studentCode)],
    );
    const newer = new Set(
      current
        .filter((r) => r.data_as_of_year && compareTerms({ year: r.data_as_of_year, semester: r.data_as_of_semester }, meta.asOf) > 0)
        .map((r) => r.student_code),
    );
    for (const code of newer) {
      errors.push({ line: 0, studentCode: code, field: null, message: 'Skipped: the system already holds newer data for this student' });
    }
    const students = parsed.students.filter((s) => !newer.has(s.studentCode));
    const records = parsed.records.filter((r) => !newer.has(r.studentCode));
    const skippedRows = parsed.records.length - records.length;
    const accepted = parsed.acceptedRows - skippedRows;
    const status = errors.length ? 'partial' : 'applied';
    const batch = await insertBatch(client as any, status, errors, accepted, students.length);

    // Upsert students in one statement (unnest arrays), then replace their records.
    await client.query(
      `INSERT INTO students (student_code, full_name, email, curriculum_code, curriculum_id, plan, enrollment_year,
          advisor_email, academic_status, financial_status, outstanding_amount, registrar_gpax,
          regular_semesters_enrolled, data_as_of_year, data_as_of_semester, last_batch_id, updated_at)
       SELECT u.code, u.name, u.email, u.cur_code, cu.id, u.plan, u.enrolled, u.advisor, u.academic, u.financial,
              u.outstanding, u.gpax, u.semesters, $13, $14, $15, now()
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::text[], $8::text[],
                   $9::text[], $10::numeric[], $11::numeric[], $12::int[])
            AS u(code, name, email, cur_code, plan, enrolled, advisor, academic, financial, outstanding, gpax, semesters)
       LEFT JOIN curricula cu ON cu.code = u.cur_code
       ON CONFLICT (student_code) DO UPDATE SET
         full_name = EXCLUDED.full_name, email = EXCLUDED.email, curriculum_code = EXCLUDED.curriculum_code,
         curriculum_id = EXCLUDED.curriculum_id, plan = EXCLUDED.plan, enrollment_year = EXCLUDED.enrollment_year,
         advisor_email = EXCLUDED.advisor_email, academic_status = EXCLUDED.academic_status,
         financial_status = EXCLUDED.financial_status, outstanding_amount = EXCLUDED.outstanding_amount,
         registrar_gpax = EXCLUDED.registrar_gpax, regular_semesters_enrolled = EXCLUDED.regular_semesters_enrolled,
         data_as_of_year = EXCLUDED.data_as_of_year, data_as_of_semester = EXCLUDED.data_as_of_semester,
         last_batch_id = EXCLUDED.last_batch_id, updated_at = now()`,
      [
        students.map((s) => s.studentCode), students.map((s) => s.fullName), students.map((s) => s.email),
        students.map((s) => s.curriculumCode), students.map((s) => s.plan), students.map((s) => s.enrollmentYear),
        students.map((s) => s.advisorEmail), students.map((s) => s.academicStatus), students.map((s) => s.financialStatus),
        students.map((s) => s.outstandingAmount), students.map((s) => s.gpax), students.map((s) => s.regularSemesters),
        meta.asOf.year, meta.asOf.semester, batch.id,
      ],
    );
    await client.query('DELETE FROM student_course_records WHERE student_code = ANY($1::text[])', [students.map((s) => s.studentCode)]);
    if (records.length) {
      await client.query(
        `INSERT INTO student_course_records (student_code, course_code, academic_year, semester, grade, credits, batch_id)
         SELECT u.*, $7::uuid FROM unnest($1::text[], $2::text[], $3::int[], $4::int[], $5::text[], $6::numeric[])
           AS u(student_code, course_code, academic_year, semester, grade, credits)`,
        [
          records.map((r) => r.studentCode), records.map((r) => r.courseCode), records.map((r) => r.academicYear),
          records.map((r) => r.semester), records.map((r) => r.grade), records.map((r) => r.credits), batch.id,
        ],
      );
    }
    return { duplicate: false, batch };
  });
}

export async function listBatches(limit = 20): Promise<BatchSummary[]> {
  const { rows } = await query('SELECT * FROM registrar_import_batches ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows.map(toSummary);
}

/** Latest successful import, shown on the graduation pages as data freshness. */
export async function latestAppliedBatch(): Promise<BatchSummary | null> {
  const { rows } = await query("SELECT * FROM registrar_import_batches WHERE status <> 'failed' ORDER BY created_at DESC LIMIT 1");
  return rows[0] ? toSummary(rows[0]) : null;
}
