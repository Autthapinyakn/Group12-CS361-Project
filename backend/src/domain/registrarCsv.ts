/**
 * Registrar export contract (document/v4/registrar-csv-contract.md): one UTF-8 CSV, one row per
 * course record, student fields repeated on each row. A student with no course yet may appear on a
 * single row with the course columns empty.
 *
 * Validation is all-or-nothing per student: if any row of a student is invalid, none of that
 * student's rows are applied, because a partial transcript would give a wrong graduation result.
 */
import { ALL_GRADES } from './grades';
import { isEmail } from '../lib/http';

export const CSV_COLUMNS = [
  'student_code', 'full_name', 'email', 'curriculum_code', 'plan', 'enrollment_year', 'advisor_email',
  'academic_status', 'financial_status', 'outstanding_amount', 'gpax', 'regular_semesters',
  'course_code', 'academic_year', 'semester', 'grade', 'credits',
] as const;

const ACADEMIC = ['normal', 'on_leave', 'retired', 'graduated'] as const;
const FINANCIAL = ['clear', 'outstanding', 'unknown'] as const;

export interface ParsedStudent {
  studentCode: string;
  fullName: string;
  email: string | null;
  curriculumCode: string;
  plan: string | null;
  enrollmentYear: number;
  advisorEmail: string | null;
  academicStatus: (typeof ACADEMIC)[number];
  financialStatus: (typeof FINANCIAL)[number];
  outstandingAmount: number | null;
  gpax: number | null;
  regularSemesters: number | null;
}

export interface ParsedRecord {
  studentCode: string;
  courseCode: string;
  academicYear: number;
  semester: number;
  grade: string;
  credits: number;
}

export interface RowError {
  line: number; // 1-based line in the file (header = line 1)
  studentCode: string | null;
  field: string | null;
  message: string;
}

export interface ParseResult {
  structuralError: string | null;
  totalRows: number;
  students: ParsedStudent[];
  records: ParsedRecord[];
  acceptedRows: number;
  errors: RowError[];
}

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF, optional UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

const intOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

