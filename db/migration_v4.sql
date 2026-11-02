-- Migration V4: graduation verification, registrar data exchange, Q&A, audit hardening.
-- Apply after schema_v3.sql and seed_curricula.sql. Safe to re-run: every statement is idempotent
-- and the whole file runs in one transaction, so a failure leaves the database unchanged.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- 1) Curriculum-level graduation rules (values are seeded by seed_v4_requirements.sql)
-- ---------------------------------------------------------------------------
ALTER TABLE curricula ADD COLUMN IF NOT EXISTS min_total_credits NUMERIC(5,1);
ALTER TABLE curricula ADD COLUMN IF NOT EXISTS min_gpax NUMERIC(3,2);
ALTER TABLE curricula ADD COLUMN IF NOT EXISTS max_regular_semesters INT;
ALTER TABLE curricula ADD COLUMN IF NOT EXISTS requirements_source TEXT;

-- ---------------------------------------------------------------------------
-- 2) Optimistic locking for concurrent curriculum edits (HTTP 409 on version mismatch)
-- ---------------------------------------------------------------------------
ALTER TABLE courses ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE curriculum_courses ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

-- Missing foreign-key indexes found in the V3 review.
CREATE INDEX IF NOT EXISTS idx_curriculum_courses_course ON curriculum_courses(course_id);
CREATE INDEX IF NOT EXISTS idx_course_prerequisites_prereq ON course_prerequisites(prerequisite_id);
CREATE INDEX IF NOT EXISTS idx_elective_course ON curriculum_elective_courses(course_id);

-- ---------------------------------------------------------------------------
-- 3) Users: the four signed-in roles (guests have no row)
-- ---------------------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('student', 'instructor', 'staff', 'coordinator'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));

-- ---------------------------------------------------------------------------
-- 4) Registrar data exchange
-- ---------------------------------------------------------------------------
-- One row per uploaded registrar file. The SHA-256 makes re-uploading the same file a no-op;
-- failed batches are kept for the history page but do not block a corrected retry.
CREATE TABLE IF NOT EXISTS registrar_import_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_name VARCHAR(255),
  file_sha256 CHAR(64) NOT NULL,
  as_of_year INT NOT NULL,
  as_of_semester INT NOT NULL CHECK (as_of_semester IN (1, 2, 3)),
  status VARCHAR(10) NOT NULL CHECK (status IN ('applied', 'partial', 'failed')),
  total_rows INT NOT NULL DEFAULT 0,
  accepted_rows INT NOT NULL DEFAULT 0,
  rejected_rows INT NOT NULL DEFAULT 0,
  students_count INT NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  uploaded_by_email VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS registrar_batches_sha_key
  ON registrar_import_batches (file_sha256) WHERE status <> 'failed';
CREATE INDEX IF NOT EXISTS registrar_batches_created_idx ON registrar_import_batches (created_at DESC);

