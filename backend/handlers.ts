import { APIGatewayProxyEvent, APIGatewayProxyHandler } from 'aws-lambda';
import { pool, PostgresCourseProvider } from './postgresCourseProvider';

const provider = new PostgresCourseProvider();
const jsonResponse = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
  },
  body: JSON.stringify(body),
});

// These checks require API Gateway's Cognito User Pool authorizer to validate JWTs first.
function claims(event: APIGatewayProxyEvent): Record<string, any> {
  return ((event.requestContext as any).authorizer?.claims || (event.requestContext as any).authorizer?.jwt?.claims || {}) as Record<string, any>;
}
function roleOf(event: APIGatewayProxyEvent): string {
  const c = claims(event);
  const groups = Array.isArray(c['cognito:groups']) ? c['cognito:groups'] : String(c['cognito:groups'] || '').split(',');
  const raw = String(c['custom:role'] || c.role || groups[0] || '').toLowerCase();
  if (raw.includes('coordinator')) return 'coordinator';
  if (raw.includes('instructor') || raw.includes('teacher') || raw.includes('lecturer')) return 'instructor';
  if (raw.includes('student')) return 'student';
  return '';
}
function allowed(event: APIGatewayProxyEvent, roles: string[]) { return roles.includes(roleOf(event)); }
function studentId(event: APIGatewayProxyEvent) {
  const c = claims(event);
  return String(c['custom:student_id'] || c['student_id'] || c['username'] || c['cognito:username'] || c.sub || '');
}

// GET /courses
export const getCourses: APIGatewayProxyHandler = async () => {
  try { return jsonResponse(200, await provider.getCourses()); }
  catch (err) { console.error(err); return jsonResponse(500, { error: 'internal_error' }); }
};

// GET /courses/{id}
export const getCourseById: APIGatewayProxyHandler = async (event) => {
  const id = event.pathParameters?.id;
  if (!id) return jsonResponse(400, { error: 'missing_id' });
  try { const course = await provider.getCourseById(id); return course ? jsonResponse(200, course) : jsonResponse(404, { error: 'not_found' }); }
  catch (err) { console.error(err); return jsonResponse(500, { error: 'internal_error' }); }
};

// GET /curriculum/{curriculumId}
export const getCurriculum: APIGatewayProxyHandler = async (event) => {
  const curriculumId = event.pathParameters?.curriculumId;
  if (!curriculumId) return jsonResponse(400, { error: 'missing_curriculum_id' });
  try { return jsonResponse(200, await provider.getCurriculum(curriculumId)); }
  catch (err) { console.error(err); return jsonResponse(500, { error: 'internal_error' }); }
};

// PUT /curriculum/{curriculumId}/courses/{courseId}; coordinator only.
export const updateCurriculumEntry: APIGatewayProxyHandler = async (event) => {
  if (!allowed(event, ['coordinator'])) return jsonResponse(403, { error: 'forbidden' });
  const curriculumId = event.pathParameters?.curriculumId;
  const courseId = event.pathParameters?.courseId;
  if (!curriculumId || !courseId) return jsonResponse(400, { error: 'missing_id' });
  let body: any;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'invalid_json' }); }
  const { nameTh, nameEn, credits, year, semester, category, plan, originalYear, originalSemester, originalPlan } = body;
  if (typeof nameTh !== 'string' || !nameTh.trim() || typeof nameEn !== 'string' || !nameEn.trim() || !Number.isInteger(Number(credits)) || Number(credits) < 0 || ![1,2,3,4].includes(Number(year)) || ![1,2,3].includes(Number(semester)) || typeof plan !== 'string' || !Number.isInteger(Number(originalYear)) || !Number.isInteger(Number(originalSemester)) || typeof originalPlan !== 'string') return jsonResponse(400, { error: 'invalid_fields' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query('SELECT course_id FROM curriculum_courses WHERE curriculum_id=$1 AND course_id=$2 AND year=$3 AND semester=$4 AND plan=$5', [curriculumId, courseId, Number(originalYear), Number(originalSemester), originalPlan]);
    if (!exists.rowCount) { await client.query('ROLLBACK'); return jsonResponse(404, { error: 'curriculum_entry_not_found' }); }
    await client.query('UPDATE courses SET name_th=$1,name_en=$2,credits=$3,category=$4 WHERE id=$5', [nameTh.trim(), nameEn.trim(), Number(credits), category || null, courseId]);
    await client.query('DELETE FROM curriculum_courses WHERE curriculum_id=$1 AND course_id=$2 AND year=$3 AND semester=$4 AND plan=$5', [curriculumId, courseId, Number(originalYear), Number(originalSemester), originalPlan]);
    await client.query('INSERT INTO curriculum_courses (curriculum_id,course_id,year,semester,category,plan) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (curriculum_id,course_id,year,semester,plan) DO UPDATE SET category=EXCLUDED.category', [curriculumId, courseId, Number(year), Number(semester), category || null, plan]);
    await client.query('COMMIT');
    return jsonResponse(200, { ok: true });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); return jsonResponse(500, { error: 'internal_error' }); }
  finally { client.release(); }
};

