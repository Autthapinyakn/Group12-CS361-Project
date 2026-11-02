#!/usr/bin/env python3
"""
Convert the study-plan workbook (document/xlsx/data-2.xlsx) into seed SQL.
One-off tooling, not a runtime dependency.

Usage:
    python import_workbook_edit.py <path-to-xlsx> <output-dir> [previous-seed.sql]
    (the optional previous seed lets the report list courses whose name/credits changed)
Output:
    <output-dir>/seed_curricula.sql   SQL in one transaction, safe to re-run
    <output-dir>/import_report.md     what was changed, skipped or needs checking

Requires: pip install openpyxl
Mapping rules live in the CONFIG section below; change curriculum/plan names there only.
"""
import re
import sys
import uuid
import collections
import os

# ---------------------------------------------------------------- CONFIG
NS = uuid.UUID('12345678-1234-5678-1234-567812345678')  # must match the V2 seed (course id = uuid5(code))

# Curricula: the 'applied-cs' id must match the curriculum already deployed
CURRICULA = {
    'applied-cs': dict(id='11111111-1111-1111-1111-111111111111', name='คอมพิวเตอร์ประยุกต์', degree='ปริญญาตรี', year=2566),
    'cis-cs': dict(id='22222222-2222-2222-2222-222222222222', name='คอมพิวเตอร์และวิทยาการสารสนเทศ', degree='ปริญญาตรี', year=2566),
    'cnc':     dict(id='33333333-3333-3333-3333-333333333333', name='คอมพิวเตอร์เครือข่ายและความปลอดภัยทางไซเบอร์', degree='ปริญญาตรี', year=2568),
}

# Plan sheet -> (curriculum, plan name, is_main); is_main sheets end with the curriculum's elective list.
PLAN_SHEETS = {
    'ภาคพิเศษ(สหกิจ)':       ('applied-cs', 'สหกิจศึกษา', True),
    'ภาคพิเศษ(โครงงาน)':     ('applied-cs', 'โครงงาน', False),
    'ภาคปกติ(สหกิจ)':        ('cis-cs', 'สหกิจศึกษา', True),
    'ภาคปกติ(โครงงาน)':      ('cis-cs', 'โครงงาน', False),
    'CNC แผนสหกิจศึกษา':     ('cnc', 'สหกิจศึกษา', True),
    'CNC แผนโครงงาน 4 ปี':   ('cnc', 'โครงงาน 4 ปี', False),
    'CNC แผนโครงงาน 3.5 ปี': ('cnc', 'โครงงาน 3.5 ปี', False),
}

PLACEHOLDER_CODE = 'เลือกเรียน'
FREE_ELECTIVE = ('ELECTIVE', 'วิชาเลือกเสรี', 'Elective')              # ELECTIVE-1, ELECTIVE-2 (already in the DB)
MAJOR_OR_MINOR = ('ELECTIVE-MAJOR', 'วิชาเอกเลือกหรือวิชาโท', 'Major Elective or Minor Course')
CATEGORY_SLOT_CODE = 'ELECTIVE-GE-WELLBEING'                            # slot for the GE wellbeing range (TU 250-261 or TU 270-276)

REQ_TYPES = {
    'เคยศึกษา หรือ ศึกษาพร้อมกับ': 'concurrent_ok',   # taken before, or taken together
    'เคยศึกษา': 'taken',                               # taken before
    'สอบได้': 'passed',                                # passed
}

# Courses placed in study plans but missing from the workbook's course rows.
# Names come from the official curriculum document (document/context/หลักสูตรปี 2566.pdf).
CATALOG_EXTRAS = {
    'TU107': dict(th='ทักษะดิจิทัลกับการแก้ปัญหา', en='Digital Skill and Problem Solving',
                  credits='3', category='หมวดคณิตศาสตร์ วิทยาศาสตร์และเทคโนโลยี', source='curriculum document'),
}


