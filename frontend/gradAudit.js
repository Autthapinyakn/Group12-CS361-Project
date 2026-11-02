// Renders a graduation audit (GET /graduation/me or /graduation/students/{code}) in the layout of the
// registrar's graduation check: status and debt, credits, study duration, GPA, then the category table.
// Used by the student page and the advisor/staff page, so both see exactly the same evidence.
import { h, icon, badge, alertBox, formatCredits, formatDateTime, formatNumber } from './ui.js';
import { curriculumName } from './api.js';

const STATUS_TH = { normal: 'ปกติ', on_leave: 'ลาพักการศึกษา', retired: 'พ้นสภาพ', graduated: 'สำเร็จการศึกษาแล้ว' };
const CHECK_ICON = { pass: 'circle-check', fail: 'circle-xmark', pending: 'hourglass-half', unknown: 'circle-question' };
const COURSE_STATUS = { passed: ['ok', 'ผ่าน'], pending: ['warn', 'รอผล'], failed: ['danger', 'ไม่ผ่าน'], withdrawn: ['neutral', 'ถอน (W)'], not_taken: ['neutral', 'ยังไม่ได้เรียน'] };

function checkText(c, r) {
  const s = r.summary;
  switch (c.id) {
    case 'registrar_data': return 'ยังไม่มีข้อมูลผลการเรียนจากสำนักทะเบียน';
    case 'requirements_configured': return `ยังไม่มีเกณฑ์จบของหลักสูตร${curriculumName(r.curriculum.code)}ในระบบ จึงยังคำนวณผลไม่ได้`;
    case 'financial_status':
      if (c.status === 'pass') return 'ไม่มีหนี้สินค้างชำระ';
      if (c.status === 'fail') return `มีหนี้สินค้างชำระ${c.actual ? ` ${formatNumber(c.actual, 2)} บาท` : ''} ต้องชำระก่อนยื่นขอจบการศึกษา`;
      return 'ยังไม่ทราบสถานะหนี้สิน (สำนักทะเบียนไม่ได้ส่งข้อมูลนี้มา)';
    case 'academic_status': return `สถานภาพนักศึกษา: ${STATUS_TH[r.student.academicStatus] ?? r.student.academicStatus}`;
    case 'max_semesters': return `ระยะเวลาศึกษา ${c.actual} จากไม่เกิน ${c.required} ภาคการศึกษาปกติ`;
    case 'total_credits': return `หน่วยกิตสะสม ${formatCredits(c.actual)} จากขั้นต่ำ ${formatCredits(c.required)} หน่วยกิต${s.pendingCredits ? ` (รอผลอีก ${formatCredits(s.pendingCredits)})` : ''}`;
    case 'gpax': return `ค่าระดับเฉลี่ยสะสม (GPAX) ${c.actual === null ? '-' : Number(c.actual).toFixed(2)} จากขั้นต่ำ ${Number(c.required).toFixed(2)}`;
    case 'category': return `หมวด ${c.categoryCode} ${c.categoryName}: ${formatCredits(c.actual)} / ${formatCredits(c.required)} หน่วยกิต`;
    case 'min_grade':
      return c.status === 'pass'
        ? 'CS101, CS102, CS111 ได้ไม่ต่ำกว่า C'
        : `ต้องได้ไม่ต่ำกว่า C ใน CS101, CS102, CS111 — ยังไม่ผ่าน: ${c.courses?.join(', ') || 'รอผล'}`;
    case 'min_average':
      return `ค่าเฉลี่ย 8 วิชาหลัก ${c.actual === null ? '-' : Number(c.actual).toFixed(2)} จากขั้นต่ำ ${Number(c.required).toFixed(2)}${c.courses?.length ? ` (ยังไม่ได้เรียน: ${c.courses.join(', ')})` : ''}`;
    default: return c.id;
  }
}