-- V3 keyed students by user_id, so registrar data could not exist before the student signed in.
-- Keep any V3 rows under a new name instead of dropping them, then create the registrar-keyed table.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'students' AND column_name = 'user_id') THEN
    ALTER TABLE students RENAME TO students_v3_legacy;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS students (
  student_code VARCHAR(20) PRIMARY KEY,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  curriculum_code VARCHAR(30) NOT NULL,            -- as delivered by the registrar, even if unknown here
  curriculum_id UUID REFERENCES curricula(id) ON DELETE SET NULL,
  plan VARCHAR(50),
  enrollment_year INT NOT NULL,                    -- Buddhist Era, e.g. 2566
  advisor_email VARCHAR(255),
  academic_status VARCHAR(20) NOT NULL DEFAULT 'normal'
    CHECK (academic_status IN ('normal', 'on_leave', 'retired', 'graduated')),
  financial_status VARCHAR(20) NOT NULL DEFAULT 'unknown'
    CHECK (financial_status IN ('clear', 'outstanding', 'unknown')),
  outstanding_amount NUMERIC(12,2),
  registrar_gpax NUMERIC(3,2),
  regular_semesters_enrolled INT,
  data_as_of_year INT,
  data_as_of_semester INT,
  last_batch_id UUID REFERENCES registrar_import_batches(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS students_email_lower_key ON students (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS students_advisor_lower_idx ON students (lower(advisor_email));
CREATE INDEX IF NOT EXISTS students_curriculum_v4_idx ON students (curriculum_id);

-- Course records are a per-student snapshot: each import replaces the student's rows.
-- No FK to courses: the registrar also sends courses outside this catalogue (free electives).
CREATE TABLE IF NOT EXISTS student_course_records (
  student_code VARCHAR(20) NOT NULL REFERENCES students(student_code) ON DELETE CASCADE,
  course_code VARCHAR(50) NOT NULL,
  academic_year INT NOT NULL,
  semester INT NOT NULL CHECK (semester IN (1, 2, 3)),
  grade VARCHAR(3) NOT NULL
    CHECK (grade IN ('A', 'B+', 'B', 'C+', 'C', 'D+', 'D', 'F', 'S', 'U', 'W', 'I', 'IP')),
  credits NUMERIC(3,1) NOT NULL CHECK (credits >= 0),
  batch_id UUID NOT NULL REFERENCES registrar_import_batches(id),
  PRIMARY KEY (student_code, course_code, academic_year, semester)
);

-- ---------------------------------------------------------------------------
-- 5) Graduation requirements (tree per curriculum; a course may belong to several categories)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grad_requirement_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  curriculum_id UUID NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES grad_requirement_categories(id) ON DELETE CASCADE,
  code VARCHAR(20) NOT NULL,                       -- e.g. '2.1.1', as shown by the registrar audit
  name VARCHAR(255) NOT NULL,
  description TEXT,
  min_credits NUMERIC(5,1) NOT NULL DEFAULT 0 CHECK (min_credits >= 0),
  plan VARCHAR(50),                                -- applies only to students on this study plan
  is_optional BOOLEAN NOT NULL DEFAULT false,      -- minors: progress only, never blocks graduation
  is_catch_all BOOLEAN NOT NULL DEFAULT false,     -- free electives: passed courses not counted elsewhere
  rule JSONB,                                      -- extra checks, see backend/src/domain/graduationAudit.ts
  sort_order INT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  UNIQUE (curriculum_id, code)
);
CREATE INDEX IF NOT EXISTS grad_categories_parent_idx ON grad_requirement_categories (parent_id);

CREATE TABLE IF NOT EXISTS grad_requirement_courses (
  category_id UUID NOT NULL REFERENCES grad_requirement_categories(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (category_id, course_id)
);
CREATE INDEX IF NOT EXISTS grad_courses_course_idx ON grad_requirement_courses (course_id);

-- ---------------------------------------------------------------------------
-- 6) Q&A (FR2): curated answers plus questions nobody has answered yet
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS faq_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  keywords TEXT[] NOT NULL DEFAULT '{}',           -- matched as substrings of the user's question
  curriculum_id UUID REFERENCES curricula(id) ON DELETE SET NULL,
  link_url VARCHAR(255),                           -- page in this site that holds the details
  is_published BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_text TEXT NOT NULL CHECK (char_length(question_text) BETWEEN 3 AND 1000),
  contact_email VARCHAR(255),
  asked_by_email VARCHAR(255),
  status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  answer TEXT,
  answered_by_email VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS questions_status_idx ON questions (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- 7) Audit trail (FR8): triggers write every change, whoever makes it
-- ---------------------------------------------------------------------------
ALTER TABLE curriculum_edit_log ADD COLUMN IF NOT EXISTS actor_email VARCHAR(255);
ALTER TABLE curriculum_edit_log ADD COLUMN IF NOT EXISTS actor_role VARCHAR(50);
ALTER TABLE curriculum_edit_log ADD COLUMN IF NOT EXISTS source VARCHAR(10);
ALTER TABLE curriculum_edit_log ADD COLUMN IF NOT EXISTS summary TEXT;
-- Composite keys (curriculum/course/term/plan) do not fit in VARCHAR(100).
ALTER TABLE curriculum_edit_log ALTER COLUMN entity_id TYPE TEXT;
-- The FK's ON DELETE SET NULL would have to UPDATE log rows, which the log no longer allows.
ALTER TABLE curriculum_edit_log DROP CONSTRAINT IF EXISTS curriculum_edit_log_changed_by_fkey;
-- V3 used TIMESTAMP (no time zone); node-pg reads those as local time, so the UI showed history
-- shifted by the client's UTC offset. Existing values were written by now() in a UTC session.
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'curriculum_edit_log' AND column_name = 'changed_at') = 'timestamp without time zone' THEN
    ALTER TABLE curriculum_edit_log ALTER COLUMN changed_at TYPE TIMESTAMPTZ USING changed_at AT TIME ZONE 'UTC';
  END IF;
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE users ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS curriculum_edit_log_changed_at_idx ON curriculum_edit_log (changed_at DESC);
CREATE INDEX IF NOT EXISTS curriculum_edit_log_entity_idx ON curriculum_edit_log (entity_type, entity_id);