// GET /graduation/requirements/{curriculumId}
export const getGraduationRequirements: APIGatewayProxyHandler = async (event) => {
  if (!allowed(event, ['student', 'instructor', 'coordinator'])) return jsonResponse(403, { error: 'forbidden' });
  const curriculumId = event.pathParameters?.curriculumId;
  if (!curriculumId) return jsonResponse(400, { error: 'missing_curriculum_id' });
  try {
    const { rows } = await pool.query(`SELECT cc.year,cc.semester,cc.category AS plan_category,cc.plan,c.id,c.code,c.name_th,c.name_en,c.credits,c.category
      FROM curriculum_courses cc JOIN courses c ON c.id=cc.course_id WHERE cc.curriculum_id=$1 ORDER BY cc.year,cc.semester,c.code`, [curriculumId]);
    return jsonResponse(200, rows);
  } catch (err) { console.error(err); return jsonResponse(500, { error: 'internal_error' }); }
};

async function graduationStatusFor(student: string) {
  const { rows: requirements } = await pool.query(`SELECT DISTINCT c.id,c.code,c.name_th,c.credits FROM curriculum_courses cc JOIN courses c ON c.id=cc.course_id WHERE cc.curriculum_id=$1`, ['11111111-1111-1111-1111-111111111111']);
  const { rows: completed } = await pool.query(`SELECT c.id,c.code,c.name_th,c.credits FROM student_course_records r JOIN courses c ON c.id=r.course_id WHERE r.student_id=$1 AND r.record_status='completed'`, [student]);
  const completedIds = new Set(completed.map(r => r.id));
  const requiredCredits = requirements.reduce((sum, r) => sum + Number(r.credits || 0), 0);
  const earnedCredits = completed.reduce((sum, r) => sum + Number(r.credits || 0), 0);
  const missingRequirements = requirements.filter(r => !completedIds.has(r.id)).map(r => `${r.code} ${r.name_th}`);
  return { studentId: student, earnedCredits, requiredCredits, completedCourses: completed.length, requiredCourses: requirements.length, missingRequirements, status: missingRequirements.length ? 'ยังไม่ครบตามข้อมูลที่มี' : 'ครบตามรายการรายวิชาในหลักสูตร' };
}

// GET /graduation/status/me; student sees only own record.
export const getMyGraduationStatus: APIGatewayProxyHandler = async (event) => {
  if (!allowed(event, ['student'])) return jsonResponse(403, { error: 'forbidden' });
  const id = studentId(event); if (!id) return jsonResponse(400, { error: 'missing_student_id_claim' });
  try { const { rows } = await pool.query('SELECT 1 FROM student_course_records WHERE student_id=$1 LIMIT 1', [id]); if (!rows.length) return jsonResponse(404, { error: 'student_records_not_available' }); return jsonResponse(200, await graduationStatusFor(id)); }
  catch (err) { console.error(err); return jsonResponse(500, { error: 'internal_error' }); }
};

// GET /graduation/status/{studentId}; instructor must be related to that student.
export const getStudentGraduationStatus: APIGatewayProxyHandler = async (event) => {
  if (!allowed(event, ['instructor'])) return jsonResponse(403, { error: 'forbidden' });
  const id = event.pathParameters?.studentId; if (!id) return jsonResponse(400, { error: 'missing_student_id' });
  const c = claims(event); const sub = String(c.sub || '');
  try {
    const relation = await pool.query('SELECT 1 FROM instructor_student WHERE instructor_sub=$1 AND student_id=$2', [sub, id]);
    if (!relation.rowCount) return jsonResponse(403, { error: 'student_not_assigned_to_instructor' });
    const { rows } = await pool.query('SELECT 1 FROM student_course_records WHERE student_id=$1 LIMIT 1', [id]);
    if (!rows.length) return jsonResponse(404, { error: 'student_records_not_available' });
    return jsonResponse(200, await graduationStatusFor(id));
  } catch (err) { console.error(err); return jsonResponse(500, { error: 'internal_error' }); }
};
