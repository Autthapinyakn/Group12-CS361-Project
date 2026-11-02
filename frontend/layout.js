// Header, side menu and footer for every page, defined once.
// A page provides <header id="site-header"></header>, <main id="main"> and <footer id="site-footer"></footer>
// and calls initLayout(). The side menu sits beside <main> on wide screens and is a drawer on smaller
// ones. Menu entries follow the user's roles; the API enforces the same rules.
import { currentUser, logout, ROLE_LABELS, rememberReturn } from './auth.js';
import { h, icon } from './ui.js';

const NAV = [
  { href: 'index.html', label: 'หน้าแรก', icon: 'house' },
  { href: 'courses.html', label: 'ค้นหารายวิชา', icon: 'magnifying-glass' },
  { href: 'program.html', label: 'หลักสูตรและแผนการเรียน', icon: 'route' },
  { href: 'qa.html', label: 'ถามคำถาม', icon: 'circle-question' },
  { href: 'about-cs.html', label: 'เกี่ยวกับหลักสูตร', icon: 'circle-info' },
];
const ROLE_NAV = [
  { href: 'graduation-requirements.html', label: 'ตรวจสอบการสำเร็จการศึกษา', icon: 'list-check', roles: ['student'] },
  { href: 'graduation-status.html', label: 'สถานะจบของนักศึกษา', icon: 'user-check', roles: ['instructor', 'staff'] },
  { href: 'registrar-import.html', label: 'นำเข้าข้อมูลทะเบียน', icon: 'file-import', roles: ['staff'] },
  { href: 'curriculum-edit.html', label: 'จัดการหลักสูตร', icon: 'pen-to-square', roles: ['coordinator'] },
];

const currentPage = () => window.location.pathname.split('/').pop() || 'index.html';

function brand() {
  return h('a', { class: 'brand', href: 'index.html', 'aria-label': 'Computer Science, Thammasat University — หน้าแรก' },
    h('span', { class: 'brand__badge' }, icon('graduation-cap')),
    h('span', { class: 'brand__text' },
      h('span', { class: 'brand__name' }, 'COMPUTER SCIENCE'),
      h('span', { class: 'brand__sub' }, 'THAMMASAT UNIVERSITY')));
}

function navLink(item) {
  return h('a', { href: item.href, 'aria-current': item.href === currentPage() ? 'page' : null }, icon(item.icon), h('span', {}, item.label));
}