-- The API sets app.actor_email / app.actor_role with set_config(..., true) inside its transaction.
-- Changes made outside the API (DBeaver, seed scripts) are still logged, with source = 'db'.
CREATE OR REPLACE FUNCTION audit_curriculum_change() RETURNS trigger AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_actor text := nullif(current_setting('app.actor_email', true), '');
  v_role text := nullif(current_setting('app.actor_role', true), '');
  v_entity text;
  v_summary text;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' AND (v_old - 'version' - 'updated_at') = (v_new - 'version' - 'updated_at') THEN
    RETURN NULL;  -- nothing meaningful changed
  END IF;
  v_row := coalesce(v_new, v_old);

  IF TG_TABLE_NAME = 'courses' THEN
    v_entity := v_row->>'code';
    v_summary := v_row->>'code';
  ELSIF TG_TABLE_NAME = 'curricula' THEN
    v_entity := v_row->>'code';
    v_summary := v_row->>'code';
  ELSIF TG_TABLE_NAME = 'curriculum_courses' THEN
    v_entity := concat_ws('/', v_row->>'curriculum_id', v_row->>'course_id',
                          (v_row->>'year') || '-' || (v_row->>'semester'), v_row->>'plan');
    v_summary := concat_ws(' ',
      (SELECT code FROM curricula WHERE id = (v_row->>'curriculum_id')::uuid),
      (SELECT code FROM courses WHERE id = (v_row->>'course_id')::uuid),
      'year ' || (v_row->>'year') || '/' || (v_row->>'semester'),
      v_row->>'plan');
  ELSIF TG_TABLE_NAME = 'curriculum_elective_courses' THEN
    v_entity := concat_ws('/', v_row->>'curriculum_id', v_row->>'course_id', v_row->>'elective_group');
    v_summary := concat_ws(' ',
      (SELECT code FROM curricula WHERE id = (v_row->>'curriculum_id')::uuid),
      (SELECT code FROM courses WHERE id = (v_row->>'course_id')::uuid),
      v_row->>'elective_group');
  ELSIF TG_TABLE_NAME = 'course_prerequisites' THEN
    v_entity := concat_ws('/', v_row->>'course_id', v_row->>'prerequisite_id');
    v_summary := concat_ws(' requires ',
      (SELECT code FROM courses WHERE id = (v_row->>'course_id')::uuid),
      (SELECT code FROM courses WHERE id = (v_row->>'prerequisite_id')::uuid));
  ELSIF TG_TABLE_NAME = 'grad_requirement_categories' THEN
    v_entity := v_row->>'id';
    v_summary := concat_ws(' ',
      (SELECT code FROM curricula WHERE id = (v_row->>'curriculum_id')::uuid), v_row->>'code');
  ELSE
    v_entity := concat_ws('/', v_row->>'category_id', v_row->>'course_id');
    v_summary := (SELECT code FROM courses WHERE id = (v_row->>'course_id')::uuid);
  END IF;

  INSERT INTO curriculum_edit_log
    (entity_type, entity_id, change_type, old_value, new_value, actor_email, actor_role, source, summary)
  VALUES
    (TG_TABLE_NAME, v_entity, TG_OP, v_old, v_new, v_actor, v_role,
     CASE WHEN v_actor IS NULL THEN 'db' ELSE 'api' END, v_summary);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['curricula', 'courses', 'curriculum_courses', 'curriculum_elective_courses',
                           'course_prerequisites', 'grad_requirement_categories', 'grad_requirement_courses']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_audit', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION audit_curriculum_change()', t || '_audit', t);
  END LOOP;
END $$;

-- The log is append-only: nobody, including the API's own database user, can rewrite history.
CREATE OR REPLACE FUNCTION forbid_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'curriculum_edit_log is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS curriculum_edit_log_immutable ON curriculum_edit_log;
CREATE TRIGGER curriculum_edit_log_immutable
  BEFORE UPDATE OR DELETE ON curriculum_edit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();
DROP TRIGGER IF EXISTS curriculum_edit_log_no_truncate ON curriculum_edit_log;
CREATE TRIGGER curriculum_edit_log_no_truncate
  BEFORE TRUNCATE ON curriculum_edit_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_mutation();

COMMIT;
