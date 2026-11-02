/**
 * Graduation audit: a pure function from (curriculum rules, student profile, course records) to a
 * verdict with the evidence behind it. No I/O, so every rule is unit-tested (test/graduationAudit.test.ts).
 *
 * Rules (official curriculum document B.E. 2566, sections 4.1.2 and 7.2):
 * - every category is checked on its own: earned credits = unique passed courses mapped to the
 *   category or its applicable children, compared with that category's own minimum. A course may
 *   belong to several categories (e.g. CS101 is both a core course and one of the "8 courses").
 * - free electives (catch-all) = passed courses not mapped to any required category, minus the
 *   excluded pattern (100-level general education).
 * - retakes count once, with the best grade; I/IP results are pending.
 * - curriculum level: total credits, GPAX, at most N regular semesters, no outstanding debt,
 *   normal student status.
 */
import { GRADE_POINTS, gradeAtLeast, isGraded, isPassing, isPending } from './grades';
import { compareTerms, formatTerm, lastCompletedRegularTerm, regularTermsBetween, termKey, type Term } from './terms';

export interface CategoryRule {
  minGrade?: { grade: string; courses: string[] };
  minAverage?: { value: number; courses: string[] };
  excludeCodePattern?: string;
}

export interface RequirementCategory {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  minCredits: number;
  plan: string | null;
  isOptional: boolean;
  isCatchAll: boolean;
  rule: CategoryRule | null;
  sortOrder: number;
  courseCodes: string[];
}

export interface CurriculumRules {
  code: string;
  name: string;
  minTotalCredits: number | null;
  minGpax: number | null;
  maxRegularSemesters: number | null;
  source: string | null;
  categories: RequirementCategory[];
}

export interface CourseRecord {
  courseCode: string;
  academicYear: number;
  semester: number;
  grade: string;
  credits: number;
}

export interface StudentProfile {
  studentCode: string;
  fullName: string;
  curriculumCode: string;
  plan: string | null;
  enrollmentYear: number;
  academicStatus: 'normal' | 'on_leave' | 'retired' | 'graduated';
  financialStatus: 'clear' | 'outstanding' | 'unknown';
  outstandingAmount: number | null;
  registrarGpax: number | null;
  regularSemestersEnrolled: number | null;
  dataAsOf: Term | null;
  importedAt: string | null;
}

export type CheckStatus = 'pass' | 'fail' | 'pending' | 'unknown';
export type CheckId =
  | 'registrar_data' | 'requirements_configured' | 'financial_status' | 'academic_status'
  | 'max_semesters' | 'total_credits' | 'gpax' | 'category' | 'min_grade' | 'min_average';

export interface Check {
  id: CheckId;
  status: CheckStatus;
  categoryCode?: string;
  categoryName?: string;
  required?: number | null;
  actual?: number | null;
  courses?: string[];
}

export type CourseStatus = 'passed' | 'pending' | 'failed' | 'withdrawn' | 'not_taken';

export interface CourseLine {
  code: string;
  status: CourseStatus;
  grade: string | null;
  credits: number | null;
  term: string | null;
}

export type CategoryStatus = 'complete' | 'incomplete' | 'pending' | 'not_applicable';

export interface CategoryResult {
  code: string;
  name: string;
  minCredits: number;
  earnedCredits: number;
  pendingCredits: number;
  gpa: number | null;
  status: CategoryStatus;
  isOptional: boolean;
  isCatchAll: boolean;
  plan: string | null;
  courses: CourseLine[];
  children: CategoryResult[];
}

export type Verdict = 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'INCOMPLETE_DATA';

export interface AuditResult {
  verdict: Verdict;
  student: Omit<StudentProfile, 'dataAsOf' | 'importedAt'>;
  curriculum: { code: string; name: string; source: string | null; configured: boolean };
  dataStatus: {
    hasRecords: boolean;
    asOfTerm: string | null;
    importedAt: string | null;
    expectedLatestTerm: string;
    isStale: boolean;
    missingTerms: string[];
    pendingCourses: { code: string; term: string; grade: string; credits: number }[];
  };
  summary: {
    minTotalCredits: number | null;
    registeredCredits: number;
    earnedCredits: number;
    pendingCredits: number;
    gpax: number | null;
    gpaxSource: 'registrar' | 'computed' | null;
    minGpax: number | null;
    regularSemesters: number;
    maxRegularSemesters: number | null;
  };
  checks: Check[];
  categories: CategoryResult[];
}

