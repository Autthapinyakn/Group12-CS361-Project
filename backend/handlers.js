"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurriculum = exports.getCourseById = exports.getCourses = void 0;
const postgresCourseProvider_1 = require("./postgresCourseProvider");
const provider = new postgresCourseProvider_1.PostgresCourseProvider();
const jsonResponse = (statusCode, body) => ({
    statusCode,
    headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*', // frontend อยู่คนละ origin (S3/CloudFront)
    },
    body: JSON.stringify(body),
});
// GET /courses
const getCourses = async () => {
    try {
        const courses = await provider.getCourses();
        return jsonResponse(200, courses);
    }
    catch (err) {
        console.error(err);
        return jsonResponse(500, { error: 'internal_error' });
    }
};
exports.getCourses = getCourses;
// GET /courses/{id}
const getCourseById = async (event) => {
    const id = event.pathParameters?.id;
    if (!id)
        return jsonResponse(400, { error: 'missing_id' });
    const course = await provider.getCourseById(id);
    if (!course)
        return jsonResponse(404, { error: 'not_found' });
    return jsonResponse(200, course);
};
exports.getCourseById = getCourseById;
// GET /curriculum/{curriculumId}
const getCurriculum = async (event) => {
    const curriculumId = event.pathParameters?.curriculumId;
    if (!curriculumId)
        return jsonResponse(400, { error: 'missing_curriculum_id' });
    const entries = await provider.getCurriculum(curriculumId);
    return jsonResponse(200, entries);
};
exports.getCurriculum = getCurriculum;
