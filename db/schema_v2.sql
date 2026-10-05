-- V2 schema: เฉพาะตารางที่ต้องใช้จริงตาม FR1
-- รันไฟล์นี้บน RDS PostgreSQL instance หลัง provision เสร็จ

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE curricula (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  degree_level VARCHAR(50) NOT NULL,
  year INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name_th VARCHAR(255) NOT NULL,
  name_en VARCHAR(255) NOT NULL,
  description TEXT,
  credits INT NOT NULL,
  category VARCHAR(100),
  course_type VARCHAR(50),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- junction table: วิชา A ต้องผ่านวิชาไหนก่อนบ้าง (many-to-many บนตัวเอง)
-- choice_group: แถวที่มี choice_group เดียวกันคือกลุ่ม "เลือกผ่านอันใดอันหนึ่ง" (OR)
-- เช่น CS111 ต้องผ่าน (CS102 OR CS103) -> 2 แถว, choice_group=1 ทั้งคู่
-- ถ้าวิชาหนึ่งมีหลายกลุ่มเงื่อนไขที่ต้อง "ผ่านทั้งหมด" (AND) ให้ใช้ choice_group คนละเลข
CREATE TABLE course_prerequisites (
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  prerequisite_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  choice_group INT NOT NULL DEFAULT 1,
  PRIMARY KEY (course_id, prerequisite_id)
);

-- junction table: วิชาไหนอยู่ปี/เทอมไหนของหลักสูตรไหน ภายใต้แผนไหน (แผนการเรียน)
-- หมายเหตุ: วิชาเดียวกันอาจปรากฏได้หลายครั้งภายใต้ plan/เทอมต่างกัน (พบจริงในข้อมูล data.xlsx)
-- จึงต้องรวม year, semester, plan เข้าไปใน PK ด้วย ไม่ใช่แค่ (curriculum_id, course_id)
CREATE TABLE curriculum_courses (
  curriculum_id UUID NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  year INT NOT NULL,
  semester INT NOT NULL,
  category VARCHAR(100),
  plan VARCHAR(50) NOT NULL DEFAULT 'ทั่วไป', -- ทั่วไป / ทั้งสองแผน / สหกิจศึกษา / หัวข้อพิเศษ
  PRIMARY KEY (curriculum_id, course_id, year, semester, plan)
);

-- index สำหรับ query pattern หลักของ V2 (ค้นหาตามรหัสวิชา, ตามหลักสูตร)
CREATE INDEX idx_courses_code ON courses(code);
CREATE INDEX idx_curriculum_courses_curriculum ON curriculum_courses(curriculum_id);
CREATE INDEX idx_curriculum_courses_plan ON curriculum_courses(plan);
