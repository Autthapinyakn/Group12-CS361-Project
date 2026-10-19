import type { APIGatewayProxyEvent, APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { PostgresCourseProvider } from './postgresCourseProvider';

const provider = new PostgresCourseProvider();

const jsonResponse = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*', // frontend อยู่คนละ origin (S3/CloudFront)
  },
  body: JSON.stringify(body),
});

// ครอบทุก handler: error ที่ไม่คาดคิดตอบ 500 และ log สาเหตุไว้ใน CloudWatch
const handle =
  (fn: (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>): APIGatewayProxyHandler =>
  async (event) => {
    try {
      return await fn(event);
    } catch (err) {
      console.error(err);
      return jsonResponse(500, { error: 'internal_error' });
    }
  };

// GET /courses
export const getCourses = handle(async () => jsonResponse(200, await provider.getCourses()));

// GET /courses/{id}
export const getCourseById = handle(async (event) => {
  const id = event.pathParameters?.id;
  if (!id) return jsonResponse(400, { error: 'missing_id' });
  const course = await provider.getCourseById(id);
  if (!course) return jsonResponse(404, { error: 'not_found' });
  return jsonResponse(200, course);
});

// GET /curricula  -> รายการหลักสูตรทั้งหมด (ใช้ทำตัวเลือกหลักสูตร)
export const getCurricula = handle(async () => jsonResponse(200, await provider.getCurricula()));

// GET /curriculum/{curriculumId}  (curriculumId = UUID หรือ code เช่น special / regular / cnc)
export const getCurriculum = handle(async (event) => {
  const curriculumId = event.pathParameters?.curriculumId;
  if (!curriculumId) return jsonResponse(400, { error: 'missing_curriculum_id' });
  const entries = await provider.getCurriculum(curriculumId);
  if (!entries) return jsonResponse(404, { error: 'curriculum_not_found' });
  return jsonResponse(200, entries);
});

// GET /curriculum/{curriculumId}/electives  -> วิชาเลือกที่อยู่ในหลักสูตร แยกตามกลุ่ม
export const getCurriculumElectives = handle(async (event) => {
  const curriculumId = event.pathParameters?.curriculumId;
  if (!curriculumId) return jsonResponse(400, { error: 'missing_curriculum_id' });
  const entries = await provider.getCurriculumElectives(curriculumId);
  if (!entries) return jsonResponse(404, { error: 'curriculum_not_found' });
  return jsonResponse(200, entries);
});
