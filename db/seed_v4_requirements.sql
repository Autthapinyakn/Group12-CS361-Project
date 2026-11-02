-- Graduation requirements for applied-cs and cis-cs.
-- Source: B.Sc. Computer Science curriculum (revised B.E. 2566), document/context/หลักสูตรปี 2566.pdf,
-- sections 4.1.2, 4.3 and 7.2. Category numbering follows the registrar audit layout
-- (document/xlsx/grad req.xlsx). cnc (B.E. 2568 programme) is not covered by that document.
-- Re-runnable: replaces the requirement tree of the two curricula in one transaction.

BEGIN;

UPDATE curricula
SET min_total_credits = 123,
    min_gpax = 2.00,
    max_regular_semesters = 16,
    requirements_source = 'มคอ.2 หลักสูตรวิทยาศาสตรบัณฑิต สาขาวิชาวิทยาการคอมพิวเตอร์ (ฉบับปรับปรุง พ.ศ. 2566)'
WHERE code IN ('applied-cs', 'cis-cs');

DELETE FROM grad_requirement_categories
WHERE curriculum_id IN (SELECT id FROM curricula WHERE code IN ('applied-cs', 'cis-cs'));

-- Category tree shared by both majors. NULL curriculum_code = both.
CREATE TEMP TABLE tmp_categories (
  curriculum_code VARCHAR(30),
  code VARCHAR(20),
  parent_code VARCHAR(20),
  name VARCHAR(255),
  min_credits NUMERIC(5,1),
  plan VARCHAR(50),
  is_optional BOOLEAN,
  is_catch_all BOOLEAN,
  rule JSONB,
  sort_order INT
) ON COMMIT DROP;

INSERT INTO tmp_categories VALUES
  (NULL, '1',       NULL,    'วิชาศึกษาทั่วไป', 30, NULL, false, false, NULL, 10),
  (NULL, '1.1',     '1',     'หมวดความเท่าทันโลกและสังคม', 6, NULL, false, false, NULL, 11),
  (NULL, '1.2',     '1',     'หมวดสุนทรียะและทักษะการสื่อสาร', 9, NULL, false, false, NULL, 12),
  (NULL, '1.3',     '1',     'หมวดคณิตศาสตร์ วิทยาศาสตร์และเทคโนโลยี (เลือก 1 วิชา)', 3, NULL, false, false, NULL, 13),
  (NULL, '1.4',     '1',     'หมวดสุขภาวะและทักษะแห่งอนาคต', 9, NULL, false, false, NULL, 14),
  (NULL, '1.4.1',   '1.4',   'เลือกศึกษา 3 หน่วยกิตจากรายวิชาต่อไปนี้', 3, NULL, false, false, NULL, 15),
  (NULL, '1.5',     '1',     'หมวดการบริการสังคมและการเรียนรู้จากการปฏิบัติ', 3, NULL, false, false, NULL, 16),
  (NULL, '2',       NULL,    'วิชาเฉพาะ', 87, NULL, false, false, NULL, 20),
  (NULL, '2.1',     '2',     'วิชาแกน 12 หน่วยกิต และวิชาเฉพาะด้าน 42 หน่วยกิต', 48, NULL, false, false, NULL, 21),
  (NULL, '2.1.1',   '2.1',   'ต้องสอบไล่ได้ไม่ต่ำกว่า C ในรายวิชา CS101, CS102, CS111 และค่าเฉลี่ยรวม 8 วิชาไม่ต่ำกว่า 2.00', 24, NULL, false, false,
     '{"minGrade": {"grade": "C", "courses": ["CS101", "CS102", "CS111"]},
       "minAverage": {"value": 2.00, "courses": ["CS100", "CS101", "CS102", "CS111", "CS232", "CS240", "CS251", "CS261"]}}', 22),
  (NULL, '2.1.2',   '2.1',   'ต้องศึกษา 8 วิชา', 24, NULL, false, false, NULL, 23),
  (NULL, '2.1.3',   '2.1',   'รายวิชาที่ต้องศึกษา (โครงงานพิเศษหรือสหกิจศึกษา)', 6, NULL, false, false, NULL, 24),
  (NULL, '2.1.3.1', '2.1.3', 'สำหรับนักศึกษาที่เลือกทำหัวข้อพิเศษ', 6, 'โครงงาน', false, false, NULL, 25),
  (NULL, '2.1.3.2', '2.1.3', 'สำหรับนักศึกษาที่เลือกแผนสหกิจศึกษา', 6, 'สหกิจศึกษา', false, false, NULL, 26),
  ('applied-cs', '2.2', '2', 'วิชาเอก (คอมพิวเตอร์ประยุกต์)', 30, NULL, false, false, NULL, 27),
  ('cis-cs', '2.2', '2', 'วิชาเอก (คอมพิวเตอร์และวิทยาการสารสนเทศ)', 30, NULL, false, false, NULL, 27),
  (NULL, '2.3',     '2',     'วิชาบังคับนอกสาขา', 3, NULL, false, false, NULL, 28),
  (NULL, '3',       NULL,    'วิชาเลือกเสรี', 6, NULL, false, true,
     '{"excludeCodePattern": "^(TU|EL|LAS)1[0-9]{2}$"}', 30),
  (NULL, '4',       NULL,    'วิชาโท (ไม่บังคับ)', 0, NULL, true, false, NULL, 40),
  (NULL, '4.1',     '4',     'วิชาโทการออกแบบและพัฒนาผลิตภัณฑ์ดิจิทัล', 15, NULL, true, false, NULL, 41),
  (NULL, '4.2',     '4',     'วิชาโทเดฟออปส์', 15, NULL, true, false, NULL, 42),
  (NULL, '4.3',     '4',     'วิชาโทวิทยาการข้อมูล', 15, NULL, true, false, NULL, 43),
  (NULL, '4.4',     '4',     'วิชาโทปัญญาประดิษฐ์', 15, NULL, true, false, NULL, 44);

