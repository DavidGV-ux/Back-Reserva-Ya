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
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  // eslint-disable-next-line no-console
  console.error(
    `[http] ${err instanceof Error ? (err.stack || String(err)).slice(0, 900) : String(err)}`,
    serializeErrDetails(err),
  );
  res.status(500).json({ error: { code: 'INTERNAL', message } });
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
      return 409;
    case 'VALIDATION_ERROR':
      return 422;
    default:
      return 400;
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
}