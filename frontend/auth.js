// Sign-in with Amazon Cognito Hosted UI (authorization code + PKCE). The ID token is kept in
// sessionStorage for this tab only and sent as a Bearer token; API Gateway verifies it.
// Hiding pages in the browser is only for usability: the API checks the role on every request.
import { CONFIG } from './config.js';

const TOKEN_KEY = 'cs361.session';
const VERIFIER_KEY = 'cs361.pkce';
const STATE_KEY = 'cs361.state';
const RETURN_KEY = 'cs361.return';

export const ROLES = ['student', 'instructor', 'staff', 'coordinator'];
export const ROLE_LABELS = {
  student: 'นักศึกษา',
  instructor: 'อาจารย์',
  staff: 'เจ้าหน้าที่',
  coordinator: 'ผู้ดูแลหลักสูตร',
};

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = (text) => b64url(new TextEncoder().encode(text));

function randomString(n = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  return Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => chars[b % chars.length]).join('');
}

/** Decode the JWT payload as UTF-8 (names can be Thai). The signature is checked by API Gateway, not here. */
export function decodeJwt(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64 + '==='.slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

export function getSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
    if (!s?.idToken) return null;
    if (s.expiresAt < Date.now()) {
      sessionStorage.removeItem(TOKEN_KEY); // expired: behave as signed out
      return null;
    }
    return { ...s, claims: decodeJwt(s.idToken) };
  } catch {
    return null;
  }
}

/** All roles of the signed-in user (a person may belong to several Cognito groups). */
export function getRoles() {
  const claims = getSession()?.claims;
  if (!claims) return new Set();
  let groups = claims['cognito:groups'] ?? [];
  if (typeof groups === 'string') groups = groups.replace(/^\[|\]$/g, '').split(/[\s,]+/);
  return new Set(groups.filter((g) => ROLES.includes(g)));
}

export const hasRole = (...roles) => {
  const mine = getRoles();
  return roles.some((r) => mine.has(r));
};

export function currentUser() {
  const s = getSession();
  if (!s) return null;
  return { email: s.claims.email ?? '', name: s.claims.name ?? s.claims.email ?? '', roles: getRoles() };
}

export function authHeaders() {
  const s = getSession();
  return s ? { Authorization: `Bearer ${s.idToken}` } : {};
}

const cognitoReady = () =>
  CONFIG.authMode === 'cognito' && !CONFIG.cognito.domain.startsWith('YOUR_') && !CONFIG.cognito.clientId.startsWith('YOUR_');

export const isDevAuth = () => CONFIG.authMode === 'dev';

export async function login() {
  if (isDevAuth()) {
    window.location.assign('login.html');
    return;
  }
  if (!cognitoReady()) throw new Error('ยังไม่ได้ตั้งค่า Cognito ใน config.js');
  if (!window.isSecureContext) throw new Error('การเข้าสู่ระบบต้องเปิดเว็บผ่าน HTTPS');
  const verifier = randomString(64);
  const state = randomString(32);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  const url = new URL(`https://${CONFIG.cognito.domain}/oauth2/authorize`);
  url.search = new URLSearchParams({
    client_id: CONFIG.cognito.clientId,
    response_type: 'code',
    scope: CONFIG.cognito.scopes.join(' '),
    redirect_uri: CONFIG.cognito.redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  window.location.assign(url.toString());
}

/** Local development only: an unsigned token that the local dev server accepts and AWS rejects. */
export function devLogin({ email, name, roles }) {
  if (!isDevAuth()) throw new Error('dev sign-in is only available on localhost');
  const claims = { sub: `dev-${email}`, email, email_verified: true, name, token_use: 'id', 'cognito:groups': roles };
  const token = `${b64urlText('{"alg":"none"}')}.${b64urlText(JSON.stringify(claims))}.dev`;
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ idToken: token, expiresAt: Date.now() + 8 * 3600 * 1000 }));
}

/** Completes the Hosted UI redirect. Returns true when a sign-in just finished. */
export async function handleCallback() {
  const url = new URL(window.location.href);
  const error = url.searchParams.get('error');
  if (error) throw new Error(url.searchParams.get('error_description') || error);
  const code = url.searchParams.get('code');
  if (!code || CONFIG.authMode !== 'cognito') return false;
  if (url.searchParams.get('state') !== sessionStorage.getItem(STATE_KEY)) {
    throw new Error('ตรวจสอบ OAuth state ไม่ผ่าน กรุณาเข้าสู่ระบบใหม่');
  }
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) throw new Error('ไม่พบ PKCE verifier กรุณาเข้าสู่ระบบใหม่');
  const response = await fetch(`https://${CONFIG.cognito.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CONFIG.cognito.clientId,
      code,
      redirect_uri: CONFIG.cognito.redirectUri,
      code_verifier: verifier,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || 'เข้าสู่ระบบไม่สำเร็จ');
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify({
    idToken: data.id_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  }));
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  history.replaceState({}, document.title, window.location.pathname);
  return true;
}

export function logout() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  if (cognitoReady()) {
    const u = new URL(`https://${CONFIG.cognito.domain}/logout`);
    u.search = new URLSearchParams({ client_id: CONFIG.cognito.clientId, logout_uri: CONFIG.cognito.logoutUri }).toString();
    window.location.assign(u.toString());
  } else {
    window.location.assign('login.html');
  }
}

/** Remember where to come back after signing in. */
export function rememberReturn(page = window.location.pathname.split('/').pop() || 'index.html') {
  sessionStorage.setItem(RETURN_KEY, page);
}
export function takeReturn() {
  const v = sessionStorage.getItem(RETURN_KEY);
  sessionStorage.removeItem(RETURN_KEY);
  return v && /^[a-z-]+\.html$/.test(v) ? v : null;
}

/** Default landing page for a set of roles. */
export function homeFor(roles) {
  if (roles.has('student')) return 'graduation-requirements.html';
  if (roles.has('staff') || roles.has('instructor')) return 'graduation-status.html';
  if (roles.has('coordinator')) return 'curriculum-edit.html';
  return 'index.html';
}
