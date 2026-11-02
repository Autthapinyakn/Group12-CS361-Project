// TC1/TC2 cases: the synthetic registrar export (db/sample-registrar) audited against the seeded
// requirement trees (test/fixtures/requirements.json, exported from db/seed_v4_requirements.sql).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import path from 'path';
import { auditGraduation, type CurriculumRules, type StudentProfile } from '../src/domain/graduationAudit';
import { parseRegistrarCsv } from '../src/domain/registrarCsv';

const rules: Record<string, CurriculumRules> = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'requirements.json'), 'utf8'));
const csv = readFileSync(path.join(__dirname, '..', '..', 'db', 'sample-registrar', 'registrar_2569-1.csv'), 'utf8');
const parsed = parseRegistrarCsv(csv, new Set(Object.keys(rules)));
const NOW = new Date('2026-10-24T10:00:00+07:00'); // semester 1/2569 in progress

function audit(code: string) {
  const s = parsed.students.find((x) => x.studentCode === code);
  assert.ok(s, `student ${code} in sample file`);
  const profile: StudentProfile = {
    studentCode: s.studentCode,
    fullName: s.fullName,
    curriculumCode: s.curriculumCode,
    plan: s.plan,
    enrollmentYear: s.enrollmentYear,
    academicStatus: s.academicStatus,
    financialStatus: s.financialStatus,
    outstandingAmount: s.outstandingAmount,
    registrarGpax: s.gpax,
    regularSemestersEnrolled: s.regularSemesters,
    dataAsOf: { year: 2569, semester: 1 },
    importedAt: NOW.toISOString(),
  };
  const records = parsed.records.filter((r) => r.studentCode === code);
  return auditGraduation(rules[s.curriculumCode], profile, records, NOW);
}

const failing = (r: ReturnType<typeof audit>) => r.checks.filter((c) => c.status === 'fail').map((c) => c.categoryCode ?? c.id);

test('sample file parses without errors', () => {
  assert.equal(parsed.structuralError, null);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.students.length, 9);
});

test('complete record is ELIGIBLE and categories add up', () => {
  const r = audit('6609650011');
  assert.equal(r.verdict, 'ELIGIBLE', JSON.stringify(failing(r)));
  assert.equal(r.summary.earnedCredits, 123);
  const specific = r.categories.find((c) => c.code === '2')!;
  assert.equal(specific.earnedCredits, 87);
  const core = specific.children.find((c) => c.code === '2.1')!;
  assert.ok(core.earnedCredits >= 48);
  const free = r.categories.find((c) => c.code === '3')!;
  assert.equal(free.earnedCredits, 6); // CS246 + CS287 (minor courses count as free electives)
  const project = core.children.find((c) => c.code === '2.1.3')!.children;
  assert.equal(project.find((c) => c.code === '2.1.3.1')!.status, 'complete');
  assert.equal(project.find((c) => c.code === '2.1.3.2')!.status, 'not_applicable');
});

test('failed major course and missing free elective -> NOT_ELIGIBLE with the categories named', () => {
  const r = audit('6609650012');
  assert.equal(r.verdict, 'NOT_ELIGIBLE');
  const f = failing(r);
  assert.ok(f.includes('2.2'), f.join());
  assert.ok(f.includes('3'), f.join());
});

test('grade below C in CS102 fails the minimum-grade rule', () => {
  const r = audit('6609650013');
  assert.equal(r.verdict, 'NOT_ELIGIBLE');
  const rule = r.checks.find((c) => c.id === 'min_grade')!;
  assert.equal(rule.status, 'fail');
  assert.deepEqual(rule.courses, ['CS102']);
  assert.equal(r.summary.earnedCredits, 123); // D+ still earns credit
});

test('average of the 8 core courses below 2.00 fails', () => {
  const r = audit('6609650014');
  const rule = r.checks.find((c) => c.id === 'min_average')!;
  assert.equal(rule.status, 'fail');
  assert.ok((rule.actual ?? 4) < 2);
  assert.equal(r.verdict, 'NOT_ELIGIBLE');
});