# ---------------------------------------------------------------- helpers
def norm_code(code):
    """'CS 100' -> 'CS100', 'มธ.103' -> 'TU103'"""
    c = re.sub(r'\s+', '', str(code))
    return re.sub(r'^มธ\.', 'TU', c)


def load_existing_courses(path):
    """Read courses from a previous seed file so the report can list updated ones."""
    sql = open(path, encoding='utf-8').read()
    block = sql[sql.index('INSERT INTO courses'):sql.index('ON CONFLICT (code)')]
    out = {}
    pat = (r"\('[0-9a-f-]{36}', '((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)', (\d+),")
    for m in re.finditer(pat, block):
        code, th, en, cr = m.groups()
        out[code] = dict(th=th.replace("''", "'"), en=en.replace("''", "'"), credits=cr)
    return out


def esc(s):
    return str(s).replace("'", "''")


def sql_str(s):
    return 'NULL' if s is None else "'" + esc(s) + "'"


def course_uuid(code):
    return str(uuid.uuid5(NS, code))


def clean_group(title):
    """Drop the trailing course-count note, e.g. ' (Minor Courses · 5 รายวิชา)'."""
    return re.sub(r'\s*\([^()]*รายวิชา[^()]*\)\s*$', '', title.strip())


def fmt_credits(v):
    f = float(v)
    return str(int(f)) if f == int(f) else str(f)


def parse_block_sheet(ws):
    rows = list(ws.iter_rows(values_only=True))
    terms, electives = [], []
    cur, mode = None, 'terms'
    for r in rows:
        if r[0] is None:
            continue
        a = str(r[0]).strip()
        m = re.match(r'ปีการศึกษาที่\s*(\d+)\s*-\s*ภาคเรียนที่\s*(\d+)', a)
        if m:
            mode = 'terms'
            cur = {'year': int(m.group(1)), 'semester': int(m.group(2)), 'rows': [], 'total': None}
            terms.append(cur)
            continue
        if a.startswith('รายวิชาเลือกที่อยู่ในหลักสูตร'):
            mode, cur = 'electives', None
            continue
        if a == 'รหัสวิชา':
            continue
        if a == 'รวมหน่วยกิต':
            if cur is not None and mode == 'terms':
                cur['total'] = r[4]
            continue
        if mode == 'electives' and r[1] is None and r[2] is None:
            cur = {'group': clean_group(a), 'rows': []}
            electives.append(cur)
            continue
        if cur is not None:
            cur['rows'].append(tuple(r) + (None,) * (6 - len(r)))
    return terms, electives


CODE_RE = r'\(?\s*([A-Za-zก-ฮ]+\.?\s?\d{3})\s*\)?'
KIND_RE = re.compile(r'(CONCURRENT_OK|เคยศึกษา|สอบได้)')


def parse_prereq(text):
    """Parse prerequisite text into (code, requirement_type, min_grade, choice_group) tuples.

    Clauses joined by 'หรือ' (or) share a choice group; 'และ' (and) starts a new group, so a course
    is satisfied when every group has at least one satisfied option. 'ไม่ต่ำกว่า C' (not lower
    than C) applies to every course of the clause it ends and implies 'passed'.
    Examples: 'เคยศึกษา CNC 101 และ CNC 102' -> groups 1 and 2;
              'เคยศึกษา CS 102 หรือ เคยศึกษา CS 103' -> both in group 1.
    """
    out, group, kind, connective, chain_start = [], 1, 'taken', None, 0
    # Protect 'taken or concurrent' from being split on its own 'หรือ'.
    text = re.sub(r'เคยศึกษา\s+หรือ\s+ศึกษาพร้อมกับ', 'CONCURRENT_OK', text.strip())
    for part in re.split(r'\s+(และ|หรือ)\s+', text):
        if part in ('และ', 'หรือ'):
            connective = part
            if part == 'หรือ':
                chain_start = len(out)
            continue
        m = KIND_RE.search(part)
        if m:
            kind = 'concurrent_ok' if m.group(1) == 'CONCURRENT_OK' else REQ_TYPES[m.group(1)]
        codes = [norm_code(c) for c in re.findall(CODE_RE, part)]
        if not codes:
            continue
        if connective == 'และ':
            group += 1
        out.extend([c, kind, None, group] for c in codes)
        grade = re.search(r'ไม่ต่ำกว่า\s+([A-D][+]?)', part)
        if grade:
            # The grade closes the current AND-chain: 'สอบได้ X และ Y ไม่ต่ำกว่า C' grades X too.
            for row in out[chain_start:]:
                row[1], row[2] = 'passed', grade.group(1)
    return [tuple(row) for row in out]


