#!/usr/bin/env python3
"""
Generate synthetic registrar exports for local testing and user tests (TC1/TC2).

No real student data exists for this project, and real transcripts are personal data, so these
files are prepared records that follow the registrar CSV contract (document/v4/registrar-csv-contract.md).
Study plans follow the official curriculum document (หลักสูตรปี 2566.pdf, section 4.3.2.3).

Usage:  python generate_samples.py            (writes the CSV files next to this script)
Before a user test, replace the example emails with the testers' real sign-in emails.
"""
import csv
import os

HERE = os.path.dirname(os.path.abspath(__file__))
AS_OF = (2569, 1)

HEADER = ['student_code', 'full_name', 'email', 'curriculum_code', 'plan', 'enrollment_year',
          'advisor_email', 'academic_status', 'financial_status', 'outstanding_amount', 'gpax',
          'regular_semesters', 'course_code', 'academic_year', 'semester', 'grade', 'credits']

CREDITS = {'CS303': 2, 'CS304': 2, 'CS403': 4, 'CS404': 4}
POINTS = {'A': 4, 'B+': 3.5, 'B': 3, 'C+': 2.5, 'C': 2, 'D+': 1.5, 'D': 1, 'F': 0}

# (year of study, semester) -> courses
APPLIED_PROJECT = {
    (1, 1): ['CS100', 'CS101', 'CS102', 'TU100', 'TU101', 'TU108', 'ST216'],
    (1, 2): ['CS111', 'MA211', 'TU103', 'LAS101', 'TU106', 'TU109', 'EL105'],
    (2, 1): ['CS180', 'CS216', 'CS233', 'CS240', 'CS261', 'EL295', 'ST329'],
    (2, 2): ['CS234', 'CS232', 'CS251', 'CS262', 'CS271', 'EL395', 'TU201'],
    (3, 1): ['CS263', 'CS264', 'CS301', 'CS361', 'CS364'],
    (3, 2): ['CS303', 'CS305', 'CS362', 'CS363', 'CS367'],
    (4, 1): ['CS403', 'CS246', 'CS287'],
}
APPLIED_COOP = {
    (1, 1): APPLIED_PROJECT[(1, 1)],
    (1, 2): APPLIED_PROJECT[(1, 2)],
    (2, 1): APPLIED_PROJECT[(2, 1)],
    (2, 2): APPLIED_PROJECT[(2, 2)],
    (2, 3): ['CS246', 'CS287'],
    (3, 1): ['CS263', 'CS264', 'CS361', 'CS364'],
    (3, 2): ['CS301', 'CS305', 'CS362', 'CS363', 'CS367'],
    (3, 3): ['CS304'],
    (4, 1): ['CS404'],
}
CIS_PROJECT = {
    (1, 1): ['CS100', 'CS101', 'CS102', 'TU100', 'TU103', 'EL105', 'ST216'],
    (1, 2): ['CS111', 'MA211', 'TU101', 'LAS101', 'TU106', 'TU109', 'TU201'],
    (2, 1): ['CS180', 'CS213', 'CS221', 'CS240', 'CS261', 'EL295', 'ST329'],
    (2, 2): ['CS217', 'CS222', 'CS232', 'CS242', 'CS251', 'CS271', 'EL395'],
    (3, 1): ['CS223', 'CS241', 'CS301', 'CS331', 'TU108'],
    (3, 2): ['CS303', 'CS305', 'CS314', 'CS332', 'CS372'],
    (4, 1): ['CS403', 'CS246', 'CS287'],
}

ADVISOR_A = 'advisor.a@example.ac.th'
ADVISOR_B = 'advisor.b@example.ac.th'


def student(code, name, curriculum, plan, enrolled, advisor, plan_map, grade='B+', overrides=None,
            drop_terms=(), extra=None, financial='clear', outstanding='', status='normal',
            semesters=None, upto=None):
    """Build the rows of one student. overrides: course -> grade; extra: [(course, y, s, grade)]."""
    overrides = overrides or {}
    rows, regular = [], set()
    for (year_of_study, sem), courses in sorted(plan_map.items()):
        academic_year = enrolled + year_of_study - 1
        if upto and (academic_year, sem) > upto:
            continue
        if (academic_year, sem) in drop_terms:
            continue
        if sem in (1, 2):
            regular.add((academic_year, sem))
        for c in courses:
            rows.append((c, academic_year, sem, overrides.get(c, grade)))
    for c, y, s, g in extra or []:
        rows.append((c, y, s, g))
    graded = [(c, g) for c, _, _, g in rows if g in POINTS]
    total = sum(CREDITS.get(c, 3) for c, _ in graded)
    gpax = sum(POINTS[g] * CREDITS.get(c, 3) for c, g in graded) / total if total else 0
    sem_count = semesters if semesters is not None else len(regular)
    base = [code, name, f's{code}@student.example.ac.th', curriculum, plan, enrolled, advisor,
            status, financial, outstanding, f'{gpax:.2f}', sem_count]
    return [base + [c, y, s, g, CREDITS.get(c, 3)] for c, y, s, g in rows]


