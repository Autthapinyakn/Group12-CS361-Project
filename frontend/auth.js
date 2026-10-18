import { COGNITO_CONFIG } from './auth-config.js';

const TOKEN_KEY = 'cs361.cognito.tokens';
const VERIFIER_KEY = 'cs361.cognito.pkce';
const STATE_KEY = 'cs361.cognito.state';
const configured = () => !COGNITO_CONFIG.domain.startsWith('YOUR_') && !COGNITO_CONFIG.clientId.startsWith('YOUR_');
const base = () => `https://${COGNITO_CONFIG.domain}`;
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const randomString = (n=64) => { const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'; const bytes=crypto.getRandomValues(new Uint8Array(n)); return Array.from(bytes, b => chars[b % chars.length]).join(''); };
async function challenge(verifier) { return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))); }
function decodeJwt(token) { try { return JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); } catch { return {}; } }
export function getSession() {
  try { const s=JSON.parse(sessionStorage.getItem(TOKEN_KEY)||'null'); if (!s || !s.idToken || s.expiresAt < Date.now()) return null; return {...s, claims:decodeJwt(s.idToken)}; } catch { return null; }
}
export function getRole() {
  const c=getSession()?.claims; if (!c) return 'guest';
  const groups=Array.isArray(c['cognito:groups'])?c['cognito:groups']:[];
  const role=String(c['custom:role'] || c.role || groups[0] || 'unknown').toLowerCase();
  if (role.includes('coordinator')) return 'coordinator';
  if (role.includes('instructor') || role.includes('teacher') || role.includes('lecturer')) return 'instructor';
  if (role.includes('student')) return 'student';
  return 'unknown';
}
export function authHeaders() { const s=getSession(); return s ? { Authorization: `Bearer ${s.idToken}` } : {}; }
export async function login() {
  if (!configured()) { alert('Cognito ยังไม่ได้ตั้งค่า กรุณาแก้ค่าใน frontend/auth-config.js ก่อน'); return; }
  const verifier=randomString(64), state=randomString(32), hash=await challenge(verifier);
  sessionStorage.setItem(VERIFIER_KEY,verifier); sessionStorage.setItem(STATE_KEY,state);
  const url=new URL(`${base()}/oauth2/authorize`);
  url.searchParams.set('client_id',COGNITO_CONFIG.clientId); url.searchParams.set('response_type','code');
  url.searchParams.set('scope',COGNITO_CONFIG.scopes.join(' ')); url.searchParams.set('redirect_uri',COGNITO_CONFIG.redirectUri);
  url.searchParams.set('state',state); url.searchParams.set('code_challenge',hash); url.searchParams.set('code_challenge_method','S256');
  window.location.assign(url.toString());
}
export async function handleCallback() {
  const url=new URL(window.location.href), code=url.searchParams.get('code'), state=url.searchParams.get('state');
  if (!code) return false;
  if (!configured()) throw new Error('Cognito ยังไม่ได้ตั้งค่าใน auth-config.js');
  if (!state || state !== sessionStorage.getItem(STATE_KEY)) throw new Error('ตรวจสอบ OAuth state ไม่ผ่าน กรุณาเริ่มเข้าสู่ระบบใหม่');
  const verifier=sessionStorage.getItem(VERIFIER_KEY); if (!verifier) throw new Error('ไม่พบ PKCE verifier กรุณาเข้าสู่ระบบใหม่');
  const response=await fetch(`${base()}/oauth2/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:COGNITO_CONFIG.clientId,code,redirect_uri:COGNITO_CONFIG.redirectUri,code_verifier:verifier})});
  const data=await response.json(); if (!response.ok) throw new Error(data.error_description||data.error||'เข้าสู่ระบบไม่สำเร็จ');
  sessionStorage.setItem(TOKEN_KEY,JSON.stringify({idToken:data.id_token,accessToken:data.access_token,expiresAt:Date.now()+(Number(data.expires_in||3600)*1000)}));
  sessionStorage.removeItem(VERIFIER_KEY); sessionStorage.removeItem(STATE_KEY); history.replaceState({},document.title,window.location.pathname); return true;
}
export function logout() {
  sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(VERIFIER_KEY); sessionStorage.removeItem(STATE_KEY);
  if (configured()) { const u=new URL(`${base()}/logout`); u.searchParams.set('client_id',COGNITO_CONFIG.clientId); u.searchParams.set('logout_uri',COGNITO_CONFIG.logoutUri); window.location.assign(u.toString()); }
  else window.location.assign('login.html');
}
export function requireRole(roles) { const role=getRole(); if (!roles.includes(role)) { const target=role==='guest'?'login.html':'courses.html'; window.location.replace(target); return false; } return true; }
export function applyRoleNavigation() {
  const role=getRole(); document.querySelectorAll('[data-roles]').forEach(el=>{const allowed=(el.dataset.roles||'').split(',').map(x=>x.trim()); el.hidden=!allowed.includes(role);});
  const slot=document.querySelector('[data-auth-slot]'); if(slot){ slot.innerHTML=''; const s=getSession(); if(s){ const who=document.createElement('span'); who.className='auth-user-label'; who.textContent=({student:'นักศึกษา',instructor:'อาจารย์',coordinator:'ผู้ประสานงาน'})[role]||role; const b=document.createElement('button'); b.className='auth-button'; b.type='button'; b.textContent='ออกจากระบบ'; b.addEventListener('click',logout); slot.append(who,b); } else { const a=document.createElement('a'); a.className='auth-button'; a.href='login.html'; a.textContent='เข้าสู่ระบบ'; slot.append(a); } }
}