def expand_placeholder(desc):
    """Read the parenthesised options of a 'เลือกเรียน' (choose) row.
    Returns the codes when listed explicitly (e.g. 'มธ.103 หรือ มธ.107'); None for ranges or no list."""
    m = re.search(r'\(([^()]*)\)\s*$', desc)
    if not m:
        return None
    inner = m.group(1)
    if '–' in inner or '-' in inner:       # a code range such as TU 250-261
        return None
    parts = [p.strip() for p in re.split(r'\s+หรือ\s+', inner)]
    if len(parts) < 2 or not all(re.fullmatch(r'(?:มธ\.|[A-Za-z]{2,4})\s?\d{3}', p) for p in parts):
        return None
    return [norm_code(p) for p in parts]


# ---------------------------------------------------------------- main
def main(xlsx_path, out_dir, existing_seed=None):
    import openpyxl  # imported here so parse_prereq() can be tested without it
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    report = collections.defaultdict(list)

    courses = collections.OrderedDict()     # code -> dict(th,en,credits,category,source)
    placements = []                         # curriculum_courses rows
    electives = []                          # curriculum_elective_courses rows
    prereq_text = {}                        # code -> (text, sheet)
    pseudo = {}                             # placeholder codes that become courses

    def add_course(code, th, en, credits, category, source):
        th, en = (th or '').strip(), (en or '').strip()
        if '…' in th or '…' in en:
            report['truncated'].append(f'{code}: name truncated in the source ("{th}")')
        if code in courses:
            old = courses[code]
            if (old['th'], old['en'], old['credits']) != (th, en, fmt_credits(credits)):
                report['conflict'].append(f'{code}: sheets {old["source"]} and {source} disagree')
            return
        courses[code] = dict(th=th, en=en, credits=fmt_credits(credits), category=category, source=source)

    for sheet, (cur_code, plan, is_main) in PLAN_SHEETS.items():
        terms, groups = parse_block_sheet(wb[sheet])
        for blk in terms:
            slot_no = 0
            counters = collections.Counter()
            for r in blk['rows']:
                code_raw, th, en, ctype, credits, prereq = r[:6]
                if str(code_raw).strip() != PLACEHOLDER_CODE:
                    code = norm_code(code_raw)
                    add_course(code, th, en, credits, ctype, sheet)
                    placements.append((cur_code, code, blk['year'], blk['semester'], ctype, plan, None))
                    if prereq:
                        prereq_text.setdefault(code, (str(prereq).strip(), sheet))
                    continue

                # ---- 'เลือกเรียน' (choose) rows ----
                desc = str(th)
                options = expand_placeholder(desc)
                if options:                                   # explicit options -> one row per course + choice_slot
                    slot_no += 1
                    for opt in options:
                        placements.append((cur_code, opt, blk['year'], blk['semester'], ctype, plan, slot_no))
                    continue
                if 'วิชาเลือกเสรี' in desc:
                    base, name_th, name_en = FREE_ELECTIVE
                    n_rows = 1
                elif desc.startswith('วิชาเอกเลือกหรือวิชาโท'):
                    base, name_th, name_en = MAJOR_OR_MINOR
                    n_rows = int(round(float(credits) / 3))   # 9 credits = 3 rows
                else:                                          # range slot such as TU 250-261 or TU 270-276
                    base, name_th, name_en = None, desc, str(en)
                    n_rows = 1
                for _ in range(n_rows):
                    counters[base] += 1
                    if base is None:
                        code = CATEGORY_SLOT_CODE
                        pseudo[code] = (re.sub(r'\s*\(.*\)\s*$', '', desc).strip() + ' (เลือก 1 วิชาจากรายการของหลักสูตร)',
                                        'Category elective slot', 3, 'เลือกตามหมวด')
                    else:
                        code = f'{base}-{counters[base]}'
                        pseudo[code] = (f'{name_th} {counters[base]}', f'{name_en} {counters[base]}', 3, ctype)
                    placements.append((cur_code, code, blk['year'], blk['semester'], ctype, plan, None))

        if is_main:
            for g in groups:
                for r in g['rows']:
                    code = norm_code(r[0])
                    add_course(code, r[1], r[2], r[4], g['group'], sheet)
                    electives.append((cur_code, code, g['group']))
                    if r[5]:
                        prereq_text.setdefault(code, (str(r[5]).strip(), sheet))

        for blk in terms:
            for r in blk['rows']:
                if str(r[0]).strip() != PLACEHOLDER_CODE and r[5]:
                    code = norm_code(r[0])
                    if prereq_text.get(code, (None,))[0] not in (None, str(r[5]).strip()):
                        report['conflict'].append(f'prerequisites of {code} differ between sheets')

    for code, extra in CATALOG_EXTRAS.items():
        courses.setdefault(code, dict(extra))

    referenced = {p[1] for p in placements}
    known_pseudo = set(pseudo) | {'ELECTIVE-1', 'ELECTIVE-2'}
    missing_in_wb = sorted(c for c in referenced if c not in courses and c not in known_pseudo)
    for c in missing_in_wb:
        report['existing_only'].append(f'{c}: not a course row in the workbook nor in CATALOG_EXTRAS')

    # ---- prerequisites ----
    prereq_rows, dropped = [], []
    for code, (text, sheet) in sorted(prereq_text.items()):
        opts = parse_prereq(text)
        if not opts:
            report['prereq_unparsed'].append(f'{code}: "{text}"')
            continue
        for pcode, rtype, min_grade, group in opts:
            if pcode == code:
                continue
            if pcode not in courses and pcode not in referenced:
                dropped.append(f'{code} ← {pcode} ("{text}")')
                continue
            prereq_rows.append((code, pcode, rtype, min_grade, group))
    report['prereq_dropped'] = dropped

    # ---- validate before writing; unknown codes fail loudly instead of vanishing in a JOIN ----
    all_codes = set(courses) | set(pseudo) | {'ELECTIVE-1', 'ELECTIVE-2'}
    for p in placements:
        assert p[1] in all_codes, f'course code missing from the catalogue: {p}'
    keys = collections.Counter((p[0], p[1], p[2], p[3], p[5]) for p in placements)
    dup = [k for k, n in keys.items() if n > 1]
    assert not dup, f'duplicate curriculum_courses rows: {dup[:5]}'
    assert len(set(electives)) == len(electives)
    for r in prereq_rows:
        assert r[0] in all_codes and r[1] in all_codes, f'prerequisite refers to an unknown code: {r}'
    
    if existing_seed:
        old = load_existing_courses(existing_seed)
        for code, c in courses.items():
            if code in old:
                o, diffs = old[code], []
                if o['th'] != c['th']: diffs.append(f'Thai name "{o["th"]}" -> "{c["th"]}"')
                if o['en'] != c['en']: diffs.append(f'English name "{o["en"]}" -> "{c["en"]}"')
                if float(o['credits']) != float(c['credits']): diffs.append(f'credits {o["credits"]} -> {c["credits"]}')
                if diffs:
                    report['updated'].append(f'{code}: ' + '; '.join(diffs))
        report['new_codes'] = [f'new courses not in the previous seed: {len([c for c in courses if c not in old])}']

    write_sql(out_dir, courses, pseudo, placements, electives, prereq_rows)
    write_report(out_dir, courses, pseudo, placements, electives, prereq_rows, report)
    print(f'courses={len(courses)} pseudo={len(pseudo)} placements={len(placements)} '
          f'electives={len(electives)} prerequisites={len(prereq_rows)}')


