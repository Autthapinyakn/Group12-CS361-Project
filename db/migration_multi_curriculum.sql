-- Migration: รองรับหลายหลักสูตร (ภาคพิเศษ / ภาคปกติ / CNC) และข้อมูลรูปแบบใหม่จากไฟล์ แผนการศึกษา_v3.xlsx
-- รันหลัง schema_v2.sql (และ schema_v3.sql ถ้ามี) รันซ้ำได้ ไม่ลบข้อมูลเดิม
-- รันไฟล์นี้ก่อน seed_curricula.sql

BEGIN;

-- 1) curricula.code: คีย์อ่านง่ายสำหรับ URL/ตัวเลือก (applied-cs / cis-cs / cnc)
ALTER TABLE curricula ADD COLUMN IF NOT EXISTS code VARCHAR(30);

-- อัปเดต code ให้ตรงกับที่ใช้ใน seed_curricula.sql
UPDATE curricula SET code = 'applied-cs'
  WHERE id = '11111111-1111-1111-1111-111111111111' AND code IS NULL;
UPDATE curricula SET code = 'cis-cs'
  WHERE id = '22222222-2222-2222-2222-222222222222' AND code IS NULL;
UPDATE curricula SET code = 'cnc'
  WHERE id = '33333333-3333-3333-3333-333333333333' AND code IS NULL;

-- ถ้ามีหลักสูตรอื่นที่ยังไม่มี code คำสั่งถัดไปจะ error ให้ตั้งค่า code ก่อน
ALTER TABLE curricula ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS curricula_code_key ON curricula(code);

-- 2) หน่วยกิตเป็นทศนิยมได้ (มีวิชา 1.5 หน่วยกิต เช่น TU271)
ALTER TABLE courses ALTER COLUMN credits TYPE NUMERIC(3,1) USING credits::numeric;

-- 3) curriculum_courses.choice_slot: แถวที่มี choice_slot เดียวกันในเทอม/แผนเดียวกัน = "เลือก 1 วิชา"
--    (หน่วยกิตของช่องนับครั้งเดียว) ค่า NULL = วิชาบังคับ/ช่องที่ไม่ใช่ตัวเลือก
ALTER TABLE curriculum_courses ADD COLUMN IF NOT EXISTS choice_slot INT;

-- 4) course_prerequisites: ชนิดของเงื่อนไข
--    taken          = เคยศึกษา
--    concurrent_ok  = เคยศึกษา หรือ ศึกษาพร้อมกับ
--    passed         = สอบได้ (min_grade = เกรดต่ำสุด เช่น 'C')
ALTER TABLE course_prerequisites ADD COLUMN IF NOT EXISTS requirement_type VARCHAR(20) NOT NULL DEFAULT 'taken';
ALTER TABLE course_prerequisites ADD COLUMN IF NOT EXISTS min_grade VARCHAR(2);
ALTER TABLE course_prerequisites DROP CONSTRAINT IF EXISTS course_prerequisites_requirement_type_check;
ALTER TABLE course_prerequisites ADD CONSTRAINT course_prerequisites_requirement_type_check
  CHECK (requirement_type IN ('taken', 'concurrent_ok', 'passed'));

-- 5) รายวิชาเลือกที่อยู่ในหลักสูตร (ไม่ผูกกับเทอม) เช่น กลุ่มวิชาโท, วิชาเอกเลือก
CREATE TABLE IF NOT EXISTS curriculum_elective_courses (
  curriculum_id UUID NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  elective_group VARCHAR(255) NOT NULL,
  PRIMARY KEY (curriculum_id, course_id, elective_group)
);
CREATE INDEX IF NOT EXISTS idx_elective_curriculum ON curriculum_elective_courses(curriculum_id);

COMMIT;