import { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../../../shared/errors';
import { KeycloakVerifier } from '../../../infrastructure/auth/keycloak';
import { AppServices } from '../../../application/container';

declare global {
  namespace Express {
    interface Request {
      principal?: import('../../../infrastructure/auth/keycloak').Principal;
      tenantId?: string;
    }
  }
}

export function requireAuth(verifier: KeycloakVerifier) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) {
        throw new UnauthorizedError('Bearer token required');
      }
      req.principal = await verifier.verify(header.slice(7));
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Verifica el Bearer token si viene presente, pero nunca rechaza la petición:
 * las rutas públicas siguen funcionando para usuarios anónimos (reserva web),
 * y si el token acompaña, se atribuye la acción al principal autenticado.
 */
export function optionalAuth(verifier: KeycloakVerifier) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        req.principal = await verifier.verify(header.slice(7));
      } catch {
        req.principal = undefined;
      }
    }
    next();
  };
}

export function requireTenantHeader(req: Request, _res: Response, next: NextFunction): void {
  const tenantId = req.headers['x-tenant-id'];
  if (typeof tenantId !== 'string' || !tenantId) {
    next(new ForbiddenError('x-tenant-id header is required'));
    return;
  }
  req.tenantId = tenantId;
  next();
}

export function requireTenantMembership(services: AppServices, roles: Array<'owner' | 'professional' | 'client'>) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.principal || !req.tenantId) throw new ForbiddenError();
      await services.tenants.assertTenantMembership({
        tenantId: req.tenantId,
        keycloakUserId: req.principal.sub,
        roles,
      });
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requirePlatformAdmin(services: AppServices) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.principal) throw new UnauthorizedError();
      await services.tenants.assertPlatformAdmin({ keycloakUserId: req.principal.sub });
      next();
    } catch (err) {
      next(err);
    }
  };
}