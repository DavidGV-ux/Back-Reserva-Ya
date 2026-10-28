import { Router } from 'express';
import { AppServices } from '../../../application/container';
import { ConflictError, ValidationError } from '../../../shared/errors';
import { asyncRoute } from '../middleware/errors';
import { z } from 'zod';

/**
 * Registro self-service de clientes (sustituye al formulario por defecto de
 * Keycloak). Crea la cuenta en el proveedor de identidad con la contraseña
 * elegida (persistente) y valida el consentimiento Habeas Data (RF-3.2b).
 */

const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'name too short').max(120, 'name too long'),
    email: z.string().trim().toLowerCase().email('invalid email'),
    password: z.string().min(8, 'password too short').max(72, 'password too long'),
    confirmPassword: z.string(),
    habeasDataConsent: z.literal(true),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'passwords do not match',
    path: ['confirmPassword'],
  });

/** Rate limit ligero en memoria (defensa básica contra spam en un endpoint público). */
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT = 20; // intentos por IP por ventana
const attempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = attempts.get(ip);
  if (!record || record.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  record.count += 1;
  return record.count > RATE_LIMIT;
}

export function authRouter(services: AppServices): Router {
  const router = Router();

  router.post(
    '/register',
    asyncRoute(async (req, res) => {
      const ip = req.ip ?? 'unknown';
      if (isRateLimited(ip)) {
        res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'too many attempts' } });
        return;
      }

      const parsed = registerSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ValidationError('invalid registration payload', {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      const { name, email, password } = parsed.data;

      const existing = await services.identity.findByEmail(email);
      if (existing) {
        throw new ConflictError('EMAIL_TAKEN', 'email is already registered');
      }

      const nameParts = name.split(/\s+/);
      const created = await services.identity.createUser({
        username: email,
        email,
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(' '),
        temporaryPassword: password,
        persistentPassword: true,
      });

      res.status(201).json({ ok: true, sub: created.sub });
    }),
  );

  return router;
}