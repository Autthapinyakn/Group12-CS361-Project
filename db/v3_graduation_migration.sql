-- V3 migration for graduation status. Apply after schema_v2.sql and seed_v2_real.sql.
-- Real student results and instructor/student relationships must be imported from an authorized registrar source.
CREATE TABLE IF NOT EXISTS student_course_records (
  student_id VARCHAR(100) NOT NULL,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  record_status VARCHAR(30) NOT NULL DEFAULT 'completed',
  completed_at DATE,
  PRIMARY KEY (student_id, course_id)
);
CREATE INDEX IF NOT EXISTS idx_student_course_records_student ON student_course_records(student_id);

CREATE TABLE IF NOT EXISTS instructor_student (
  instructor_sub VARCHAR(255) NOT NULL,
  student_id VARCHAR(100) NOT NULL,
  PRIMARY KEY (instructor_sub, student_id)
);
CREATE INDEX IF NOT EXISTS idx_instructor_student_student ON instructor_student(student_id);
