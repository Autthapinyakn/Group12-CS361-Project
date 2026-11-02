import { query } from '../lib/db';
import { auditGraduation, type AuditResult, type CourseRecord, type CurriculumRules, type StudentProfile } from '../domain/graduationAudit';
import { resolveCurriculumId } from './postgresCourseProvider';

export interface RequirementsView {
  curriculum: { id: string; code: string; name: string; year: number };
  minTotalCredits: number | null;
  minGpax: number | null;
  maxRegularSemesters: number | null;
  source: string | null;
  categories: RequirementNode[];
}

export interface RequirementNode {
  code: string;
  name: string;
  minCredits: number;
  plan: string | null;
  isOptional: boolean;
  isCatchAll: boolean;
  rule: unknown;
  courses: { code: string; nameTh: string; nameEn: string; credits: number }[];
  children: RequirementNode[];
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function loadRules(curriculumId: string): Promise<CurriculumRules | null> {
  const { rows: cur } = await query(
    'SELECT code, name, min_total_credits, min_gpax, max_regular_semesters, requirements_source FROM curricula WHERE id = $1',
    [curriculumId],
  );
  if (!cur.length) return null;
  const { rows } = await query(
    `SELECT g.id, g.parent_id, g.code, g.name, g.min_credits, g.plan, g.is_optional, g.is_catch_all, g.rule, g.sort_order,
            COALESCE(array_agg(c.code ORDER BY c.code) FILTER (WHERE c.code IS NOT NULL), '{}') AS course_codes
     FROM grad_requirement_categories g
     LEFT JOIN grad_requirement_courses gc ON gc.category_id = g.id
     LEFT JOIN courses c ON c.id = gc.course_id
     WHERE g.curriculum_id = $1
     GROUP BY g.id
     ORDER BY g.sort_order`,
    [curriculumId],
  );
  return {
    code: cur[0].code,
    name: cur[0].name,
    minTotalCredits: num(cur[0].min_total_credits),
    minGpax: num(cur[0].min_gpax),
    maxRegularSemesters: cur[0].max_regular_semesters,
    source: cur[0].requirements_source,
    categories: rows.map((r) => ({
      id: r.id,
      parentId: r.parent_id,
      code: r.code,
      name: r.name,
      minCredits: Number(r.min_credits),
      plan: r.plan,
      isOptional: r.is_optional,
      isCatchAll: r.is_catch_all,
      rule: r.rule,
      sortOrder: r.sort_order,
      courseCodes: r.course_codes,
    })),
  };
}

/** Public view of a curriculum's graduation conditions (FR1): no personal data. */
export async function getRequirements(idOrCode: string): Promise<RequirementsView | null> {
  const id = await resolveCurriculumId(idOrCode);
  if (!id) return null;
  const { rows: cur } = await query('SELECT id, code, name, year FROM curricula WHERE id = $1', [id]);
  const rules = await loadRules(id);
  if (!rules) return null;
  const { rows: courseRows } = await query(
    `SELECT DISTINCT c.code, c.name_th, c.name_en, c.credits
     FROM grad_requirement_courses gc
     JOIN grad_requirement_categories g ON g.id = gc.category_id
     JOIN courses c ON c.id = gc.course_id
     WHERE g.curriculum_id = $1`,
    [id],
  );
  const info = new Map(courseRows.map((r) => [r.code, { code: r.code, nameTh: r.name_th, nameEn: r.name_en, credits: Number(r.credits) }]));
  const build = (parentId: string | null): RequirementNode[] =>
    rules.categories
      .filter((c) => c.parentId === parentId)
      .map((c) => ({
        code: c.code,
        name: c.name,
        minCredits: c.minCredits,
        plan: c.plan,
        isOptional: c.isOptional,
        isCatchAll: c.isCatchAll,
        rule: c.rule,
        courses: c.courseCodes.map((code) => info.get(code) ?? { code, nameTh: code, nameEn: code, credits: 0 }),
        children: build(c.id),
      }));
  return {
    curriculum: cur[0],
    minTotalCredits: rules.minTotalCredits,
    minGpax: rules.minGpax,
    maxRegularSemesters: rules.maxRegularSemesters,
    source: rules.source,
    categories: build(null),
  };
}

export interface StudentRow {
  student_code: string;
  full_name: string;
  email: string | null;
  curriculum_code: string;
  curriculum_id: string | null;
  plan: string | null;
  enrollment_year: number;
  advisor_email: string | null;
  academic_status: StudentProfile['academicStatus'];
  financial_status: StudentProfile['financialStatus'];
  outstanding_amount: string | null;
  registrar_gpax: string | null;
  regular_semesters_enrolled: number | null;
  data_as_of_year: number | null;
  data_as_of_semester: number | null;
  imported_at: Date | null;
}

const STUDENT_SELECT = `SELECT s.*, b.created_at AS imported_at
  FROM students s LEFT JOIN registrar_import_batches b ON b.id = s.last_batch_id`;

export async function findStudentByCode(code: string): Promise<StudentRow | null> {
  const { rows } = await query<StudentRow>(`${STUDENT_SELECT} WHERE s.student_code = $1`, [code]);
  return rows[0] ?? null;
}

export async function findStudentByEmail(email: string): Promise<StudentRow | null> {
  const { rows } = await query<StudentRow>(`${STUDENT_SELECT} WHERE lower(s.email) = lower($1)`, [email]);
  return rows[0] ?? null;
}

/** Instructors see their advisees; staff see everyone. Search by code prefix or name. */
export async function listStudents(scope: { advisorEmail: string | null }, search: string | undefined) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (scope.advisorEmail) {
    params.push(scope.advisorEmail);
    where.push(`lower(s.advisor_email) = lower($${params.length})`);
  }
  if (search) {
    params.push(`${search}%`, `%${search}%`);
    where.push(`(s.student_code LIKE $${params.length - 1} OR s.full_name ILIKE $${params.length})`);
  }
  const { rows } = await query(
    `SELECT s.student_code, s.full_name, s.curriculum_code, s.plan, s.enrollment_year, s.advisor_email,
            s.data_as_of_year, s.data_as_of_semester
     FROM students s ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY s.student_code LIMIT 200`,
    params,
  );
  return rows.map((r) => ({
    studentCode: r.student_code,
    fullName: r.full_name,
    curriculumCode: r.curriculum_code,
    plan: r.plan,
    enrollmentYear: r.enrollment_year,
    advisorEmail: r.advisor_email,
    dataAsOf: r.data_as_of_year ? `${r.data_as_of_semester}/${r.data_as_of_year}` : null,
  }));
}

