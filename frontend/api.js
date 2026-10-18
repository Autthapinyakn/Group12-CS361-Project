// เปลี่ยน URL นี้เป็น API Gateway endpoint จริงหลัง deploy
export const API_BASE = 'https://s98zfaauq3.execute-api.us-east-1.amazonaws.com';

// รหัสหลักสูตร "คอมพิวเตอร์ประยุกต์" ที่ seed ไว้ใน db/seed_v2_real.sql
export const CURRICULUM_ID = '11111111-1111-1111-1111-111111111111';

export async function fetchCourses(headers = {}) {
  const res = await fetch(`${API_BASE}/courses`, { headers });
  if (!res.ok) throw new Error('failed to fetch courses');
  return res.json();
}

export async function fetchCourseById(id, headers = {}) {
  const res = await fetch(`${API_BASE}/courses/${id}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('failed to fetch course');
  return res.json();
}

// คืน array ของ { course, year, semester, category, plan } ทั้งหมดของหลักสูตร
// หน้า courses.html ดึงมาครั้งเดียวแล้ว filter/search ฝั่ง client เพราะข้อมูลมีแค่ ~75 แถว
export async function fetchCurriculum(curriculumId = CURRICULUM_ID, headers = {}) {
  const res = await fetch(`${API_BASE}/curriculum/${curriculumId}`, { headers });
  if (!res.ok) throw new Error('failed to fetch curriculum');
  return res.json();
}


// IDs for the three undergraduate programs. The current seed file contains only the Applied CS curriculum.
// Set the other IDs after those curricula have been inserted into the database; do not reuse an unrelated ID.
export const CURRICULUM_IDS = {
  informationScience: '',
  appliedComputerScience: CURRICULUM_ID,
  networkCybersecurity: '',
};
