/**
 * Single Lambda behind API Gateway (HTTP API, payload v2). Routes are matched here so API Gateway can
 * use explicit routes or a {proxy+} route. Secure routes need a Cognito ID token: API Gateway's JWT
 * authorizer verifies it, and every secure handler checks the user's groups again here.
 */
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';
import { Router } from '../lib/router';
import {
  json, readJsonBody, query, requireString, optionalString, requireInt, requireNumber, optionalEmail,
  type ApiEvent, type ApiResult,
} from '../lib/http';
import { HttpError, badRequest, forbidden, fromDatabaseError, notFound } from '../lib/errors';
import { getPrincipal, primaryRole, requirePrincipal, requireRole, type Principal } from '../lib/auth';
import { ping, type Actor } from '../lib/db';
import { PostgresCourseProvider, UUID_RE } from '../providers/postgresCourseProvider';
import * as graduation from '../providers/graduationProvider';
import * as registrar from '../providers/registrarProvider';
import * as curriculumAdmin from '../providers/curriculumAdminProvider';
import * as audit from '../providers/auditProvider';
import * as qa from '../providers/qaProvider';
import { recordSignIn } from '../providers/userProvider';

const catalog = new PostgresCourseProvider();
const router = new Router();
const actorOf = (p: Principal): Actor => ({ email: p.email, role: primaryRole(p) });
const MAX_CSV_BYTES = 5 * 1024 * 1024; // Lambda's synchronous payload limit is 6 MB

// ---------------------------------------------------------------- public (FR1, FR2)
router.add({
  method: 'GET', path: '/health', auth: false,
  handler: async ({ event }) => {
    const db = await ping();
    return json(event, db ? 200 : 503, { status: db ? 'ok' : 'degraded', database: db ? 'ok' : 'unavailable', time: new Date().toISOString() });
  },
});
router.add({ method: 'GET', path: '/courses', auth: false, handler: async ({ event }) => json(event, 200, await catalog.getCourses()) });
router.add({
  method: 'GET', path: '/courses/{id}', auth: false,
  handler: async ({ event, params }) => {
    const course = await catalog.getCourseById(params.id);
    if (!course) throw notFound();
    return json(event, 200, course);
  },
});
router.add({ method: 'GET', path: '/curricula', auth: false, handler: async ({ event }) => json(event, 200, await catalog.getCurricula()) });
router.add({
  method: 'GET', path: '/curriculum/{curriculumId}', auth: false,
  handler: async ({ event, params }) => {
    const entries = await catalog.getCurriculum(params.curriculumId);
    if (!entries) throw notFound('curriculum_not_found');
    return json(event, 200, entries);
  },
});
router.add({
  method: 'GET', path: '/curriculum/{curriculumId}/electives', auth: false,
  handler: async ({ event, params }) => {
    const entries = await catalog.getCurriculumElectives(params.curriculumId);
    if (!entries) throw notFound('curriculum_not_found');
    return json(event, 200, entries);
  },
});
router.add({
  method: 'GET', path: '/curriculum/{curriculumId}/requirements', auth: false,
  handler: async ({ event, params }) => {
    const req = await graduation.getRequirements(params.curriculumId);
    if (!req) throw notFound('curriculum_not_found');
    return json(event, 200, req);
  },
});
router.add({
  method: 'GET', path: '/qa/search', auth: false,
  handler: async ({ event }) => {
    const q = query(event, 'q');
    if (!q) return json(event, 200, { query: '', faqs: await qa.listFaqs(), courses: [] });
    return json(event, 200, await qa.search(requireString(q, 'q', { max: 200 })));
  },
});
router.add({
  method: 'POST', path: '/qa/questions', auth: false,
  handler: async ({ event }) => {
    const body = readJsonBody(event);
    const text = requireString(body.question, 'question', { min: 3, max: 1000 });
    const contact = optionalEmail(body.contactEmail, 'contactEmail');
    const p = getPrincipal(event); // optional: signed-in users are recorded, guests may ask too
    return json(event, 201, await qa.submitQuestion(text, contact, p?.email ?? null));
  },
});

// ---------------------------------------------------------------- signed-in (FR3-FR8)
router.add({
  method: 'GET', path: '/me', auth: true,
  handler: async ({ event }) => {
    const p = requirePrincipal(event);
    await recordSignIn(p).catch((err) => console.warn(JSON.stringify({ level: 'warn', msg: 'recordSignIn failed', error: String(err) })));
    const student = p.roles.has('student') && p.email ? await graduation.findStudentByEmail(p.email) : null;
    return json(event, 200, {
      sub: p.sub, email: p.email, name: p.name, roles: [...p.roles],
      studentCode: student?.student_code ?? null,
    }, { private: true });
  },
});

