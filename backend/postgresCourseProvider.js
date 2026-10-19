"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresCourseProvider = void 0;
const pg_1 = require("pg");
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// คอลัมน์ของวิชา (alias c) ใช้ร่วมกันทุก query เพื่อให้ mapCourse อ่านได้เหมือนกัน
const COURSE_COLUMNS = `c.id, c.code, c.name_th, c.name_en, c.description,
  c.credits, c.category, c.course_type`;
class PostgresCourseProvider {
    async getCourses() {
        const { rows } = await pool.query(`SELECT ${COURSE_COLUMNS} FROM courses c ORDER BY c.code`);
        return this.withPrerequisites(rows);
    }
    async getCourseById(id) {
        if (!UUID_RE.test(id))
            return null; // id ผิดรูปแบบ = ไม่พบ (ไม่ให้ Postgres ตอบ error)
        const { rows } = await pool.query(`SELECT ${COURSE_COLUMNS} FROM courses c WHERE c.id = $1`, [id]);
        if (rows.length === 0)
            return null;
        return (await this.withPrerequisites(rows))[0];
    }
    async getCurricula() {
        const { rows } = await pool.query('SELECT id, code, name, degree_level, year FROM curricula ORDER BY created_at, code');
        return rows.map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            degreeLevel: r.degree_level,
            year: r.year,
        }));
    }
    async getCurriculum(idOrCode) {
        const curriculumId = await this.resolveCurriculumId(idOrCode);
        if (!curriculumId)
            return null;
        const { rows } = await pool.query(`SELECT cc.year, cc.semester, cc.category AS entry_category, cc.plan, cc.choice_slot,
              ${COURSE_COLUMNS}
       FROM curriculum_courses cc
       JOIN courses c ON c.id = cc.course_id
       WHERE cc.curriculum_id = $1
       ORDER BY cc.plan, cc.year, cc.semester, cc.choice_slot NULLS FIRST, c.code`, [curriculumId]);
        const courses = await this.withPrerequisites(rows);
        return rows.map((r, i) => ({
            course: courses[i],
            year: r.year,
            semester: r.semester,
            category: r.entry_category,
            plan: r.plan,
            choiceSlot: r.choice_slot,
        }));
    }
    async getCurriculumElectives(idOrCode) {
        const curriculumId = await this.resolveCurriculumId(idOrCode);
        if (!curriculumId)
            return null;
        const { rows } = await pool.query(`SELECT ce.elective_group, ${COURSE_COLUMNS}
       FROM curriculum_elective_courses ce
       JOIN courses c ON c.id = ce.course_id
       WHERE ce.curriculum_id = $1
       ORDER BY ce.elective_group, c.code`, [curriculumId]);
        const courses = await this.withPrerequisites(rows);
        return rows.map((r, i) => ({ group: r.elective_group, course: courses[i] }));
    }
    async resolveCurriculumId(idOrCode) {
        const sql = UUID_RE.test(idOrCode)
            ? 'SELECT id FROM curricula WHERE id = $1'
            : 'SELECT id FROM curricula WHERE code = $1';
        const { rows } = await pool.query(sql, [idOrCode]);
        return rows.length > 0 ? rows[0].id : null;
    }
    // ดึงวิชาบังคับก่อนของทุกวิชาในครั้งเดียว (แทนการ query ทีละวิชา) แล้วแนบให้แต่ละแถว
    // คืน array ยาวเท่า rows และเรียงตามลำดับเดิม (วิชาเดียวกันที่ซ้ำหลายแถวได้ข้อมูลชุดเดียวกัน)
    async withPrerequisites(rows) {
        const ids = [...new Set(rows.map((r) => r.id))];
        const byCourse = new Map();
        if (ids.length > 0) {
            const { rows: prereqs } = await pool.query(`SELECT course_id, prerequisite_id, choice_group, requirement_type, min_grade
         FROM course_prerequisites
         WHERE course_id = ANY($1::uuid[])
         ORDER BY choice_group, prerequisite_id`, [ids]);
            for (const p of prereqs) {
                const list = byCourse.get(p.course_id) ?? [];
                list.push({
                    courseId: p.prerequisite_id,
                    choiceGroup: p.choice_group,
                    requirementType: p.requirement_type,
                    minGrade: p.min_grade,
                });
                byCourse.set(p.course_id, list);
            }
        }
        return rows.map((r) => ({
            id: r.id,
            code: r.code,
            nameTh: r.name_th,
            nameEn: r.name_en,
            description: r.description,
            credits: Number(r.credits), // NUMERIC กลับมาเป็นสตริงจาก pg
            category: r.category,
            courseType: r.course_type,
            prerequisites: byCourse.get(r.id) ?? [],
        }));
    }
}
exports.PostgresCourseProvider = PostgresCourseProvider;