export function parseRegistrarCsv(text: string, knownCurricula: Set<string>): ParseResult {
  const rows = parseCsv(text);
  const empty: ParseResult = { structuralError: null, totalRows: 0, students: [], records: [], acceptedRows: 0, errors: [] };
  if (rows.length === 0) return { ...empty, structuralError: 'The file is empty' };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const missing = CSV_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) return { ...empty, totalRows: rows.length - 1, structuralError: `Missing columns: ${missing.join(', ')}` };
  const col = Object.fromEntries(CSV_COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<(typeof CSV_COLUMNS)[number], number>;

  const errors: RowError[] = [];
  const students = new Map<string, ParsedStudent>();
  const recordsByStudent = new Map<string, { line: number; rec: ParsedRecord }[]>();
  const badStudents = new Set<string>();
  const seenKeys = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const line = i + 1;
    const r = rows[i];
    const get = (c: (typeof CSV_COLUMNS)[number]) => (r[col[c]] ?? '').trim();
    const code = get('student_code');
    const fail = (field: string | null, message: string) => {
      errors.push({ line, studentCode: code || null, field, message });
      if (code) badStudents.add(code);
    };
    if (!/^\d{10}$/.test(code)) {
      fail('student_code', 'student_code must be 10 digits');
      continue;
    }

    // ---- student fields ----
    const email = get('email').toLowerCase();
    const advisor = get('advisor_email').toLowerCase();
    const academic = (get('academic_status') || 'normal') as ParsedStudent['academicStatus'];
    const financial = (get('financial_status') || 'unknown') as ParsedStudent['financialStatus'];
    const enrollment = Number(get('enrollment_year'));
    const outstanding = get('outstanding_amount') === '' ? null : Number(get('outstanding_amount'));
    const gpax = get('gpax') === '' ? null : Number(get('gpax'));
    const semesters = intOrNull(get('regular_semesters'));
    const curriculum = get('curriculum_code');
    let ok = true;
    const check = (cond: boolean, field: string, message: string) => {
      if (!cond && ok) {
        fail(field, message);
        ok = false;
      }
    };
    check(get('full_name').length > 0 && get('full_name').length <= 255, 'full_name', 'full_name is required');
    check(email === '' || isEmail(email), 'email', 'email is not a valid address');
    check(knownCurricula.has(curriculum), 'curriculum_code', `unknown curriculum_code "${curriculum}"`);
    check(Number.isInteger(enrollment) && enrollment >= 2500 && enrollment <= 2700, 'enrollment_year', 'enrollment_year must be a Buddhist Era year');
    check(advisor === '' || isEmail(advisor), 'advisor_email', 'advisor_email is not a valid address');
    check((ACADEMIC as readonly string[]).includes(academic), 'academic_status', `academic_status must be one of ${ACADEMIC.join(', ')}`);
    check((FINANCIAL as readonly string[]).includes(financial), 'financial_status', `financial_status must be one of ${FINANCIAL.join(', ')}`);
    check(outstanding === null || (Number.isFinite(outstanding) && outstanding >= 0), 'outstanding_amount', 'outstanding_amount must be a non-negative number');
    check(gpax === null || (Number.isFinite(gpax) && gpax >= 0 && gpax <= 4), 'gpax', 'gpax must be between 0 and 4');
    check(semesters === null || (Number.isInteger(semesters) && semesters >= 0 && semesters <= 40), 'regular_semesters', 'regular_semesters must be a whole number');
    if (!ok) continue;

    const student: ParsedStudent = {
      studentCode: code,
      fullName: get('full_name'),
      email: email || null,
      curriculumCode: curriculum,
      plan: get('plan') || null,
      enrollmentYear: enrollment,
      advisorEmail: advisor || null,
      academicStatus: academic,
      financialStatus: financial,
      outstandingAmount: outstanding,
      gpax,
      regularSemesters: semesters,
    };
    const prev = students.get(code);
    if (prev && JSON.stringify(prev) !== JSON.stringify(student)) {
      fail(null, 'student fields differ from an earlier row of the same student');
      continue;
    }
    students.set(code, student);

    // ---- course fields (all empty = student-only row) ----
    const courseCode = get('course_code').toUpperCase().replace(/\s+/g, '');
    const courseFields = [courseCode, get('academic_year'), get('semester'), get('grade'), get('credits')];
    if (courseFields.every((v) => v === '')) continue;
    const year = Number(get('academic_year'));
    const semester = Number(get('semester'));
    const grade = get('grade').toUpperCase();
    const credits = Number(get('credits'));
    check(/^[A-Z]{2,4}\d{3}$/.test(courseCode), 'course_code', 'course_code must look like CS101');
    check(Number.isInteger(year) && year >= 2500 && year <= 2700, 'academic_year', 'academic_year must be a Buddhist Era year');
    check([1, 2, 3].includes(semester), 'semester', 'semester must be 1, 2 or 3');
    check((ALL_GRADES as readonly string[]).includes(grade), 'grade', `grade must be one of ${ALL_GRADES.join(', ')}`);
    check(Number.isFinite(credits) && credits >= 0 && credits <= 12, 'credits', 'credits must be a number between 0 and 12');
    if (!ok) continue;
    const key = `${code}|${courseCode}|${year}|${semester}`;
    if (seenKeys.has(key)) {
      fail('course_code', 'the same course appears twice in one term');
      continue;
    }
    seenKeys.add(key);
    const list = recordsByStudent.get(code) ?? [];
    list.push({ line, rec: { studentCode: code, courseCode, academicYear: year, semester, grade, credits } });
    recordsByStudent.set(code, list);
  }

  const acceptedStudents = [...students.values()].filter((s) => !badStudents.has(s.studentCode));
  const records = acceptedStudents.flatMap((s) => (recordsByStudent.get(s.studentCode) ?? []).map((x) => x.rec));
  for (const code of badStudents) {
    const n = (recordsByStudent.get(code) ?? []).length;
    if (n) errors.push({ line: 0, studentCode: code, field: null, message: `${n} valid rows of this student were not applied because another row is invalid` });
  }
  const totalRows = rows.length - 1;
  const rejectedLines = new Set(errors.filter((e) => e.line > 0).map((e) => e.line));
  const rejectedStudentRows = [...badStudents].reduce((s, c) => s + (recordsByStudent.get(c) ?? []).length, 0);
  return {
    structuralError: null,
    totalRows,
    students: acceptedStudents,
    records,
    acceptedRows: totalRows - rejectedLines.size - rejectedStudentRows,
    errors,
  };
}