def main_batch():
    out = []
    # 1. Meets every condition (TC1 happy path).
    out += student('6609650011', 'นายกิตติ ครบถ้วน', 'applied-cs', 'โครงงาน', 2566, ADVISOR_A, APPLIED_PROJECT)
    # 2. Short in two categories: CS367 failed (major) and only one free elective.
    out += student('6609650012', 'นางสาวขวัญ ยังไม่ครบ', 'applied-cs', 'สหกิจศึกษา', 2566, ADVISOR_A, APPLIED_COOP,
                   overrides={'CS367': 'F', 'CS287': 'W'})
    # 3. Credits complete but CS102 below C.
    out += student('6609650013', 'นายคมสัน เกรดซี', 'applied-cs', 'โครงงาน', 2566, ADVISOR_A, APPLIED_PROJECT,
                   overrides={'CS102': 'D+'})
    # 4. Average of the 8 core courses below 2.00 (C in CS101/102/111 but D elsewhere).
    out += student('6609650014', 'นางสาวจันทร์ เฉลี่ยต่ำ', 'applied-cs', 'โครงงาน', 2566, ADVISOR_B, APPLIED_PROJECT,
                   overrides={'CS100': 'D', 'CS101': 'C', 'CS102': 'C', 'CS111': 'C', 'CS232': 'D+',
                              'CS240': 'D', 'CS251': 'D+', 'CS261': 'D'})
    # 5. Co-op 2 still graded I (incomplete): result depends on data not yet available.
    out += student('6609650015', 'นายชยพล รอผล', 'applied-cs', 'สหกิจศึกษา', 2566, ADVISOR_B, APPLIED_COOP,
                   overrides={'CS404': 'I'})
    # 6. Registrar file lacks every record of 2568/2 (TC2: incomplete external data).
    out += student('6609650016', 'นางสาวดารา ข้อมูลขาด', 'cis-cs', 'โครงงาน', 2566, ADVISOR_A, CIS_PROJECT,
                   drop_terms=((2568, 2),), semesters=7)
    # 7. Academically complete but has outstanding debt.
    out += student('6609650017', 'นายธนา ค้างชำระ', 'cis-cs', 'โครงงาน', 2566, ADVISOR_B, CIS_PROJECT,
                   financial='outstanding', outstanding='12500.00')
    # 8. Over the 16 regular-semester limit (transferred into the 2566 curriculum).
    # Records span 17 regular semesters: the plan (2560-2563) plus withdrawn (W) enrolments afterwards.
    late_terms = [(y, s) for y in range(2563, 2569) for s in (1, 2) if (y, s) > (2563, 1)][:10]
    out += student('6009650018', 'นางสาวนภา เกินอายุความ', 'applied-cs', 'โครงงาน', 2560, ADVISOR_B, APPLIED_PROJECT,
                   semesters=17, extra=[('CS310', y, s, 'W') for y, s in late_terms])
    # 9. Second-year student, normal progress (not eligible yet, nothing missing).
    out += student('6709650020', 'นางสาวพิมพ์ ปีสอง', 'applied-cs', 'โครงงาน', 2567, ADVISOR_A, APPLIED_PROJECT,
                   upto=AS_OF)
    return out


def write(name, rows, header=HEADER):
    path = os.path.join(HERE, name)
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        if header:
            w.writerow(header)
        w.writerows(rows)
    print(f'{name}: {len(rows)} rows')


if __name__ == '__main__':
    rows = main_batch()
    write('registrar_2569-1.csv', rows)
    # Partial batch: student 6609650011 has three invalid rows (so none of that student's rows apply);
    # student 6609650012 is valid and is applied.
    bad = [r[:] for r in rows[:3]]
    bad[0][15] = 'Z'                       # unknown grade
    bad[1][3] = 'unknown-curriculum'       # unknown curriculum code
    bad[2][16] = 'three'                   # non-numeric credits
    write('registrar_with_errors.csv', bad + [r for r in rows if r[0] == '6609650012'])
    # Broken file: wrong header, the whole batch fails and the previous snapshot stays.
    write('registrar_broken.csv', [['6609650011', 'x']], header=['id', 'name'])
