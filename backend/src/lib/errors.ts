// Errors that map to an HTTP status. Anything else becomes a 500 (or 503 for database outages).
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (code: string, message?: string, details?: unknown) =>
  new HttpError(400, code, message, details);
export const unauthorized = (message = 'Sign-in required') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Not allowed for this role') => new HttpError(403, 'forbidden', message);
export const notFound = (code = 'not_found', message?: string) => new HttpError(404, code, message);
export const conflict = (code: string, message?: string, details?: unknown) =>
  new HttpError(409, code, message, details);

const DB_UNAVAILABLE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', '57P01', '57P03', '53300']);

/** Translate PostgreSQL / driver errors into HTTP errors the client can act on. */
export function fromDatabaseError(err: unknown): HttpError | null {
  const e = err as { code?: string; message?: string; constraint?: string };
  if (!e || typeof e !== 'object') return null;
  if (e.code === '23505') return conflict('already_exists', 'A record with the same key already exists', { constraint: e.constraint });
  if (e.code === '23503') return badRequest('invalid_reference', 'Referenced record does not exist', { constraint: e.constraint });
  if (e.code === '23514' || e.code === '22P02' || e.code === '22003') {
    return badRequest('invalid_value', 'A value is outside the allowed range', { constraint: e.constraint });
  }
  if (e.code === '57014') return new HttpError(503, 'database_timeout', 'The database took too long to answer');
  if ((e.code && DB_UNAVAILABLE_CODES.has(e.code)) || /timeout exceeded when trying to connect|Connection terminated/i.test(e.message ?? '')) {
    return new HttpError(503, 'database_unavailable', 'The database is temporarily unavailable');
  }
  return null;
}
