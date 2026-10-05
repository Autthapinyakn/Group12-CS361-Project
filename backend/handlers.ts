import { APIGatewayProxyHandler } from 'aws-lambda';
import { PostgresCourseProvider } from './postgresCourseProvider';

const provider = new PostgresCourseProvider();

const jsonResponse = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*', // frontend อยู่คนละ origin (S3/CloudFront)
  },
  body: JSON.stringify(body),
});

// GET /courses
export const getCourses: APIGatewayProxyHandler = async () => {
  try {
    const courses = await provider.getCourses();
    return jsonResponse(200, courses);
  } catch (err) {
    console.error(err);
    return jsonResponse(500, { error: 'internal_error' });
  }
};

// GET /courses/{id}
export const getCourseById: APIGatewayProxyHandler = async (event) => {
  const id = event.pathParameters?.id;
  if (!id) return jsonResponse(400, { error: 'missing_id' });
  const course = await provider.getCourseById(id);
  if (!course) return jsonResponse(404, { error: 'not_found' });
  return jsonResponse(200, course);
};

// GET /curriculum/{curriculumId}
export const getCurriculum: APIGatewayProxyHandler = async (event) => {
  const curriculumId = event.pathParameters?.curriculumId;
  if (!curriculumId) return jsonResponse(400, { error: 'missing_curriculum_id' });
  const entries = await provider.getCurriculum(curriculumId);
  return jsonResponse(200, entries);
};
