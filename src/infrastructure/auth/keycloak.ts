import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { UnauthorizedError } from '../../shared/errors';

export interface Principal {
  sub: string;
  preferredUsername?: string;
  name?: string;
  email?: string;
  roles: string[];
  raw: JWTPayload;
}

export class KeycloakVerifier {
  private readonly jwks;
  private readonly issuer: string;
  private ready = false;

  constructor(issuer: string, private readonly audience?: string) {
    this.issuer = issuer;
    const url = new URL(`${issuer.replace(/\/$/, '')}/protocol/openid-connect/certs`);
    this.jwks = createRemoteJWKSet(url);
  }

  async verify(token: string): Promise<Principal> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        ...(this.audience ? { audience: this.audience } : {}),
        algorithms: ['RS256'],
      });
      this.ready = true;
      const roles = extractRoles(payload);
      return {
        sub: String(payload.sub ?? ''),
        preferredUsername: payload.preferred_username as string | undefined,
        name: payload.name as string | undefined,
        email: payload.email as string | undefined,
        roles,
        raw: payload,
      };
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
  }

  isReady(): boolean {
    return this.ready;
  }
}

function extractRoles(payload: JWTPayload): string[] {
  const roles: string[] = [];
  const realmAccess = payload.realm_access as { roles?: string[] } | undefined;
  if (Array.isArray(realmAccess?.roles)) roles.push(...realmAccess.roles);
  if (Array.isArray(payload.roles)) roles.push(...(payload.roles as string[]));
  if (Array.isArray(payload.realm_roles)) roles.push(...(payload.realm_roles as string[]));
  return [...new Set(roles)];
}