function verdictBlock(r) {
  const problems = r.checks.filter((c) => c.status !== 'pass');
  if (r.verdict === 'ELIGIBLE') {
    return h('section', { class: 'verdict verdict--ok', 'aria-live': 'polite' },
      h('span', { class: 'verdict__icon' }, icon('check')),
      h('div', {}, h('h2', {}, 'ผ่านเงื่อนไขการสำเร็จการศึกษาครบทุกข้อ'),
        h('p', { class: 'muted' }, 'ตามข้อมูลจากสำนักทะเบียนที่ระบบได้รับล่าสุด ผลนี้ใช้ประกอบการตรวจสอบเบื้องต้น การอนุมัติจบเป็นไปตามประกาศของมหาวิทยาลัย')));
  }
  if (r.verdict === 'NOT_ELIGIBLE') {
    return h('section', { class: 'verdict verdict--no', 'aria-live': 'polite' },
      h('span', { class: 'verdict__icon' }, icon('xmark')),
      h('div', {}, h('h2', {}, 'ยังไม่ผ่านเงื่อนไขการสำเร็จการศึกษา'),
        h('p', {}, `มี ${problems.filter((c) => c.status === 'fail').length} เงื่อนไขที่ยังไม่ผ่าน ดูรายละเอียดด้านล่าง`)));
  }
  return h('section', { class: 'verdict verdict--incomplete', 'aria-live': 'polite' },
    h('span', { class: 'verdict__icon' }, icon('hourglass-half')),
    h('div', {}, h('h2', {}, 'ยังสรุปผลไม่ได้ เพราะข้อมูลยังไม่ครบ'),
      h('p', {}, 'ผลด้านล่างคำนวณจากข้อมูลที่มีอยู่ และอาจเปลี่ยนเมื่อได้รับข้อมูลที่ขาดจากสำนักทะเบียน')));
}

function dataStatusBlock(r) {
  const d = r.dataStatus;
  const out = [];
  if (!d.hasRecords) {
    out.push(alertBox('warn', 'ยังไม่มีผลการเรียนในระบบ', 'สำนักทะเบียนยังไม่ได้ส่งผลการเรียนของนักศึกษาคนนี้ หรือยังไม่ได้นำเข้า กรุณาติดต่อเจ้าหน้าที่ฝ่ายทะเบียนของสาขา'));
    return out;
  }
  const items = [];
  if (d.missingTerms.length) items.push(h('li', {}, `ไม่พบผลการเรียนของภาคการศึกษา ${d.missingTerms.join(', ')} ทั้งที่สำนักทะเบียนแจ้งว่ามีการลงทะเบียน`));
  if (d.pendingCourses.length) items.push(h('li', {}, `รายวิชาที่ยังรอผล: ${d.pendingCourses.map((p) => `${p.code} (${p.grade}, ภาค ${p.term})`).join(', ')}`));
  if (d.isStale) items.push(h('li', {}, `ข้อมูลล่าสุดเป็นของภาค ${d.asOfTerm ?? '-'} แต่ภาคที่ควรมีผลแล้วคือ ${d.expectedLatestTerm}`));
  const freshness = `ข้อมูลผลการเรียน ณ ภาคการศึกษา ${d.asOfTerm ?? '-'} · นำเข้าเมื่อ ${formatDateTime(d.importedAt)}`;
  if (items.length) {
    out.push(alertBox('warn', 'ข้อมูลจากสำนักทะเบียนยังไม่ครบหรือยังไม่เป็นปัจจุบัน', freshness,
      h('ul', {}, ...items), 'ผลตรวจอาจเปลี่ยนเมื่อได้รับข้อมูลครบ หากข้อมูลไม่ถูกต้องกรุณาติดต่อเจ้าหน้าที่ฝ่ายทะเบียนของสาขา'));
  } else {
    out.push(alertBox('info', null, freshness));
  }
  return out;
}

function stat(label, value, cls) {
  return h('div', {}, h('div', { class: 'stat__label' }, label), h('div', { class: `stat__value ${cls ?? ''}` }, value));
}

