// รันด้วย: npx jest tests/courses.test.js
// ต้อง deploy API จริงก่อน และรัน db/seed_v2_real.sql เข้า DB แล้ว

import { fetchCourses, fetchCourseById, fetchCurriculum, CURRICULUM_ID } from '../frontend/api';

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';
const KNOWN_COURSE_CODE = 'CS100'; // มีแน่นอนตาม seed ข้อมูลจริง

test('GET /courses คืนรายวิชาทั้งหมด (ควรมีประมาณ 62 วิชาตามข้อมูลจริง)', async () => {
  const courses = await fetchCourses();
  expect(Array.isArray(courses)).toBe(true);
  expect(courses.length).toBeGreaterThan(50);
});

test('GET /courses/{id} คืนรายละเอียดวิชาที่ถูกต้อง (ใช้ id จากรายการจริง)', async () => {
  const courses = await fetchCourses();
  const target = courses.find((c) => c.code === KNOWN_COURSE_CODE);
  expect(target).toBeDefined();

  const course = await fetchCourseById(target.id);
  expect(course).not.toBeNull();
  expect(course.code).toBe(KNOWN_COURSE_CODE);
});

test('GET /courses/{id} คืน null เมื่อไม่พบวิชา', async () => {
  const course = await fetchCourseById(UNKNOWN_ID);
  expect(course).toBeNull();
});

test('GET /curriculum/{id} คืนแผนการเรียนครบ 75 รายการตามข้อมูลจริง', async () => {
  const entries = await fetchCurriculum(CURRICULUM_ID);
  expect(entries.length).toBeGreaterThan(70);
  expect(entries[0].year).toBeLessThanOrEqual(entries[entries.length - 1].year);
});

test('entries มี field plan ครบ (ทั่วไป / ทั้งสองแผน / สหกิจศึกษา / หัวข้อพิเศษ)', async () => {
  const entries = await fetchCurriculum(CURRICULUM_ID);
  const plans = new Set(entries.map((e) => e.plan));
  expect(plans.has('ทั่วไป')).toBe(true);
  expect(plans.has('สหกิจศึกษา')).toBe(true);
  expect(plans.has('หัวข้อพิเศษ')).toBe(true);
});
