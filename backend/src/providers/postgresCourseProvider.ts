import { query } from '../lib/db';
import type {
  CourseDataProvider,
  Course,
  Curriculum,
  CurriculumCourseEntry,
  CurriculumElectiveEntry,
  PrerequisiteOption,
} from './CourseDataProvider';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Course columns (alias c) shared by every query so mapCourse reads them the same way.
const COURSE_COLUMNS = `c.id, c.code, c.name_th, c.name_en, c.description,
  c.credits, c.category, c.course_type, c.version`;

/** Accepts a curriculum UUID or code; returns the UUID or null. */
export async function resolveCurriculumId(idOrCode: string): Promise<string | null> {
  const sql = UUID_RE.test(idOrCode) ? 'SELECT id FROM curricula WHERE id = $1' : 'SELECT id FROM curricula WHERE code = $1';
  const { rows } = await query(sql, [idOrCode]);
  return rows.length > 0 ? rows[0].id : null;
}

export class PostgresCourseProvider implements CourseDataProvider {
  async getCourses(): Promise<Course[]> {
    const { rows } = await query(`SELECT ${COURSE_COLUMNS} FROM courses c ORDER BY c.code`);
    return this.withPrerequisites(rows);
  }

  async getCourseById(id: string): Promise<Course | null> {
    if (!UUID_RE.test(id)) return null; // malformed id = not found (instead of a Postgres error)
    const { rows } = await query(`SELECT ${COURSE_COLUMNS} FROM courses c WHERE c.id = $1`, [id]);
    if (rows.length === 0) return null;
    return (await this.withPrerequisites(rows))[0];
  }

  async getCurricula(): Promise<Curriculum[]> {
    const { rows } = await query(
      `SELECT cu.id, cu.code, cu.name, cu.degree_level, cu.year,
              COALESCE(array_agg(DISTINCT cc.plan) FILTER (WHERE cc.plan IS NOT NULL), '{}') AS plans
       FROM curricula cu LEFT JOIN curriculum_courses cc ON cc.curriculum_id = cu.id
       GROUP BY cu.id ORDER BY cu.created_at, cu.code`,
    );
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      degreeLevel: r.degree_level,
      year: r.year,
      plans: r.plans,
    }));
  }

  async getCurriculum(idOrCode: string): Promise<CurriculumCourseEntry[] | null> {
    const curriculumId = await resolveCurriculumId(idOrCode);
    if (!curriculumId) return null;

    const { rows } = await query(
      `SELECT cc.year, cc.semester, cc.category AS entry_category, cc.plan, cc.choice_slot,
              cc.version AS entry_version, ${COURSE_COLUMNS}
       FROM curriculum_courses cc
       JOIN courses c ON c.id = cc.course_id
       WHERE cc.curriculum_id = $1
       ORDER BY cc.plan, cc.year, cc.semester, cc.choice_slot NULLS FIRST, c.code`,
      [curriculumId],
    );
    const courses = await this.withPrerequisites(rows);
    return rows.map((r, i) => ({
      course: courses[i],
      year: r.year,
      semester: r.semester,
      category: r.entry_category,
      plan: r.plan,
      choiceSlot: r.choice_slot,
      version: r.entry_version,
    }));
  }

  async getCurriculumElectives(idOrCode: string): Promise<CurriculumElectiveEntry[] | null> {
    const curriculumId = await resolveCurriculumId(idOrCode);
    if (!curriculumId) return null;

    const { rows } = await query(
      `SELECT ce.elective_group, ${COURSE_COLUMNS}
       FROM curriculum_elective_courses ce
       JOIN courses c ON c.id = ce.course_id
       WHERE ce.curriculum_id = $1
       ORDER BY ce.elective_group, c.code`,
      [curriculumId],
    );
    const courses = await this.withPrerequisites(rows);
    return rows.map((r, i) => ({ group: r.elective_group, course: courses[i] }));
  }

  // Load the prerequisites of every course in one query (not one per course) and attach them.
  // Returns an array aligned with rows; repeated courses get the same data.
  private async withPrerequisites(rows: any[]): Promise<Course[]> {
    const ids = [...new Set<string>(rows.map((r) => r.id))];
    const byCourse = new Map<string, PrerequisiteOption[]>();
    if (ids.length > 0) {
      const { rows: prereqs } = await query(
        `SELECT course_id, prerequisite_id, choice_group, requirement_type, min_grade
         FROM course_prerequisites
         WHERE course_id = ANY($1::uuid[])
         ORDER BY choice_group, prerequisite_id`,
        [ids],
      );
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
      credits: Number(r.credits), // NUMERIC comes back from pg as a string
      category: r.category,
      courseType: r.course_type,
      version: r.version,
      prerequisites: byCourse.get(r.id) ?? [],
    }));
  }
}