INSERT INTO grad_requirement_categories
  (curriculum_id, code, name, min_credits, plan, is_optional, is_catch_all, rule, sort_order)
SELECT cu.id, t.code, t.name, t.min_credits, t.plan, t.is_optional, t.is_catch_all, t.rule, t.sort_order
FROM tmp_categories t
JOIN curricula cu ON cu.code IN ('applied-cs', 'cis-cs')
                 AND (t.curriculum_code IS NULL OR t.curriculum_code = cu.code);

UPDATE grad_requirement_categories child
SET parent_id = parent.id
FROM tmp_categories t, grad_requirement_categories parent
WHERE t.code = child.code
  AND t.parent_code IS NOT NULL
  AND parent.curriculum_id = child.curriculum_id
  AND parent.code = t.parent_code
  AND child.curriculum_id IN (SELECT id FROM curricula WHERE code IN ('applied-cs', 'cis-cs'));

-- Course lists per category (leaf categories only; parents aggregate their children).
CREATE TEMP TABLE tmp_category_courses (
  curriculum_code VARCHAR(30),
  category_code VARCHAR(20),
  course_code VARCHAR(50)
) ON COMMIT DROP;

INSERT INTO tmp_category_courses
SELECT NULL, v.cat, unnest(v.codes) FROM (VALUES
  ('1.1',     ARRAY['TU101', 'TU109']),
  ('1.2',     ARRAY['EL105', 'LAS101', 'TU106']),
  ('1.3',     ARRAY['TU103', 'TU107']),
  ('1.4',     ARRAY['EL295', 'TU108']),
  ('1.4.1',   ARRAY['TU201', 'TU202', 'TU301']),
  ('1.5',     ARRAY['TU100']),
  ('2.1.1',   ARRAY['CS100', 'CS101', 'CS102', 'CS111', 'CS232', 'CS240', 'CS251', 'CS261']),
  ('2.1.2',   ARRAY['MA211', 'ST216', 'ST329', 'CS180', 'CS271', 'CS301', 'CS305']),
  ('2.1.3.1', ARRAY['CS303', 'CS403']),
  ('2.1.3.2', ARRAY['CS304', 'CS404']),
  ('2.3',     ARRAY['EL395']),
  ('4.1',     ARRAY['CS287', 'CS342', 'CS355', 'CS384', 'CS385']),
  ('4.2',     ARRAY['CS224', 'CS341', 'CS365', 'CS366']),
  ('4.3',     ARRAY['CS246', 'CS343', 'CS345', 'CS346', 'CS440']),
  ('4.4',     ARRAY['CS343', 'CS371', 'CS373', 'CS374'])
) AS v(cat, codes);

INSERT INTO tmp_category_courses
SELECT v.cur, v.cat, unnest(v.codes) FROM (VALUES
  ('applied-cs', '2.1.2', ARRAY['CS233']),
  ('cis-cs',     '2.1.2', ARRAY['CS221']),
  ('applied-cs', '2.2',   ARRAY['CS216', 'CS234', 'CS262', 'CS263', 'CS264', 'CS361', 'CS362', 'CS363', 'CS364', 'CS367']),
  ('cis-cs',     '2.2',   ARRAY['CS213', 'CS217', 'CS222', 'CS223', 'CS241', 'CS242', 'CS314', 'CS331', 'CS332', 'CS372']),
  ('applied-cs', '4.2',   ARRAY['CS223']),
  ('cis-cs',     '4.2',   ARRAY['CS361']),
  ('applied-cs', '4.4',   ARRAY['CS372']),
  ('cis-cs',     '4.4',   ARRAY['CS370'])
) AS v(cur, cat, codes);

-- Every listed course must exist in the catalogue; fail instead of silently dropping it.
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(DISTINCT t.course_code, ', ') INTO missing
  FROM tmp_category_courses t LEFT JOIN courses c ON c.code = t.course_code
  WHERE c.id IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Courses missing from the catalogue: %', missing;
  END IF;
END $$;

INSERT INTO grad_requirement_courses (category_id, course_id)
SELECT DISTINCT g.id, c.id
FROM tmp_category_courses t
JOIN curricula cu ON cu.code IN ('applied-cs', 'cis-cs')
                 AND (t.curriculum_code IS NULL OR t.curriculum_code = cu.code)
JOIN grad_requirement_categories g ON g.curriculum_id = cu.id AND g.code = t.category_code
JOIN courses c ON c.code = t.course_code;

COMMIT;
