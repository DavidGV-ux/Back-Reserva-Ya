import { Request } from 'express';
import { ValidationError } from '../../../shared/errors';

export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || !value) {
    throw new ValidationError(`:${name} path param is required`);
  }
  return value;
}