// FR4: a student checks their own status. Identity = verified email matched to the registrar roster.
router.add({
  method: 'GET', path: '/graduation/me', auth: true,
  handler: async ({ event }) => {
    const p = requirePrincipal(event);
    requireRole(p, 'student');
    if (!p.email) throw forbidden('Your account has no verified email');
    const s = await graduation.findStudentByEmail(p.email);
    if (!s) {
      const latest = await registrar.latestAppliedBatch();
      return json(event, 404, {
        error: 'student_record_not_found',
        message: 'No registrar record matches this account',
        latestImport: latest ? { asOfTerm: latest.asOfTerm, createdAt: latest.createdAt } : null,
      }, { private: true });
    }
    return json(event, 200, await graduation.auditStudent(s), { private: true });
  },
});

// FR5: instructors see their advisees; staff see everyone.
router.add({
  method: 'GET', path: '/graduation/students', auth: true,
  handler: async ({ event }) => {
    const p = requirePrincipal(event);
    requireRole(p, 'instructor', 'staff');
    const isStaff = p.roles.has('staff');
    if (!isStaff && !p.email) throw forbidden('Your account has no verified email');
    const search = optionalString(query(event, 'q'), 'q', { max: 100 }) ?? undefined;
    const students = await graduation.listStudents({ advisorEmail: isStaff ? null : p.email }, search);
    const latest = await registrar.latestAppliedBatch();
    return json(event, 200, {
      scope: isStaff ? 'all' : 'advisees',
      students,
      latestImport: latest ? { asOfTerm: latest.asOfTerm, createdAt: latest.createdAt, status: latest.status } : null,
    }, { private: true });
  },
});
router.add({
  method: 'GET', path: '/graduation/students/{studentCode}', auth: true,
  handler: async ({ event, params }) => {
    const p = requirePrincipal(event);
    requireRole(p, 'instructor', 'staff');
    if (!/^\d{10}$/.test(params.studentCode)) throw badRequest('invalid_student_code', 'Student code must be 10 digits');
    const s = await graduation.findStudentByCode(params.studentCode);
    if (!s) throw notFound('student_record_not_found', 'No registrar record for this student code');
    const advises = !!p.email && !!s.advisor_email && s.advisor_email.toLowerCase() === p.email;
    if (!p.roles.has('staff') && !advises) throw forbidden('This student is not one of your advisees');
    return json(event, 200, await graduation.auditStudent(s), { private: true });
  },
});

// FR6: registrar exchange (batch CSV), staff only.
router.add({
  method: 'POST', path: '/registrar/imports', auth: true,
  handler: async ({ event }) => {
    const p = requirePrincipal(event);
    requireRole(p, 'staff');
    const body = readJsonBody(event);
    const csv = requireString(body.csv, 'csv', { max: MAX_CSV_BYTES });
    const asOf = {
      year: requireInt(body.asOfYear, 'asOfYear', 2500, 2700),
      semester: requireInt(body.asOfSemester, 'asOfSemester', 1, 3),
    };
    const fileName = optionalString(body.fileName, 'fileName');
    const result = await registrar.importBatch(csv, { fileName, asOf }, actorOf(p));
    const status = result.duplicate ? 409 : result.batch.status === 'failed' ? 422 : 201;
    return json(event, status, { duplicate: result.duplicate, batch: result.batch }, { private: true });
  },
});
router.add({
  method: 'GET', path: '/registrar/imports', auth: true,
  handler: async ({ event }) => {
    const p = requirePrincipal(event);
    requireRole(p, 'staff');
    return json(event, 200, await registrar.listBatches(30), { private: true });
  },
});

// FR7: curriculum editing, coordinators only. FR8: every change is logged by database triggers.
const entryFields = (body: Record<string, unknown>): curriculumAdmin.EntryFields => ({
  year: requireInt(body.year, 'year', 1, 8),
  semester: requireInt(body.semester, 'semester', 1, 3),
  plan: requireString(body.plan, 'plan', { max: 50 }),
  category: optionalString(body.category, 'category', { max: 100 }),
  choiceSlot: body.choiceSlot === null || body.choiceSlot === undefined || body.choiceSlot === '' ? null : requireInt(body.choiceSlot, 'choiceSlot', 1, 99),
});
const courseCode = (v: unknown) => {
  const code = requireString(v, 'courseCode', { max: 20 }).toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z]{2,6}\d{3}$/.test(code)) throw badRequest('invalid_field', 'courseCode must look like CS101', { field: 'courseCode' });
  return code;
};
const uuid = (v: unknown, field: string) => {
  const s = requireString(v, field, { max: 36 });
  if (!UUID_RE.test(s)) throw badRequest('invalid_field', `${field} must be a UUID`, { field });
  return s;
};

