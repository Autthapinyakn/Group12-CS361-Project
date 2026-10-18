-- Schema ฉบับสมบูรณ์ (รวมโครงสร้างหลักสูตร, หลายหลักสูตร, และตารางระบบ Users/Students)
-- รันไฟล์นี้ครั้งเดียวจบ สำหรับการตั้งค่า Database ใหม่

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1) หลักสูตร (Curricula) พร้อมรองรับ code ของหลักสูตร (เช่น applied-cs, cis-cs, cnc)
CREATE TABLE curricula (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(30) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  degree_level VARCHAR(50) NOT NULL,
  year INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- 2) รายวิชา (Courses) รองรับหน่วยกิตแบบทศนิยม (เช่น 1.5 หน่วยกิต)
CREATE TABLE courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name_th VARCHAR(255) NOT NULL,
  name_en VARCHAR(255) NOT NULL,
  description TEXT,
  credits NUMERIC(3,1) NOT NULL,
  category VARCHAR(100),
  course_type VARCHAR(50),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- 3) เงื่อนไขรายวิชาบังคับก่อน (Course Prerequisites) รองรับชนิดเงื่อนไขและเกรดขั้นต่ำ
CREATE TABLE course_prerequisites (
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  prerequisite_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  choice_group INT NOT NULL DEFAULT 1,
  requirement_type VARCHAR(20) NOT NULL DEFAULT 'taken',
  min_grade VARCHAR(2),
  PRIMARY KEY (course_id, prerequisite_id),
  CONSTRAINT course_prerequisites_requirement_type_check 
    CHECK (requirement_type IN ('taken', 'concurrent_ok', 'passed'))
);

-- 4) โครงสร้างแผนการเรียนในหลักสูตร (Curriculum Courses) รองรับ choice_slot (เลือก 1 วิชา)
CREATE TABLE curriculum_courses (
  curriculum_id UUID NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  year INT NOT NULL,
  semester INT NOT NULL,
  category VARCHAR(100),
  plan VARCHAR(50) NOT NULL DEFAULT 'ทั่วไป',
  choice_slot INT,
  PRIMARY KEY (curriculum_id, course_id, year, semester, plan)
);

-- 5) รายวิชาเลือกที่อยู่ในหลักสูตร (ไม่ผูกกับเทอม เช่น วิชาโท/วิชาเอกเลือก)
CREATE TABLE curriculum_elective_courses (
  curriculum_id UUID NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  elective_group VARCHAR(255) NOT NULL,
  PRIMARY KEY (curriculum_id, course_id, elective_group)
);

-- 6) ระบบผู้ใช้งาน (Users) และนักศึกษา (Students)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cognito_sub VARCHAR(255) UNIQUE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE students (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  student_code VARCHAR(50) UNIQUE NOT NULL,
  curriculum_id UUID REFERENCES curricula(id) ON DELETE SET NULL,
  enrollment_year INT NOT NULL,
  plan VARCHAR(50) NOT NULL DEFAULT 'ทั่วไป',
  advisor_id UUID REFERENCES users(id) ON DELETE SET NULL
);

-- 7) ประวัติการแก้ไขหลักสูตร (Edit Log)
CREATE TABLE curriculum_edit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(100) NOT NULL,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  change_type VARCHAR(50) NOT NULL,
  old_value JSONB,
  new_value JSONB,
  changed_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Indexes พื้นฐานเพื่อประสิทธิภาพในการ Query
CREATE INDEX idx_courses_code ON courses(code);
CREATE INDEX idx_curriculum_courses_curriculum ON curriculum_courses(curriculum_id);
CREATE INDEX idx_curriculum_courses_plan ON curriculum_courses(plan);
CREATE INDEX idx_elective_curriculum ON curriculum_elective_courses(curriculum_id);
CREATE INDEX idx_users_cognito_sub ON users(cognito_sub);
CREATE INDEX idx_students_curriculum ON students(curriculum_id);