test('pending grade (I) gives INCOMPLETE_DATA, not NOT_ELIGIBLE', () => {
  const r = audit('6609650015');
  assert.equal(r.verdict, 'INCOMPLETE_DATA');
  assert.deepEqual(r.dataStatus.pendingCourses.map((p) => p.code), ['CS404']);
  assert.equal(failing(r).length, 0);
});

test('TC2: missing registrar term is reported and blocks a definite verdict', () => {
  const r = audit('6609650016');
  assert.deepEqual(r.dataStatus.missingTerms, ['2/2568']);
  assert.equal(r.verdict, 'INCOMPLETE_DATA');
});

test('outstanding debt makes a complete record NOT_ELIGIBLE', () => {
  const r = audit('6609650017');
  assert.deepEqual(failing(r), ['financial_status']);
  assert.equal(r.verdict, 'NOT_ELIGIBLE');
});

test('more than 16 regular semesters fails', () => {
  const r = audit('6009650018');
  assert.ok(failing(r).includes('max_semesters'));
  assert.deepEqual(r.dataStatus.missingTerms, []);
  assert.equal(r.verdict, 'NOT_ELIGIBLE');
});

test('curriculum without requirements (cnc) gives INCOMPLETE_DATA', () => {
  // No cnc student in the sample file: reuse a student's data under the unconfigured cnc rules.
  const profile: StudentProfile = {
    studentCode: '6809650099', fullName: 'cnc student', curriculumCode: 'cnc', plan: 'สหกิจศึกษา', enrollmentYear: 2568,
    academicStatus: 'normal', financialStatus: 'clear', outstandingAmount: null, registrarGpax: 3, regularSemestersEnrolled: 3,
    dataAsOf: { year: 2569, semester: 1 }, importedAt: NOW.toISOString(),
  };
  const records = parsed.records.filter((r) => r.studentCode === '6709650020' && r.academicYear <= 2568);
  const r = auditGraduation(rules.cnc, profile, records, NOW);
  assert.equal(r.curriculum.configured, false);
  assert.equal(r.verdict, 'INCOMPLETE_DATA');
});

test('second-year student with complete data is NOT_ELIGIBLE yet, without data gaps', () => {
  const r = audit('6709650020');
  assert.equal(r.verdict, 'NOT_ELIGIBLE');
  assert.deepEqual(r.dataStatus.missingTerms, []);
  assert.equal(r.dataStatus.isStale, false);
});

test('retake counts credits once and uses the best grade', () => {
  const base = parsed.records.filter((r) => r.studentCode === '6609650011' && r.courseCode !== 'CS102');
  const records = [
    ...base,
    { studentCode: '6609650011', courseCode: 'CS102', academicYear: 2566, semester: 1, grade: 'F', credits: 3 },
    { studentCode: '6609650011', courseCode: 'CS102', academicYear: 2566, semester: 3, grade: 'B', credits: 3 },
  ];
  const s = parsed.students.find((x) => x.studentCode === '6609650011')!;
  const r = auditGraduation(rules['applied-cs'], {
    studentCode: s.studentCode, fullName: s.fullName, curriculumCode: s.curriculumCode, plan: s.plan,
    enrollmentYear: s.enrollmentYear, academicStatus: 'normal', financialStatus: 'clear', outstandingAmount: null,
    registrarGpax: null, regularSemestersEnrolled: null, dataAsOf: { year: 2569, semester: 1 }, importedAt: null,
  }, records, NOW);
  assert.equal(r.summary.earnedCredits, 123);
  assert.equal(r.checks.find((c) => c.id === 'min_grade')!.status, 'pass');
  assert.equal(r.verdict, 'ELIGIBLE');
});

test('stale data is flagged when the last import predates the last completed term', () => {
  const r = audit('6709650020');
  const later = new Date('2027-09-01T00:00:00+07:00'); // 1/2570 running, 2/2569 completed
  const s = parsed.students.find((x) => x.studentCode === '6709650020')!;
  const again = auditGraduation(rules['applied-cs'], { ...r.student, dataAsOf: { year: 2569, semester: 1 }, importedAt: null } as StudentProfile,
    parsed.records.filter((x) => x.studentCode === s.studentCode), later);
  assert.equal(again.dataStatus.isStale, true);
});
