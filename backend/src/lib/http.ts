import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { badRequest } from './errors';

export type ApiEvent = APIGatewayProxyEventV2WithJWTAuthorizer;
export type ApiResult = APIGatewayProxyStructuredResultV2;

// Comma-separated list, e.g. "https://my-bucket.s3.us-east-1.amazonaws.com,http://localhost:3001".
// API Gateway's own CORS settings normally answer preflights; these headers cover the Lambda responses.
function allowedOrigin(event: ApiEvent): string | undefined {
  const origin = event.headers?.origin ?? event.headers?.Origin;
  const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin) return undefined;
  return allowed.includes(origin) ? origin : undefined;
}

export function json(event: ApiEvent, statusCode: number, body: unknown, options: { private?: boolean } = {}): ApiResult {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' };
  const origin = allowedOrigin(event);
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  // Personal data (graduation results, admin views) must never be stored by browsers or proxies.
  if (options.private) headers['Cache-Control'] = 'no-store';
  return { statusCode, headers, body: JSON.stringify(body) };
}

export function readJsonBody<T = Record<string, unknown>>(event: ApiEvent): T {
  if (!event.body) throw badRequest('missing_body', 'Request body is required');
  const text = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as T;
  } catch {
    throw badRequest('invalid_json', 'Request body must be a JSON object');
  }
}

export const query = (event: ApiEvent, name: string): string | undefined => {
  const v = event.queryStringParameters?.[name];
  return v === undefined || v === '' ? undefined : v;
};

// ---- small validators shared by the handlers ----
export function requireString(value: unknown, field: string, { max = 255, min = 1 } = {}): string {
  if (typeof value !== 'string') throw badRequest('invalid_field', `${field} must be text`, { field });
  const v = value.trim();
  if (v.length < min || v.length > max) {
    throw badRequest('invalid_field', `${field} must be ${min}-${max} characters`, { field });
  }
  return v;
}

export function optionalString(value: unknown, field: string, opts?: { max?: number }): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireString(value, field, opts);
}

export function requireInt(value: unknown, field: string, min: number, max: number): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw badRequest('invalid_field', `${field} must be an integer between ${min} and ${max}`, { field });
  }
  return n;
}

export function requireNumber(value: unknown, field: string, min: number, max: number): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) {
    throw badRequest('invalid_field', `${field} must be a number between ${min} and ${max}`, { field });
  }
  return n;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function optionalEmail(value: unknown, field: string): string | null {
  const v = optionalString(value, field);
  if (v === null) return null;
  if (!EMAIL_RE.test(v)) throw badRequest('invalid_field', `${field} must be an email address`, { field });
  return v.toLowerCase();
}

export const isEmail = (v: string) => EMAIL_RE.test(v);