function summaryBlock(r) {
  const s = r.summary;
  const st = r.student;
  const debt = st.financialStatus === 'clear' ? 'ไม่มีหนี้สินค้างชำระ'
    : st.financialStatus === 'outstanding' ? `ค้างชำระ ${formatNumber(st.outstandingAmount, 2)} บาท` : 'ไม่ทราบ';
  const lowCredits = s.minTotalCredits !== null && s.earnedCredits < s.minTotalCredits;
  return h('div', { class: 'stat-grid' },
    h('div', { class: 'stat-group' }, h('div', { class: 'stat-group__title' }, icon('id-card'), 'สถานภาพและหนี้สิน'),
      h('div', { class: 'stats' },
        stat('สถานภาพนักศึกษา', STATUS_TH[st.academicStatus] ?? st.academicStatus, st.academicStatus === 'retired' ? 'stat__value--bad' : ''),
        stat('หนี้สินค้างชำระ', debt, st.financialStatus === 'outstanding' ? 'stat__value--bad' : st.financialStatus === 'clear' ? 'stat__value--good' : ''))),
    h('div', { class: 'stat-group' }, h('div', { class: 'stat-group__title' }, icon('book'), 'หน่วยกิต'),
      h('div', { class: 'stats' },
        stat('หน่วยกิตขั้นต่ำ', formatCredits(s.minTotalCredits)),
        stat('หน่วยกิตที่ลง', formatCredits(s.registeredCredits)),
        stat('หน่วยกิตที่ผ่าน', formatCredits(s.earnedCredits), lowCredits ? 'stat__value--bad' : 'stat__value--good'),
        stat('หน่วยกิตที่รอผล', formatCredits(s.pendingCredits)))),
    h('div', { class: 'stat-group' }, h('div', { class: 'stat-group__title' }, icon('clock'), 'ระยะเวลาการศึกษา'),
      h('div', { class: 'stats' },
        stat('อายุความ (สูงสุด)', s.maxRegularSemesters ? `${s.maxRegularSemesters} ภาค` : '-'),
        stat('ภาคการศึกษาที่ศึกษา', `${s.regularSemesters} ภาค`, s.maxRegularSemesters && s.regularSemesters > s.maxRegularSemesters ? 'stat__value--bad' : ''))),
    h('div', { class: 'stat-group' }, h('div', { class: 'stat-group__title' }, icon('chart-line'), 'ค่าระดับเฉลี่ย'),
      h('div', { class: 'stats' },
        stat('ขั้นต่ำ', s.minGpax === null ? '-' : Number(s.minGpax).toFixed(2)),
        stat(s.gpaxSource === 'registrar' ? 'GPAX (สำนักทะเบียน)' : 'GPAX (คำนวณ)', s.gpax === null ? '-' : Number(s.gpax).toFixed(2),
          s.gpax !== null && s.minGpax !== null && s.gpax < s.minGpax ? 'stat__value--bad' : ''))),
  );
}

function checklist(r) {
  const order = { fail: 0, pending: 1, unknown: 2, pass: 3 };
  const items = [...r.checks].sort((a, b) => order[a.status] - order[b.status]);
  const problems = items.filter((c) => c.status !== 'pass');
  const passes = items.filter((c) => c.status === 'pass');
  const li = (c) => h('li', { class: `is-${c.status}` }, icon(CHECK_ICON[c.status]), h('span', {}, checkText(c, r)));
  return h('section', { 'aria-labelledby': 'checks-title' },
    h('div', { class: 'section-title' }, h('h2', { id: 'checks-title' }, problems.length ? 'เงื่อนไขที่ยังไม่ผ่านหรือรอข้อมูล' : 'ผ่านทุกเงื่อนไข')),
    problems.length ? h('ul', { class: 'checklist' }, ...problems.map(li)) : null,
    h('details', { class: 'faq', style: null },
      h('summary', {}, `เงื่อนไขที่ผ่านแล้ว (${passes.length})`),
      h('div', { class: 'faq__answer' }, h('ul', { class: 'checklist' }, ...passes.map(li)))));
}

const CAT_BADGE = { complete: ['ok', 'ครบ'], incomplete: ['danger', 'ยังไม่ครบ'], pending: ['warn', 'รอผล'], not_applicable: ['neutral', 'ไม่ใช้กับแผนนี้'] };

