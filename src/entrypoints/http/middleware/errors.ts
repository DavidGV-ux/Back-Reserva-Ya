import { NextFunction, Request, RequestHandler, Response } from 'express';
import { DomainError } from '../../../shared/errors';

export function asyncRoute(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  // Body-parser / express.json() parse errors: respond 400 generic, no leak.
  const isJsonParseError =
    err instanceof SyntaxError &&
    (err as { status?: number; type?: string }).status === 400 &&
    (err as { type?: string }).type === 'entity.parse.failed';
  if (isJsonParseError) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'invalid JSON body' } });
    return;
  }
  if (err instanceof DomainError) {
    const status = statusFor(err.code);
    res.status(status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }
  // eslint-disable-next-line no-console
  console.error(
    `[http] ${err instanceof Error ? (err.stack || String(err)).slice(0, 900) : String(err)}`,
    serializeErrDetails(err),
  );
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal Server Error' } });
}

function serializeErrDetails(err: unknown): string {
  try {
    const value = (err as { errInfo?: unknown }).errInfo;
    if (value === undefined) return '';
    const seen = new Set<unknown>();
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === 'bigint') return v.toString();
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      return v;
    }).slice(0, 4000);
  } catch {
    return '';
  }
}

function statusFor(code: string): number {
  switch (code) {
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'OCC_CONFLICT':
    case 'AVAILABILITY_CONFLICT':
    case 'APPOINTMENT_CONFLICT':
    case 'PAYMENT_DUPLICATE':
    case 'SLUG_TAKEN':
    case 'TENANT_CONFLICT':
    case 'TENANT_NOT_ACTIVE':
    case 'APPOINTMENT_TERMINAL':
    case 'KEYCLOAK_USER_LINKED':
    case 'PLAN_EXISTS':
    case 'TENANT_ALREADY_HAS_OWNER':
    case 'EMAIL_TAKEN':
      return 409;
    case 'VALIDATION_ERROR':
      return 422;
    case 'CODE_RATE_LIMITED':
      return 429;
    default:
      return 400;
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}