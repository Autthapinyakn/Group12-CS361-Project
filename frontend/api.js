// API client: timeouts, retry with backoff for reads, last-good copy of public data when the API is
// unreachable, and Thai error messages for every status the API returns.
import { CONFIG } from './config.js';
import { authHeaders } from './auth.js';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CACHE_PREFIX = 'cs361.cache.';

async function request(method, path, { body, auth = false, timeout = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const headers = { ...(auth ? authHeaders() : {}) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${CONFIG.apiBaseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) throw new ApiError(res.status, data?.error ?? `http_${res.status}`, data?.message, { ...data?.details, body: data });
    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, err.name === 'AbortError' ? 'timeout' : 'network', String(err.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

const retryable = (err) => err.status === 0 || err.status === 429 || err.status === 502 || err.status === 503 || err.status === 504;

/**
 * GET with up to 2 retries (exponential backoff). With `cacheKey`, a successful answer is kept in
 * localStorage and returned (marked `stale`) when the API cannot be reached, so public pages keep
 * working during an outage. Never used for personal data.
 */
export async function apiGet(path, { auth = false, cacheKey, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const data = await request('GET', path, { auth });
      if (cacheKey) {
        try { localStorage.setItem(CACHE_PREFIX + cacheKey, JSON.stringify({ at: Date.now(), data })); } catch { /* storage full or blocked */ }
      }
      return { data, stale: false };
    } catch (err) {
      lastErr = err;
      if (!retryable(err) || attempt === retries) break;
      await sleep(400 * 2 ** attempt);
    }
  }
  if (cacheKey && retryable(lastErr)) {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_PREFIX + cacheKey) || 'null');
      if (cached) return { data: cached.data, stale: true, cachedAt: cached.at };
    } catch { /* ignore */ }
  }
  throw lastErr;
}

/** Writes are not retried automatically (they are not always safe to repeat). */
export const apiSend = (method, path, body, { auth = true, timeout = 30000 } = {}) => request(method, path, { body, auth, timeout });

/** User-facing Thai message for an API error. */
export function errorMessage(err) {
  if (!(err instanceof ApiError)) return 'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง';
  switch (err.status) {
    case 0: return err.code === 'timeout'
      ? 'ระบบตอบสนองช้าเกินไป กรุณาลองใหม่อีกครั้ง'
      : 'ไม่สามารถเชื่อมต่อระบบได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
    case 401: return 'กรุณาเข้าสู่ระบบอีกครั้ง (เซสชันหมดอายุหรือยังไม่ได้เข้าสู่ระบบ)';
    case 403: return 'บัญชีของคุณไม่มีสิทธิ์ใช้งานส่วนนี้';
    case 404: return 'ไม่พบข้อมูลที่ต้องการ';
    case 409: return err.code === 'version_conflict'
      ? 'มีผู้อื่นแก้ไขข้อมูลนี้ไปก่อนแล้ว กรุณาโหลดข้อมูลล่าสุดแล้วแก้ไขอีกครั้ง'
      : 'ข้อมูลซ้ำกับรายการที่มีอยู่แล้ว';
    case 400: case 422: return `ข้อมูลไม่ถูกต้อง: ${err.message}`;
    case 429: return 'มีผู้ใช้งานจำนวนมากในขณะนี้ กรุณารอสักครู่แล้วลองใหม่';
    case 503: return 'ฐานข้อมูลไม่พร้อมใช้งานชั่วคราว ข้อมูลของคุณไม่ได้สูญหาย กรุณาลองใหม่ภายหลัง';
    default: return 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่ภายหลัง';
  }
}

// Curriculum codes as stored in the database (curricula.code).
export const CURRICULA = [
  { code: 'applied-cs', name: 'คอมพิวเตอร์ประยุกต์', program: 'โครงการพิเศษ' },
  { code: 'cis-cs', name: 'คอมพิวเตอร์และวิทยาการสารสนเทศ', program: 'โครงการปกติ' },
  { code: 'cnc', name: 'คอมพิวเตอร์เครือข่ายและความปลอดภัยทางไซเบอร์', program: 'โครงการพิเศษ' },
];
export const curriculumName = (code) => CURRICULA.find((c) => c.code === code)?.name ?? code;