function categoryRows(cat, level, tbody) {
  const [type, text] = cat.isOptional && cat.status !== 'complete'
    ? ['neutral', cat.minCredits ? `${formatCredits(cat.earnedCredits)}/${formatCredits(cat.minCredits)}` : 'ไม่บังคับ']
    : CAT_BADGE[cat.status];
  const pct = cat.minCredits ? Math.min(100, Math.round((cat.earnedCredits / cat.minCredits) * 100)) : 100;
  const detailsId = `cat-${cat.code.replace(/\./g, '-')}`;
  const toggle = cat.courses.length
    ? h('button', { type: 'button', class: 'tree-toggle', 'aria-expanded': 'false', 'aria-controls': detailsId,
        onclick: (e) => {
          const open = e.currentTarget.getAttribute('aria-expanded') === 'true';
          e.currentTarget.setAttribute('aria-expanded', String(!open));
          document.getElementById(detailsId).hidden = open;
        } }, `ดูรายวิชา (${cat.courses.length})`)
    : null;
  tbody.append(h('tr', { class: `lvl-${level} ${cat.status === 'not_applicable' ? 'row-muted' : ''}` },
    h('td', { class: 'code' }, cat.code),
    h('td', {}, h('div', { class: 'tree-name' }, cat.name), toggle,
      h('div', { class: 'course-lines', id: detailsId, hidden: true },
        ...cat.courses.map((c) => {
          const [t, label] = COURSE_STATUS[c.status];
          return badge(t, `${c.code}${c.grade ? ` ${c.grade}` : ''} · ${label}`);
        }))),
    h('td', { class: 'num' }, formatCredits(cat.minCredits)),
    h('td', { class: 'num' }, formatCredits(cat.earnedCredits),
      cat.minCredits ? h('div', { class: 'progress', 'aria-hidden': 'true' }, h('span', { class: pct < 100 ? 'is-low' : '', style: `width:${pct}%` })) : null),
    h('td', { class: 'num' }, cat.pendingCredits ? formatCredits(cat.pendingCredits) : '-'),
    h('td', { class: 'num' }, cat.gpa === null ? '-' : Number(cat.gpa).toFixed(2)),
    h('td', { class: 'center' }, badge(type, text))));
  cat.children.forEach((c) => categoryRows(c, level + 1, tbody));
}

function categoryTable(r) {
  if (!r.categories.length) return null;
  const tbody = h('tbody', {});
  r.categories.forEach((c) => categoryRows(c, 1, tbody));
  return h('section', { 'aria-labelledby': 'cat-title' },
    h('div', { class: 'section-title' }, h('h2', { id: 'cat-title' }, 'เงื่อนไขรายหมวดวิชา')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table tree' },
      h('caption', { class: 'visually-hidden' }, 'หน่วยกิตที่ต้องการ สะสม และรอผล ในแต่ละหมวดวิชา'),
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'หมวด'), h('th', { scope: 'col' }, 'คำอธิบาย'), h('th', { scope: 'col', class: 'num' }, 'หน่วยกิตที่ต้องการ'),
        h('th', { scope: 'col', class: 'num' }, 'หน่วยกิตที่สะสม'), h('th', { scope: 'col', class: 'num' }, 'หน่วยกิตที่รอ'),
        h('th', { scope: 'col', class: 'num' }, 'GPA'), h('th', { scope: 'col', class: 'center' }, 'สถานะ'))),
      tbody)),
    h('p', { class: 'small muted' }, `เกณฑ์อ้างอิง: ${r.curriculum.source ?? '-'} · หมวดหนึ่งนับหน่วยกิตจากรายวิชาที่ผ่านในหมวดนั้น วิชาเดียวอาจนับได้มากกว่าหนึ่งหมวด (เช่น วิชาแกนที่เป็นวิชาเฉพาะด้วย)`));
}

export function renderAudit(container, r) {
  const st = r.student;
  container.replaceChildren(
    h('div', { class: 'row row--between' },
      h('div', {}, h('h2', {}, `${st.fullName}`),
        h('p', { class: 'muted' }, `รหัส ${st.studentCode} · ${curriculumName(st.curriculumCode)} · แผน${st.plan ?? '-'} · เข้าศึกษาปี ${st.enrollmentYear}`)),
      h('span', { class: 'badge badge--brand' }, `ข้อมูล ณ ภาค ${r.dataStatus.asOfTerm ?? '-'}`)),
    verdictBlock(r),
    ...dataStatusBlock(r),
    summaryBlock(r),
    checklist(r),
    categoryTable(r),
  );
}