interface CourseOutcome {
  code: string;
  status: Exclude<CourseStatus, 'not_taken'>;
  grade: string;
  credits: number;
  term: Term;
  bestGraded: string | null; // best letter grade among attempts (for averages), F included
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One outcome per course: best passing attempt, otherwise the latest attempt decides. */
function summarizeCourses(records: CourseRecord[]): Map<string, CourseOutcome> {
  const byCode = new Map<string, CourseRecord[]>();
  for (const r of records) {
    const list = byCode.get(r.courseCode) ?? [];
    list.push(r);
    byCode.set(r.courseCode, list);
  }
  const out = new Map<string, CourseOutcome>();
  for (const [code, attempts] of byCode) {
    attempts.sort((a, b) => compareTerms({ year: a.academicYear, semester: a.semester }, { year: b.academicYear, semester: b.semester }));
    const graded = attempts.filter((a) => isGraded(a.grade));
    const bestGraded = graded.length
      ? graded.reduce((best, a) => (GRADE_POINTS[a.grade] > GRADE_POINTS[best.grade] ? a : best)).grade
      : null;
    const passing = attempts.filter((a) => isPassing(a.grade));
    const latest = attempts[attempts.length - 1];
    let pick: CourseRecord;
    let status: CourseOutcome['status'];
    if (passing.length) {
      pick = passing.reduce((best, a) => ((GRADE_POINTS[a.grade] ?? 2) > (GRADE_POINTS[best.grade] ?? 2) ? a : best));
      status = 'passed';
    } else {
      pick = latest;
      status = isPending(latest.grade) ? 'pending' : latest.grade === 'W' ? 'withdrawn' : 'failed';
    }
    out.set(code, {
      code,
      status,
      grade: pick.grade,
      credits: Number(pick.credits),
      term: { year: pick.academicYear, semester: pick.semester },
      bestGraded,
    });
  }
  return out;
}

function courseLine(code: string, outcomes: Map<string, CourseOutcome>): CourseLine {
  const o = outcomes.get(code);
  if (!o) return { code, status: 'not_taken', grade: null, credits: null, term: null };
  return { code, status: o.status, grade: o.grade, credits: o.credits, term: formatTerm(o.term) };
}

function evaluateRule(rule: CategoryRule, outcomes: Map<string, CourseOutcome>, cat: RequirementCategory): Check[] {
  const checks: Check[] = [];
  if (rule.minGrade) {
    const below: string[] = [];
    let pending = false;
    for (const code of rule.minGrade.courses) {
      const o = outcomes.get(code);
      if (o?.status === 'passed' && gradeAtLeast(o.grade, rule.minGrade.grade)) continue;
      if (o?.status === 'pending') pending = true;
      else below.push(code);
    }
    checks.push({
      id: 'min_grade',
      status: below.length ? 'fail' : pending ? 'pending' : 'pass',
      categoryCode: cat.code,
      categoryName: cat.name,
      courses: below,
      actual: null,
      required: GRADE_POINTS[rule.minGrade.grade],
    });
  }
  if (rule.minAverage) {
    let points = 0;
    let credits = 0;
    let pending = false;
    const missing: string[] = [];
    for (const code of rule.minAverage.courses) {
      const o = outcomes.get(code);
      if (o?.bestGraded) {
        points += GRADE_POINTS[o.bestGraded] * o.credits;
        credits += o.credits;
      } else if (o?.status === 'pending') pending = true;
      else missing.push(code);
    }
    const avg = credits ? round2(points / credits) : null;
    const status: CheckStatus =
      missing.length ? 'fail' : pending ? 'pending' : avg !== null && avg >= rule.minAverage.value ? 'pass' : 'fail';
    checks.push({
      id: 'min_average',
      status,
      categoryCode: cat.code,
      categoryName: cat.name,
      required: rule.minAverage.value,
      actual: avg,
      courses: missing,
    });
  }
  return checks;
}

export function auditGraduation(
  rules: CurriculumRules | null,
  student: StudentProfile,
  records: CourseRecord[],
  now: Date = new Date(),
): AuditResult {
  const outcomes = summarizeCourses(records);
  const all = [...outcomes.values()];
  const earnedCredits = all.filter((o) => o.status === 'passed').reduce((s, o) => s + o.credits, 0);
  const pendingCredits = all.filter((o) => o.status === 'pending').reduce((s, o) => s + o.credits, 0);
  const registeredCredits = all.filter((o) => o.status !== 'withdrawn').reduce((s, o) => s + o.credits, 0);

  // GPAX over every graded attempt (retakes included), unless the registrar sent its own figure.
  const gradedAttempts = records.filter((r) => isGraded(r.grade));
  const gpCredits = gradedAttempts.reduce((s, r) => s + Number(r.credits), 0);
  const computedGpax = gpCredits ? round2(gradedAttempts.reduce((s, r) => s + GRADE_POINTS[r.grade] * Number(r.credits), 0) / gpCredits) : null;
  const gpax = student.registrarGpax ?? computedGpax;

  // ---- data completeness ----
  const expectedLatest = lastCompletedRegularTerm(now);
  const termsWithRecords = new Set(records.filter((r) => r.semester !== 3).map((r) => termKey({ year: r.academicYear, semester: r.semester })));
  let missingTerms: Term[] = [];
  let regularSemesters = termsWithRecords.size;
  if (student.dataAsOf) {
    const range = regularTermsBetween(student.enrollmentYear, student.dataAsOf);
    const empty = range.filter((t) => !termsWithRecords.has(termKey(t)));
    const withRecords = range.length - empty.length;
    if (student.regularSemestersEnrolled !== null) {
      // The registrar says how many semesters were studied; empty terms beyond that were leave.
      missingTerms = student.regularSemestersEnrolled > withRecords ? empty : [];
      regularSemesters = student.regularSemestersEnrolled;
    } else {
      missingTerms = empty;
      regularSemesters = withRecords;
    }
  }
  const pendingCourses = all
    .filter((o) => o.status === 'pending')
    .map((o) => ({ code: o.code, term: formatTerm(o.term), grade: o.grade, credits: o.credits }));
  const hasRecords = records.length > 0;
  const isStale = !student.dataAsOf || compareTerms(student.dataAsOf, expectedLatest) < 0;

  const configured = !!rules && rules.categories.length > 0 && rules.minTotalCredits !== null;
  const checks: Check[] = [];
  checks.push({ id: 'registrar_data', status: hasRecords && student.dataAsOf ? 'pass' : 'unknown' });
  checks.push({ id: 'requirements_configured', status: configured ? 'pass' : 'unknown' });
  checks.push({
    id: 'financial_status',
    status: student.financialStatus === 'clear' ? 'pass' : student.financialStatus === 'outstanding' ? 'fail' : 'unknown',
    actual: student.outstandingAmount,
  });
  checks.push({ id: 'academic_status', status: student.academicStatus === 'retired' ? 'fail' : 'pass' });

  const categories: CategoryResult[] = [];
  if (rules && configured) {
    const maxSem = rules.maxRegularSemesters;
    checks.push({
      id: 'max_semesters',
      status: maxSem === null ? 'pass' : regularSemesters <= maxSem ? 'pass' : 'fail',
      required: maxSem,
      actual: regularSemesters,
    });
    const minTotal = rules.minTotalCredits ?? 0;
    checks.push({
      id: 'total_credits',
      status: earnedCredits >= minTotal ? 'pass' : earnedCredits + pendingCredits >= minTotal ? 'pending' : 'fail',
      required: minTotal,
      actual: earnedCredits,
    });
    if (rules.minGpax !== null) {
      checks.push({
        id: 'gpax',
        status: gpax === null ? 'unknown' : gpax >= rules.minGpax ? 'pass' : 'fail',
        required: rules.minGpax,
        actual: gpax,
      });
    }

    const applies = (c: RequirementCategory) => !c.plan || !student.plan || c.plan === student.plan;
    const children = new Map<string | null, RequirementCategory[]>();
    for (const c of rules.categories) {
      const list = children.get(c.parentId) ?? [];
      list.push(c);
      children.set(c.parentId, list);
    }
    for (const list of children.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);

    // Courses claimed by required categories cannot also be free electives.
    const claimed = new Set<string>();
    for (const c of rules.categories) {
      if (!c.isOptional && !c.isCatchAll && applies(c)) c.courseCodes.forEach((code) => claimed.add(code));
    }

    const evaluate = (cat: RequirementCategory, optionalBranch: boolean): { result: CategoryResult; codes: Set<string> } => {
      const isOptional = optionalBranch || cat.isOptional;
      const applicable = applies(cat);
      const childResults = (children.get(cat.id) ?? []).map((ch) => evaluate(ch, isOptional));
      let own: string[];
      if (cat.isCatchAll) {
        const exclude = cat.rule?.excludeCodePattern ? new RegExp(cat.rule.excludeCodePattern) : null;
        own = all
          .filter((o) => (o.status === 'passed' || o.status === 'pending') && !claimed.has(o.code) && !(exclude && exclude.test(o.code)))
          .map((o) => o.code);
      } else {
        own = cat.courseCodes;
      }
      const codes = new Set<string>(own);
      childResults.forEach((cr, i) => {
        if (applies((children.get(cat.id) ?? [])[i])) cr.codes.forEach((c) => codes.add(c));
      });

      let earned = 0;
      let pending = 0;
      let points = 0;
      let gradedCredits = 0;
      for (const code of codes) {
        const o = outcomes.get(code);
        if (!o) continue;
        if (o.status === 'passed') earned += o.credits;
        if (o.status === 'pending') pending += o.credits;
        if (o.bestGraded) {
          points += GRADE_POINTS[o.bestGraded] * o.credits;
          gradedCredits += o.credits;
        }
      }
      const ruleChecks = cat.rule && applicable ? evaluateRule(cat.rule, outcomes, cat) : [];
      const ruleFail = ruleChecks.some((c) => c.status === 'fail');
      const rulePending = ruleChecks.some((c) => c.status === 'pending');
      let status: CategoryStatus;
      if (!applicable) status = 'not_applicable';
      else if (earned >= cat.minCredits && !ruleFail && !rulePending) status = 'complete';
      else if (earned + pending >= cat.minCredits && !ruleFail) status = 'pending';
      else status = 'incomplete';

      if (applicable && !isOptional) {
        checks.push({
          id: 'category',
          status: status === 'complete' ? 'pass' : status === 'pending' ? 'pending' : 'fail',
          categoryCode: cat.code,
          categoryName: cat.name,
          required: cat.minCredits,
          actual: earned,
        });
        checks.push(...ruleChecks);
      }

      return {
        codes,
        result: {
          code: cat.code,
          name: cat.name,
          minCredits: cat.minCredits,
          earnedCredits: earned,
          pendingCredits: pending,
          gpa: gradedCredits ? round2(points / gradedCredits) : null,
          status,
          isOptional,
          isCatchAll: cat.isCatchAll,
          plan: cat.plan,
          courses: own.map((code) => courseLine(code, outcomes)),
          children: childResults.map((c) => c.result),
        },
      };
    };

    for (const root of children.get(null) ?? []) categories.push(evaluate(root, false).result);
  }

  // ---- verdict ----
  // Unknown data, or failures that missing/pending data could still turn around, give
  // INCOMPLETE_DATA instead of a definite "not eligible".
  const DATA_SENSITIVE = new Set<CheckId>(['total_credits', 'category', 'min_grade', 'min_average', 'gpax']);
  const failing = checks.filter((c) => c.status === 'fail');
  const hasGaps = missingTerms.length > 0 || pendingCourses.length > 0;
  let verdict: Verdict;
  if (checks.some((c) => c.status === 'unknown')) verdict = 'INCOMPLETE_DATA';
  else if (failing.length === 0) verdict = checks.some((c) => c.status === 'pending') ? 'INCOMPLETE_DATA' : 'ELIGIBLE';
  else if (hasGaps && failing.every((c) => DATA_SENSITIVE.has(c.id))) verdict = 'INCOMPLETE_DATA';
  else verdict = 'NOT_ELIGIBLE';

  const { dataAsOf, importedAt, ...studentOut } = student;
  return {
    verdict,
    student: studentOut,
    curriculum: { code: rules?.code ?? student.curriculumCode, name: rules?.name ?? student.curriculumCode, source: rules?.source ?? null, configured },
    dataStatus: {
      hasRecords,
      asOfTerm: dataAsOf ? formatTerm(dataAsOf) : null,
      importedAt,
      expectedLatestTerm: formatTerm(expectedLatest),
      isStale,
      missingTerms: missingTerms.map(formatTerm),
      pendingCourses,
    },
    summary: {
      minTotalCredits: rules?.minTotalCredits ?? null,
      registeredCredits,
      earnedCredits,
      pendingCredits,
      gpax,
      gpaxSource: student.registrarGpax !== null ? 'registrar' : computedGpax !== null ? 'computed' : null,
      minGpax: rules?.minGpax ?? null,
      regularSemesters,
      maxRegularSemesters: rules?.maxRegularSemesters ?? null,
    },
    checks,
    categories,
  };
}
