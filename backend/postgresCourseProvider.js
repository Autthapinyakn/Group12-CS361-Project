"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresCourseProvider = void 0;
const pg_1 = require("pg");
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});
class PostgresCourseProvider {
    async getCourses() {
        const { rows } = await pool.query('SELECT * FROM courses ORDER BY code');
        return Promise.all(rows.map((r) => this.mapCourse(r)));
    }
    async getCourseById(id) {
        const { rows } = await pool.query('SELECT * FROM courses WHERE id = $1', [id]);
        if (rows.length === 0)
            return null;
        return this.mapCourse(rows[0]);
    }
    async getCurriculum(curriculumId) {
        const { rows } = await pool.query(`SELECT cc.year, cc.semester, cc.category, cc.plan, c.*
       FROM curriculum_courses cc
       JOIN courses c ON c.id = cc.course_id
       WHERE cc.curriculum_id = $1
       ORDER BY cc.year, cc.semester`, [curriculumId]);
        return Promise.all(rows.map(async (r) => ({
            course: await this.mapCourse(r),
            year: r.year,
            semester: r.semester,
            category: r.category,
            plan: r.plan,
        })));
    }
    async mapCourse(row) {
        const { rows: prereqRows } = await pool.query('SELECT prerequisite_id, choice_group FROM course_prerequisites WHERE course_id = $1', [row.id]);
        return {
            id: row.id,
            code: row.code,
            nameTh: row.name_th,
            nameEn: row.name_en,
            description: row.description,
            credits: row.credits,
            category: row.category,
            courseType: row.course_type,
            prerequisites: prereqRows.map((p) => ({
                courseId: p.prerequisite_id,
                choiceGroup: p.choice_group,
            })),
        };
    }
}
exports.PostgresCourseProvider = PostgresCourseProvider;
