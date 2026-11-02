import type { PoolClient } from 'pg';
import { withTransaction, type Actor } from '../lib/db';
import { badRequest, conflict, notFound } from '../lib/errors';
import { resolveCurriculumId } from './postgresCourseProvider';

export interface EntryKey {
  courseId: string;
  year: number;
  semester: number;
  plan: string;
}

export interface EntryFields {
  year: number;
  semester: number;
  plan: string;
  category: string | null;
  choiceSlot: number | null;
}

export interface CourseFields {
  nameTh: string;
  nameEn: string;
  credits: number;
  version: number; // the version the editor loaded; a mismatch means someone else saved first
}

async function curriculumOrThrow(idOrCode: string): Promise<string> {
  const id = await resolveCurriculumId(idOrCode);
  if (!id) throw notFound('curriculum_not_found');
  return id;
}

async function courseIdByCode(client: PoolClient, code: string): Promise<string | null> {
  const { rows } = await client.query('SELECT id FROM courses WHERE code = $1', [code]);
  return rows[0]?.id ?? null;
}

/** Add a course to a study plan. A new course code needs names and credits. */
export async function addEntry(
  idOrCode: string,
  input: EntryFields & { courseCode: string; newCourse?: { nameTh: string; nameEn: string; credits: number } },
  actor: Actor,
) {
  const curriculumId = await curriculumOrThrow(idOrCode);
  return withTransaction(actor, async (client) => {
    let courseId = await courseIdByCode(client, input.courseCode);
    if (!courseId) {
      if (!input.newCourse) throw badRequest('course_not_found', 'Course code not in the catalogue; provide name and credits to create it');
      const { rows } = await client.query(
        'INSERT INTO courses (code, name_th, name_en, credits) VALUES ($1, $2, $3, $4) RETURNING id',
        [input.courseCode, input.newCourse.nameTh, input.newCourse.nameEn, input.newCourse.credits],
      );
      courseId = rows[0].id as string;
    }
    try {
      const { rows } = await client.query(
        `INSERT INTO curriculum_courses (curriculum_id, course_id, year, semester, plan, category, choice_slot)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING version`,
        [curriculumId, courseId, input.year, input.semester, input.plan, input.category, input.choiceSlot],
      );
      return { courseId, version: rows[0].version as number };
    } catch (err: any) {
      if (err.code === '23505') throw conflict('entry_exists', 'This course is already in that term of the plan');
      throw err;
    }
  });
}

/**
 * Move/update a plan entry and optionally the course itself. Both updates carry the version the
 * editor loaded, so two coordinators saving at once cannot overwrite each other silently (409).
 */
export async function updateEntry(
  idOrCode: string,
  key: EntryKey & { version: number },
  fields: EntryFields,
  course: CourseFields | null,
  actor: Actor,
) {
  const curriculumId = await curriculumOrThrow(idOrCode);
  return withTransaction(actor, async (client) => {
    let entry;
    try {
      entry = await client.query(
        `UPDATE curriculum_courses
         SET year = $6, semester = $7, plan = $8, category = $9, choice_slot = $10, version = version + 1
         WHERE curriculum_id = $1 AND course_id = $2 AND year = $3 AND semester = $4 AND plan = $5 AND version = $11
         RETURNING version`,
        [curriculumId, key.courseId, key.year, key.semester, key.plan,
          fields.year, fields.semester, fields.plan, fields.category, fields.choiceSlot, key.version],
      );
    } catch (err: any) {
      if (err.code === '23505') throw conflict('entry_exists', 'This course is already in that term of the plan');
      throw err;
    }
    if (entry.rowCount === 0) {
      const { rows } = await client.query(
        'SELECT version FROM curriculum_courses WHERE curriculum_id = $1 AND course_id = $2 AND year = $3 AND semester = $4 AND plan = $5',
        [curriculumId, key.courseId, key.year, key.semester, key.plan],
      );
      if (!rows.length) throw notFound('entry_not_found', 'The plan entry no longer exists');
      throw conflict('version_conflict', 'Someone else changed this entry; reload and try again', { currentVersion: rows[0].version });
    }
    let courseVersion: number | null = null;
    if (course) {
      const res = await client.query(
        `UPDATE courses SET name_th = $2, name_en = $3, credits = $4, version = version + 1, updated_at = now()
         WHERE id = $1 AND version = $5 RETURNING version`,
        [key.courseId, course.nameTh, course.nameEn, course.credits, course.version],
      );
      if (res.rowCount === 0) throw conflict('version_conflict', 'Someone else changed this course; reload and try again');
      courseVersion = res.rows[0].version;
    }
    return { version: entry.rows[0].version as number, courseVersion };
  });
}

export async function deleteEntry(idOrCode: string, key: EntryKey & { version: number }, actor: Actor) {
  const curriculumId = await curriculumOrThrow(idOrCode);
  return withTransaction(actor, async (client) => {
    const res = await client.query(
      `DELETE FROM curriculum_courses
       WHERE curriculum_id = $1 AND course_id = $2 AND year = $3 AND semester = $4 AND plan = $5 AND version = $6`,
      [curriculumId, key.courseId, key.year, key.semester, key.plan, key.version],
    );
    if (res.rowCount === 0) {
      const { rows } = await client.query(
        'SELECT 1 FROM curriculum_courses WHERE curriculum_id = $1 AND course_id = $2 AND year = $3 AND semester = $4 AND plan = $5',
        [curriculumId, key.courseId, key.year, key.semester, key.plan],
      );
      if (!rows.length) throw notFound('entry_not_found');
      throw conflict('version_conflict', 'Someone else changed this entry; reload and try again');
    }
    return { deleted: true };
  });
}
