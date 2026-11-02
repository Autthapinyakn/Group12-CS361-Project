// Small DOM helpers. Data from the API is only ever inserted as text (never innerHTML).

/** h('div', { class: 'x', onclick: fn }, 'text', child) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Font Awesome icon, hidden from screen readers. */
export const icon = (name) => h('i', { class: `fa-solid fa-${name}`, 'aria-hidden': 'true' });

export function alertBox(type, title, ...body) {
  const icons = { ok: 'circle-check', warn: 'triangle-exclamation', danger: 'circle-xmark', info: 'circle-info' };
  return h('div', { class: `alert alert--${type}`, role: type === 'danger' ? 'alert' : 'status' },
    icon(icons[type] ?? 'circle-info'),
    h('div', {}, title ? h('strong', {}, title) : null, ...body.map((b) => (typeof b === 'string' ? h('div', {}, b) : b))));
}

export function setStatus(container, type, title, ...body) {
  container.replaceChildren(alertBox(type, title, ...body));
  container.hidden = false;
}

export const badge = (type, text) => h('span', { class: `badge badge--${type}` }, text);

export function loadingRows(cols, rows = 3) {
  return Array.from({ length: rows }, () => h('tr', {}, h('td', { colspan: cols }, h('div', { class: 'skeleton' }))));
}

const THAI_DATE = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
export const formatDateTime = (iso) => (iso ? THAI_DATE.format(new Date(iso)) : '-');
export const formatNumber = (n, digits = 0) =>
  n === null || n === undefined ? '-' : Number(n).toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const formatCredits = (n) => (n === null || n === undefined ? '-' : Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(1));

/** Debounce for search inputs. */
export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Accessible modal: focus moves in, Tab stays inside, Escape and backdrop close it. */
export function openModal(modal, { onClose } = {}) {
  const previous = document.activeElement;
  modal.hidden = false;
  const focusables = () => [...modal.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')];
  focusables()[0]?.focus();
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      const f = focusables();
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  };
  const onClick = (e) => { if (e.target === modal || e.target.closest('[data-close]')) close(); };
  function close() {
    modal.hidden = true;
    document.removeEventListener('keydown', onKey);
    modal.removeEventListener('click', onClick);
    previous?.focus?.();
    onClose?.();
  }
  document.addEventListener('keydown', onKey);
  modal.addEventListener('click', onClick);
  return close;
}

/** Toggle group of chips (aria-pressed). Calls onChange(value). */
export function chipGroup(container, items, active, onChange, label) {
  // Native replaceChildren() would print a missing label as the text "null".
  container.replaceChildren(...[
    label ? h('span', { class: 'chips__label' }, label) : null,
    ...items.map((it) =>
      h('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(it.value === active),
        onclick: (e) => {
          container.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
          e.currentTarget.setAttribute('aria-pressed', 'true');
          onChange(it.value);
        },
      }, it.label)),
  ].filter(Boolean));
}
