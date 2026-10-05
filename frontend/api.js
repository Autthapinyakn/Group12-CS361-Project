// เปลี่ยน URL นี้เป็น API Gateway endpoint จริงหลัง deploy
const API_BASE = 'https://<api-id>.execute-api.<region>.amazonaws.com';

// รหัสหลักสูตร "คอมพิวเตอร์ประยุกต์" ที่ seed ไว้ใน db/seed_v2_real.sql
export const CURRICULUM_ID = '11111111-1111-1111-1111-111111111111';

export async function fetchCourses() {
  const res = await fetch(`${API_BASE}/courses`);
  if (!res.ok) throw new Error('failed to fetch courses');
  return res.json();
}

export async function fetchCourseById(id) {
  const res = await fetch(`${API_BASE}/courses/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('failed to fetch course');
  return res.json();
}

// คืน array ของ { course, year, semester, category, plan } ทั้งหมดของหลักสูตร
// หน้า courses.html ดึงมาครั้งเดียวแล้ว filter/search ฝั่ง client เพราะข้อมูลมีแค่ ~75 แถว
export async function fetchCurriculum(curriculumId = CURRICULUM_ID) {
  const res = await fetch(`${API_BASE}/curriculum/${curriculumId}`);
  if (!res.ok) throw new Error('failed to fetch curriculum');
  return res.json();
}
