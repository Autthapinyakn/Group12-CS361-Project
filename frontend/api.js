// เปลี่ยน URL นี้เป็น API Gateway endpoint จริงหลัง deploy
export const API_BASE = 'https://s98zfaauq3.execute-api.us-east-1.amazonaws.com';

// รหัสหลักสูตรเริ่มต้น (คอมพิวเตอร์ประยุกต์)
export const CURRICULUM_ID = '11111111-1111-1111-1111-111111111111';

// Mapping รหัส ID ของแต่ละหลักสูตร
export const CURRICULUM_IDS = {
  'applied-cs': '11111111-1111-1111-1111-111111111111',
  'cis-cs': '22222222-2222-2222-2222-222222222222',
  'cnc': '33333333-3333-3333-3333-333333333333'
};

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

export async function fetchCurriculum(curriculumId = CURRICULUM_ID, headers = {}) {
  const res = await fetch(`${API_BASE}/curriculum/${curriculumId}`, { headers });
  if (!res.ok) throw new Error('failed to fetch curriculum');
  return res.json();
}