export async function auditStudent(s: StudentRow, now = new Date()): Promise<AuditResult> {
  const { rows } = await query(
    'SELECT course_code, academic_year, semester, grade, credits FROM student_course_records WHERE student_code = $1',
    [s.student_code],
  );
  const records: CourseRecord[] = rows.map((r) => ({
    courseCode: r.course_code,
    academicYear: r.academic_year,
    semester: r.semester,
    grade: r.grade,
    credits: Number(r.credits),
  }));
  const rules = s.curriculum_id ? await loadRules(s.curriculum_id) : null;
  const profile: StudentProfile = {
    studentCode: s.student_code,
    fullName: s.full_name,
    curriculumCode: s.curriculum_code,
    plan: s.plan,
    enrollmentYear: s.enrollment_year,
    academicStatus: s.academic_status,
    financialStatus: s.financial_status,
    outstandingAmount: num(s.outstanding_amount),
    registrarGpax: num(s.registrar_gpax),
    regularSemestersEnrolled: s.regular_semesters_enrolled,
    dataAsOf: s.data_as_of_year ? { year: s.data_as_of_year, semester: s.data_as_of_semester ?? 1 } : null,
    importedAt: s.imported_at ? new Date(s.imported_at).toISOString() : null,
  };
  const result = auditGraduation(rules, profile, records, now);
  // Course names for display, looked up once for every course shown in the result.
  const codes = new Set<string>();
  const walk = (cats: AuditResult['categories']) => cats.forEach((c) => { c.courses.forEach((x) => codes.add(x.code)); walk(c.children); });
  walk(result.categories);
  if (codes.size) {
    const { rows: names } = await query('SELECT code, name_th FROM courses WHERE code = ANY($1::text[])', [[...codes]]);
    const byCode = new Map(names.map((n) => [n.code, n.name_th]));
    const name = (cats: AuditResult['categories']) =>
      cats.forEach((c) => { c.courses.forEach((x) => Object.assign(x, { nameTh: byCode.get(x.code) ?? null })); name(c.children); });
    name(result.categories);
  }
  return result;
}
