import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { AppServices } from '../../../application/container';
import { ConflictError, ValidationError } from '../../../shared/errors';
import { asyncRoute } from '../middleware/errors';
import { z } from 'zod';

/**
 * Registro self-service de clientes.
 *
 * FLUJO (sin guardar nada hasta verificar WhatsApp):
 * 1. POST /register  -> valida datos, genera código 6 dígitos, guarda en
 *    pending_registrations (TTL 30 min). NO crea usuario en Keycloak.
 *    El código se envía SOLO por WhatsApp; la respuesta no lo incluye.
 * 2. Usuario envía el código desde su WhatsApp al bot de ReservaYa.
 *    El webhook valida el código y marca el pending como verificado.
 * 3. POST /verify-phone -> solo finaliza el registro ya verificado por el bot,
 *    creando el usuario en Keycloak + user_profiles.
 */
const registerSchema = z
  .object({
    firstName: z.string().trim().min(2, 'first name too short').max(60, 'first name too long').refine((v) => !/\d/.test(v), 'first name must not contain digits').refine((v) => !/[<>]/.test(v) && !/<[a-z]/i.test(v), 'first name must not contain HTML'),
    lastName: z.string().trim().min(2, 'last name too short').max(60, 'last name too long').refine((v) => !/\d/.test(v), 'last name must not contain digits').refine((v) => !/[<>]/.test(v) && !/<[a-z]/i.test(v), 'last name must not contain HTML'),
    email: z.string().trim().toLowerCase().email('invalid email').max(254, 'email too long'),
    phone: z.string().trim().min(7, 'phone too short').max(20, 'phone too long').regex(/^[+\d\s()-]{7,20}$/, 'phone must contain only digits'),
    city: z.string().trim().max(80, 'city too long').optional().refine((v) => !v || !/\d/.test(v), 'city must not contain digits').refine((v) => !v || (!/[<>]/.test(v) && !/<[a-z]/i.test(v)), 'city must not contain HTML'),
    password: z.string().min(8, 'password too short').max(72, 'password too long').refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), 'password must contain letters and digits'),
    confirmPassword: z.string(),
    habeasDataConsent: z.literal(true),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'passwords do not match',
    path: ['confirmPassword'],
  });

const verifyPhoneSchema = z.object({
  id: z.string().min(1),
});

const resendCodeSchema = z.object({
  id: z.string().min(1),
  phone: z.string().optional(),
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

  // --- Paso 1: Registro (sin crear usuario hasta verificar WhatsApp) ---
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
      const { firstName, lastName, email, phone, city, password } = parsed.data;

      const emailLower = email.toLowerCase().trim();

      // Email ya registrado en Keycloak.
      const existing = await services.identity.findByEmail(emailLower);
      if (existing) {
        throw new ConflictError('EMAIL_TAKEN', 'email is already registered');
      }

      // Teléfono ya verificado en user_profiles.
      const existingPhone = await services.profile.findByPhone(phone);
      if (existingPhone?.phoneVerified) {
        throw new ConflictError('PHONE_TAKEN', 'phone is already registered');
      }

      // Generar código y guardar en pending_registrations (no se crea usuario aún).
      const result = await services.profile.requestCode({
        email: emailLower,
        phone,
        city: city ?? '',
        firstName,
        lastName,
        password,
      });

      // Reanudación de un registro ya verificado por WhatsApp pero no completado
      // (el usuario volvió a registrarse porque la página estaba atascada):
      // completar de una vez para no dejarlo en el paso de código.
      if (result.alreadyVerified) {
        const { keycloakUserId } = await services.profile.completeRegistration({
          id: result.id,
          identity: {
            createUser: (input) => services.identity.createUser(input),
          },
        });
        res.status(201).json({ ok: true, id: result.id, completed: true, keycloakUserId });
        return;
      }

      res.status(201).json({ ok: true, id: result.id });
    }),
  );

  // --- Paso 3: Verificar código y completar el registro ---
  router.post(
    '/verify-phone',
    asyncRoute(async (req, res) => {
      const parsed = verifyPhoneSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ValidationError('invalid verification payload', {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }

      // Solo finaliza un registro ya marcado phoneVerified por el webhook del bot.
      // completeRegistration rechaza cualquier pending no verificado.
      const { keycloakUserId } = await services.profile.completeRegistration({
        id: parsed.data.id,
        identity: {
          createUser: (input) => services.identity.createUser(input),
        },
      });

      res.json({ ok: true, keycloakUserId });
    }),
  );

  // --- Estado de verificación (polling desde el frontend) ---
  router.get(
    '/verify-status/:id',
    asyncRoute(async (req, res) => {
      const idParam = req.params.id;
      const id = typeof idParam === 'string' ? idParam : String(idParam ?? '');
      const registration = await services.profile.getPendingById(id);
      if (!registration) {
        // El registro pendiente ya expiró o el id no existe. No se puede
        // asumir que la cuenta fue creada: el frontend debe reiniciar el flujo.
        res.json({ ok: true, completed: false, verified: false, expired: true });
        return;
      }
      const phoneVerified = registration.phoneVerified === true;
      const completed = Boolean(registration.completedAt);
      // Código expirado sin verificar: el frontend debe dejar de esperar y
      // ofrecer reenviar el código o corregir el número.
      const codeExpired =
        !phoneVerified &&
        !completed &&
        Boolean(registration.codeExpiresAt) &&
        new Date(registration.codeExpiresAt).getTime() < Date.now();
      res.json({
        ok: true,
        completed,
        verified: phoneVerified,
        expired: false,
        codeExpired,
      });
    }),
  );

  // --- Reenviar código para registro pendiente ---
  router.post(
    '/resend-code',
    asyncRoute(async (req, res) => {
      const parsed = resendCodeSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ValidationError('invalid resend payload', {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      const result = await services.profile.resendCode({
        id: parsed.data.id,
        phone: parsed.data.phone,
      });
      res.json({ ok: true, id: result.id, retryAfterSeconds: result.retryAfterSeconds });
    }),
  );

  return router;
}