def write_sql(out_dir, courses, pseudo, placements, electives, prereq_rows):
    os.makedirs(out_dir, exist_ok=True)
    
    L = []
    L.append('-- สร้างโดย import_workbook.py จากไฟล์ แผนการศึกษา_v3.xlsx')
    L.append('BEGIN;')
    L.append('')
    L.append('-- 1) หลักสูตร')
    L.append('INSERT INTO curricula (id, code, name, degree_level, year) VALUES')
    L.append(',\n'.join(f"  ('{c['id']}', '{k}', {sql_str(c['name'])}, {sql_str(c['degree'])}, {c['year']})" for k, c in CURRICULA.items()))
    L.append('ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, degree_level = EXCLUDED.degree_level, year = EXCLUDED.year;')
    L.append('')
    L.append(f'-- 2) รายวิชา {len(courses)} วิชาจากไฟล์ Excel')
    L.append('INSERT INTO courses (id, code, name_th, name_en, credits, category, course_type) VALUES')
    L.append(',\n'.join(
        f"  ('{course_uuid(code)}', {sql_str(code)}, {sql_str(c['th'])}, {sql_str(c['en'])}, {c['credits']}, {sql_str(c['category'])}, NULL)"
        for code, c in courses.items()))
    L.append('ON CONFLICT (code) DO UPDATE SET name_th = EXCLUDED.name_th, name_en = EXCLUDED.name_en, credits = EXCLUDED.credits;')
    L.append('')
    L.append(f'-- 3) วิชาแทนช่องเลือก (placeholder) {len(pseudo)} รายการ')
    L.append('INSERT INTO courses (id, code, name_th, name_en, credits, category, course_type) VALUES')
    L.append(',\n'.join(
        f"  ('{course_uuid(code)}', {sql_str(code)}, {sql_str(v[0])}, {sql_str(v[1])}, {v[2]}, {sql_str(v[3])}, 'placeholder')"
        for code, v in sorted(pseudo.items())))
    L.append('ON CONFLICT (code) DO NOTHING;')
    L.append("UPDATE courses SET course_type = 'placeholder' WHERE code LIKE 'ELECTIVE-%';")
    L.append('')
    L.append('-- 4) แผนการเรียน')
    L.append("DELETE FROM curriculum_courses WHERE curriculum_id IN (SELECT id FROM curricula WHERE code IN ('applied-cs', 'cis-cs', 'cnc'));")
    L.append('INSERT INTO curriculum_courses (curriculum_id, course_id, year, semester, category, plan, choice_slot)')
    L.append('SELECT cu.id, c.id, v.year::int, v.semester::int, v.category::varchar, v.plan::varchar, v.choice_slot::int')
    L.append('FROM (VALUES')
    L.append(',\n'.join(
        f"  ('{p[0]}', {sql_str(p[1])}, {p[2]}, {p[3]}, {sql_str(p[4])}, {sql_str(p[5])}, {'NULL' if p[6] is None else p[6]})"
        for p in placements))
    L.append(') AS v(curriculum_code, course_code, year, semester, category, plan, choice_slot)')
    L.append('JOIN curricula cu ON cu.code = v.curriculum_code')
    L.append('JOIN courses c ON c.code = v.course_code;')
    L.append('')
    L.append(f'-- 5) รายวิชาเลือกที่อยู่ในหลักสูตร {len(electives)} รายการ')
    L.append("DELETE FROM curriculum_elective_courses WHERE curriculum_id IN (SELECT id FROM curricula WHERE code IN ('applied-cs', 'cis-cs', 'cnc'));")
    L.append('INSERT INTO curriculum_elective_courses (curriculum_id, course_id, elective_group)')
    L.append('SELECT cu.id, c.id, v.elective_group::varchar')
    L.append('FROM (VALUES')
    L.append(',\n'.join(f"  ('{e[0]}', {sql_str(e[1])}, {sql_str(e[2])})" for e in electives))
    L.append(') AS v(curriculum_code, course_code, elective_group)')
    L.append('JOIN curricula cu ON cu.code = v.curriculum_code')
    L.append('JOIN courses c ON c.code = v.course_code;')
    L.append('')
    spec_codes = sorted({r[0] for r in prereq_rows})
    L.append(f'-- 6) วิชาบังคับก่อน {len(prereq_rows)} รายการ')
    L.append('DELETE FROM course_prerequisites WHERE course_id IN (SELECT id FROM courses WHERE code IN (')
    L.append('  ' + ', '.join(sql_str(c) for c in spec_codes))
    L.append('));')
    L.append('INSERT INTO course_prerequisites (course_id, prerequisite_id, choice_group, requirement_type, min_grade)')
    L.append('SELECT c.id, p.id, v.choice_group::int, v.requirement_type::varchar, v.min_grade::varchar')
    L.append('FROM (VALUES')
    L.append(',\n'.join(f"  ({sql_str(r[0])}, {sql_str(r[1])}, {sql_str(r[2])}, {sql_str(r[3])}, {r[4]})" for r in prereq_rows))
    L.append(') AS v(course_code, prerequisite_code, requirement_type, min_grade, choice_group)')
    L.append('JOIN courses c ON c.code = v.course_code')
    L.append('JOIN courses p ON p.code = v.prerequisite_code;')
    L.append('')
    L.append('COMMIT;')
    with open(f'{out_dir}/seed_curricula.sql', 'w', encoding='utf-8') as f:
        f.write('\n'.join(L) + '\n')