export function initLayout() {
  const user = currentUser();
  const roleItems = ROLE_NAV.filter((i) => user && i.roles.some((r) => user.roles.has(r)));

  // ---- header ----
  const toggle = h('button', { class: 'menu-toggle', type: 'button', 'aria-label': 'เปิดเมนู', 'aria-controls': 'site-sidebar', 'aria-expanded': 'false' }, icon('bars'));
  const authSlot = h('div', { class: 'auth-slot' });
  if (user) {
    const roles = [...user.roles].map((r) => ROLE_LABELS[r]).join(', ') || 'ผู้ใช้ทั่วไป';
    authSlot.append(
      h('div', { class: 'auth-user' }, h('strong', {}, user.name || user.email), roles),
      h('button', { type: 'button', class: 'btn btn-ghost-light btn-sm', onclick: logout }, icon('right-from-bracket'), h('span', { class: 'btn__label' }, 'ออกจากระบบ')),
    );
  } else {
    authSlot.append(h('a', { class: 'btn btn-primary btn-sm', href: 'login.html', onclick: () => rememberReturn() }, icon('right-to-bracket'), h('span', { class: 'btn__label' }, 'เข้าสู่ระบบ')));
  }
  // Top bar: public pages only, so it stays on one line; role pages are in the side menu.
  const mainNav = h('nav', { class: 'main-nav', 'aria-label': 'เมนูหลัก' },
    ...NAV.slice(1).map((i) => h('a', { href: i.href, 'aria-current': i.href === currentPage() ? 'page' : null }, i.label)));
  const header = document.getElementById('site-header');
  header.className = 'site-header';
  header.replaceChildren(
    h('a', { class: 'skip-link', href: '#main' }, 'ข้ามไปยังเนื้อหา'),
    h('div', { class: 'container site-header__inner' }, toggle, brand(), mainNav, authSlot),
  );

  // ---- side menu ----
  const backdrop = h('div', { class: 'sidebar-backdrop', hidden: true });
  const closeBtn = h('button', { class: 'sidebar__close', type: 'button', 'aria-label': 'ปิดเมนู' }, icon('xmark'));
  const sidebar = h('nav', { class: 'sidebar', id: 'site-sidebar', 'aria-label': 'เมนูทั้งหมด' },
    h('div', { class: 'sidebar__head' }, h('span', { class: 'brand__badge' }, icon('graduation-cap')),
      h('span', { class: 'brand__text' }, h('span', { class: 'brand__name' }, 'COMPUTER SCIENCE'), h('span', { class: 'brand__sub' }, 'THAMMASAT UNIVERSITY')), closeBtn),
    h('div', { class: 'sidebar__section' }, 'ข้อมูลหลักสูตร'),
    h('div', { class: 'sidebar__nav' }, ...NAV.map(navLink)),
    roleItems.length ? h('div', { class: 'sidebar__section' }, 'สำหรับผู้ใช้ที่เข้าสู่ระบบ') : null,
    roleItems.length ? h('div', { class: 'sidebar__nav' }, ...roleItems.map(navLink)) : null,
    h('div', { class: 'sidebar__foot' }, 'หลักสูตรวิทยาศาสตรบัณฑิต สาขาวิชาวิทยาการคอมพิวเตอร์'));
  // Wrap the side menu and <main> so they sit side by side on wide screens.
  const main = document.getElementById('main');
  if (main) {
    const shell = h('div', { class: 'app-shell' });
    main.before(shell);
    shell.append(sidebar, main);
    document.body.append(backdrop);
  } else {
    document.body.append(backdrop, sidebar);
  }

  const open = () => {
    sidebar.classList.add('is-open');
    backdrop.hidden = false;
    document.body.classList.add('sidebar-open');
    toggle.setAttribute('aria-expanded', 'true');
    closeBtn.focus();
  };
  const close = ({ restoreFocus = true } = {}) => {
    if (!sidebar.classList.contains('is-open')) return;
    sidebar.classList.remove('is-open');
    backdrop.hidden = true;
    document.body.classList.remove('sidebar-open');
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
  };
  // Growing past the drawer breakpoint leaves the menu docked: drop the drawer state.
  const drawerQuery = window.matchMedia('(max-width: 1199.98px)');
  drawerQuery.addEventListener('change', (e) => { if (!e.matches) close({ restoreFocus: false }); });
  toggle.addEventListener('click', open);
  closeBtn.addEventListener('click', () => close());
  backdrop.addEventListener('click', () => close());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && close());

  // ---- footer ----
  const footer = document.getElementById('site-footer');
  if (footer) {
    footer.className = 'site-footer';
    footer.replaceChildren(h('div', { class: 'container footer-grid' },
      h('div', {}, h('h2', {}, 'สาขาวิชาวิทยาการคอมพิวเตอร์'), h('p', {}, 'คณะวิทยาศาสตร์และเทคโนโลยี มหาวิทยาลัยธรรมศาสตร์ ศูนย์รังสิต')),
      h('div', {}, h('h2', {}, 'ติดต่อ'), h('ul', {},
        h('li', {}, icon('location-dot'), '99 หมู่ 18 ต.คลองหนึ่ง อ.คลองหลวง จ.ปทุมธานี 12120'),
        h('li', {}, icon('phone'), '0 2564 4440-79 ต่อ 1676'),
        h('li', {}, icon('envelope'), 'cs@science.tu.ac.th'))),
      h('div', {}, h('h2', {}, 'เวลาทำการ'), h('p', {}, 'จันทร์ – ศุกร์ 08.30 – 16.30 น.'))));
  }
  return user;
}

/** Page guard: shows a sign-in prompt or a "no permission" notice instead of the page body. */
export function guard(main, roles) {
  const user = currentUser();
  if (!user) {
    rememberReturn();
    main.replaceChildren(h('div', { class: 'container' }, h('div', { class: 'card stack gate' },
      h('h1', {}, 'กรุณาเข้าสู่ระบบ'),
      h('p', { class: 'muted' }, 'หน้านี้แสดงข้อมูลเฉพาะบุคคล ต้องเข้าสู่ระบบด้วยบัญชีมหาวิทยาลัยก่อน'),
      h('a', { class: 'btn btn-primary', href: 'login.html' }, icon('right-to-bracket'), h('span', { class: 'btn__label' }, 'เข้าสู่ระบบ')))));
    return false;
  }
  if (!roles.some((r) => user.roles.has(r))) {
    main.replaceChildren(h('div', { class: 'container' }, h('div', { class: 'card stack gate' },
      h('h1', {}, 'ไม่มีสิทธิ์เข้าถึงหน้านี้'),
      h('p', { class: 'muted' }, `หน้านี้สำหรับ ${roles.map((r) => ROLE_LABELS[r]).join(' หรือ ')} เท่านั้น`),
      h('a', { class: 'btn btn-secondary', href: 'index.html' }, 'กลับหน้าแรก'))));
    return false;
  }
  return true;
}