router.add({
  method: 'POST', path: '/curriculum/{curriculumId}/entries', auth: true,
  handler: async ({ event, params }) => {
    const p = requirePrincipal(event);
    requireRole(p, 'coordinator');
    const body = readJsonBody(event);
    const nc = body.newCourse as Record<string, unknown> | undefined;
    const result = await curriculumAdmin.addEntry(params.curriculumId, {
      ...entryFields(body),
      courseCode: courseCode(body.courseCode),
      newCourse: nc ? {
        nameTh: requireString(nc.nameTh, 'newCourse.nameTh'),
        nameEn: requireString(nc.nameEn, 'newCourse.nameEn'),
        credits: requireNumber(nc.credits, 'newCourse.credits', 0, 12),
      } : undefined,
    }, actorOf(p));
    return json(event, 201, result, { private: true });
  },
});
router.add({
  method: 'PUT', path: '/curriculum/{curriculumId}/entries', auth: true,
  handler: async ({ event, params }) => {
    const p = requirePrincipal(event);
    requireRole(p, 'coordinator');
    const body = readJsonBody(event);
    const original = (body.original ?? {}) as Record<string, unknown>;
    const course = body.course as Record<string, unknown> | undefined;
    const result = await curriculumAdmin.updateEntry(
      params.curriculumId,
      {
        courseId: uuid(body.courseId, 'courseId'),
        year: requireInt(original.year, 'original.year', 1, 8),
        semester: requireInt(original.semester, 'original.semester', 1, 3),
        plan: requireString(original.plan, 'original.plan', { max: 50 }),
        version: requireInt(body.version, 'version', 1, 1_000_000),
      },
      entryFields(body),
      course ? {
        nameTh: requireString(course.nameTh, 'course.nameTh'),
        nameEn: requireString(course.nameEn, 'course.nameEn'),
        credits: requireNumber(course.credits, 'course.credits', 0, 12),
        version: requireInt(course.version, 'course.version', 1, 1_000_000),
      } : null,
      actorOf(p),
    );
    return json(event, 200, result, { private: true });
  },
});
router.add({
  method: 'DELETE', path: '/curriculum/{curriculumId}/entries', auth: true,
  handler: async ({ event, params }) => {
    const p = requirePrincipal(event);
    requireRole(p, 'coordinator');
    const result = await curriculumAdmin.deleteEntry(params.curriculumId, {
      courseId: uuid(query(event, 'courseId'), 'courseId'),
      year: requireInt(query(event, 'year'), 'year', 1, 8),
      semester: requireInt(query(event, 'semester'), 'semester', 1, 3),
      plan: requireString(query(event, 'plan'), 'plan', { max: 50 }),
      version: requireInt(query(event, 'version'), 'version', 1, 1_000_000),
    }, actorOf(p));
    return json(event, 200, result, { private: true });
  },
});
router.add({
  method: 'GET', path: '/audit/curriculum-changes', auth: true,
  handler: async ({ event }) => {
    const p = requirePrincipal(event);
    requireRole(p, 'coordinator', 'staff');
    const source = query(event, 'source');
    if (source && source !== 'api' && source !== 'db') throw badRequest('invalid_field', 'source must be api or db');
    const before = query(event, 'before');
    const group = query(event, 'group');
    if (group && !(group in audit.ENTITY_GROUPS)) throw badRequest('invalid_field', 'group must be plan or requirements');
    return json(event, 200, await audit.listChanges({
      curriculumCode: optionalString(query(event, 'curriculum'), 'curriculum', { max: 30 }) ?? undefined,
      group: group as audit.EntityGroup | undefined,
      source: source as 'api' | 'db' | undefined,
      before: before ? uuid(before, 'before') : undefined,
      limit: query(event, 'limit') ? requireInt(query(event, 'limit'), 'limit', 1, 200) : 50,
    }), { private: true });
  },
});

export const routes = router.list();

// ---------------------------------------------------------------- entry point
async function dispatch(event: ApiEvent): Promise<ApiResult> {
  const method = event.requestContext?.http?.method ?? 'GET';
  const rawPath = event.rawPath ?? '/';
  const match = router.match(method, rawPath);
  if (match === null) throw notFound('route_not_found');
  if (match === 'method') throw new HttpError(405, 'method_not_allowed');
  if (match.route.auth) requirePrincipal(event);
  return match.route.handler({ event, params: match.params });
}

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const started = Date.now();
  let result: ApiResult;
  try {
    result = await dispatch(event);
  } catch (err) {
    const httpErr = err instanceof HttpError ? err : fromDatabaseError(err);
    if (httpErr) {
      result = json(event, httpErr.status, { error: httpErr.code, message: httpErr.message, details: httpErr.details });
    } else {
      console.error(JSON.stringify({ level: 'error', msg: 'unhandled error', error: String((err as Error)?.stack ?? err) }));
      result = json(event, 500, { error: 'internal_error', message: 'Unexpected server error' });
    }
  }
  // One structured log line per request: route, status, latency (input for V6 measurements).
  const p = getPrincipal(event);
  console.log(JSON.stringify({
    level: 'info', method: event.requestContext?.http?.method, path: event.rawPath, status: result.statusCode,
    ms: Date.now() - started, role: p ? primaryRole(p) : 'guest', requestId: event.requestContext?.requestId,
  }));
  return result;
};
