// Course detail dialog shared by the catalogue and study-plan pages.
// Prerequisites: options with the same choiceGroup are alternatives (OR); groups are combined with AND.
import { h, icon, openModal, badge, formatCredits } from './ui.js';

const REQUIREMENT_LABELS = {
  taken: 'เคยศึกษา',
  concurrent_ok: 'เคยศึกษาหรือศึกษาพร้อมกัน',
  passed: 'สอบได้',
};

function optionLabel(p, courseById) {
  const c = courseById.get(p.courseId);
  const grade = p.minGrade ? ` ไม่ต่ำกว่า ${p.minGrade}` : '';
  return h('span', { class: 'row' },
    badge('info', REQUIREMENT_LABELS[p.requirementType] ?? p.requirementType),
    h('strong', {}, c?.code ?? 'วิชาที่ไม่พบในระบบ'),
    c ? h('span', { class: 'small muted' }, c.nameTh) : null,
    grade ? h('span', { class: 'small' }, grade) : null);
}

export function prerequisiteBlock(course, courseById) {
  const groups = new Map();
  for (const p of course.prerequisites ?? []) {
    if (!groups.has(p.choiceGroup)) groups.set(p.choiceGroup, []);
    groups.get(p.choiceGroup).push(p);
  }
  if (!groups.size) return h('p', { class: 'muted' }, 'ไม่มีวิชาบังคับก่อน');
  const ordered = [...groups.entries()].sort((a, b) => a[0] - b[0]);
  const out = [];
  ordered.forEach(([, options], i) => {
    if (i > 0) out.push(h('div', { class: 'prereq-and' }, 'และ'));
    out.push(h('div', { class: 'prereq-group' },
      ...options.flatMap((p, j) => [j > 0 ? h('span', { class: 'small muted' }, 'หรือ') : null, optionLabel(p, courseById)])));
  });
  return h('div', {}, ...out);
}

let modal;
function ensureModal() {
  if (modal) return modal;
  modal = h('div', { class: 'modal', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'course-modal-title' },
    h('div', { class: 'modal__box' },
      h('div', { class: 'modal__head' },
        h('div', {}, h('div', { class: 'eyebrow', id: 'course-modal-code' }), h('h2', { id: 'course-modal-title' })),
        h('button', { class: 'modal__close', type: 'button', 'data-close': true, 'aria-label': 'ปิด' }, icon('xmark'))),
      h('div', { class: 'modal__body stack', id: 'course-modal-body' })));
  document.body.append(modal);
  return modal;
}

/** Open the detail dialog. `extra` = optional [label, value] pairs (e.g. year/term in a plan). */
export function openCourse(course, courseById, extra = []) {
  const m = ensureModal();
  m.querySelector('#course-modal-code').textContent = course.code;
  m.querySelector('#course-modal-title').textContent = course.nameTh;
  const stats = [['หน่วยกิต', formatCredits(course.credits)], ['ชื่อภาษาอังกฤษ', course.nameEn], ...extra];
  if (course.category) stats.push(['ประเภทรายวิชา', course.category]);
  // replaceChildren() would print a literal "null", so optional parts are filtered out first.
  m.querySelector('#course-modal-body').replaceChildren(...[
    h('dl', { class: 'detail-list' }, ...stats.flatMap(([label, value]) => [h('dt', {}, label), h('dd', {}, value ?? '-')])),
    course.description ? h('p', {}, course.description) : null,
    h('h3', { class: 'section-title' }, 'วิชาบังคับก่อน'),
    prerequisiteBlock(course, courseById),
  ].filter(Boolean));
  openModal(m);
}