def write_report(out_dir, courses, pseudo, placements, electives, prereq_rows, report):
    by_cur = collections.Counter((p[0], p[5]) for p in placements)
    R = ['# Import report', '', 'สร้างโดย `import_workbook.py`', '',
         '## สรุป', '',
         f'- วิชาจากไฟล์ Excel: {len(courses)} | วิชาแทนช่องเลือก (placeholder): {len(pseudo)}',
         f'- แถวใน `curriculum_courses`: {len(placements)} | วิชาเลือกในหลักสูตร: {len(electives)} | วิชาบังคับก่อน: {len(prereq_rows)}', '',
         '| หลักสูตร | แผน | จำนวนแถว |', '|---|---|---|']
    for (cur, plan), n in sorted(by_cur.items()):
        R.append(f'| {cur} | {plan} | {n} |')
    sections = [
        ('updated', 'รายวิชาที่มีอยู่แล้วและถูกอัปเดตชื่อ/หน่วยกิตตามไฟล์ Excel'),
        ('truncated', 'ชื่อวิชาที่ถูกตัดในแหล่งข้อมูล'),
        ('conflict', 'ข้อมูลไม่ตรงกันระหว่างชีต'),
        ('existing_only', 'วิชาที่อ้างถึงแต่ไม่มีในไฟล์ Excel'),
        ('prereq_unparsed', 'วิชาบังคับก่อนที่อ่านรูปแบบไม่ออก'),
        ('prereq_dropped', 'ตัวเลือกวิชาบังคับก่อนที่ถูกข้าม'),
    ]
    for key, title in sections:
        R += ['', f'## {title}', '']
        R += [f'- {x}' for x in report[key]] or ['- ไม่มี']
    with open(f'{out_dir}/import_report.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(R) + '\n')


if __name__ == '__main__':
    if len(sys.argv) not in (3, 4):
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) == 4 else None)