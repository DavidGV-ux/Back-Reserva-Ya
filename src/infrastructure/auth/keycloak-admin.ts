import { IdentityGateway, IdentityUser, RealmRole } from '../../domain/ports/gateways';

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

interface KcRole {
  id: string;
  name: string;
}

interface KcUserRep {
  id?: string;
  sub?: string;
  username?: string;
  email?: string;
  enabled?: boolean;
}

/**
 * Adaptador del puerto `IdentityGateway` sobre la Admin REST API de Keycloak.
 * Usa un cliente confidencial con service account y el rol `manage-users`
 * (aprox. realm-management) para gestionar usuarios y roles de la app.
 */
export class KeycloakAdminGateway implements IdentityGateway {
  readonly provider = 'keycloak';

  private readonly baseUrl: string;
  private readonly realm: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(input: {
    baseUrl: string;
    realm: string;
    clientId: string;
    clientSecret: string;
  }) {
    this.baseUrl = input.baseUrl.replace(/\/$/, '');
    this.realm = input.realm;
    this.clientId = input.clientId;
    this.clientSecret = input.clientSecret;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) {
      return this.token.value;
    }
    const url = `${this.baseUrl}/realms/${this.realm}/protocol/openid-connect/token`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `Identity provider token failed (${res.status}) for client ${this.clientId}`,
      );
    }
    const data = (await res.json()) as TokenResponse;
    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return this.token.value;
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const token = await this.accessToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      this.token = null;
    }
    return res;
  }

  private async userPath(sub: string): Promise<string | null> {
    const res = await this.request('GET', `/admin/realms/${this.realm}/users/${encodeURIComponent(sub)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Identity provider user lookup failed (${res.status})`);
    return `/admin/realms/${this.realm}/users/${encodeURIComponent(sub)}`;
  }

  async findBySub(sub: string): Promise<IdentityUser | null> {
    const path = await this.userPath(sub);
    if (!path) return null;
    const user = (await (await this.request('GET', path)).json()) as KcUserRep;
    return {
      sub: String(user.id ?? user.sub ?? sub),
      enabled: Boolean(user.enabled),
      email: user.email,
      username: user.username ?? '',
    };
  }

  async findByEmail(email: string): Promise<IdentityUser | null> {
    const res = await this.request(
      'GET',
      `/admin/realms/${this.realm}/users?email=${encodeURIComponent(email)}&exact=true`,
    );
    if (!res.ok) throw new Error(`Identity provider user search failed (${res.status})`);
    const users = (await res.json()) as KcUserRep[];
    const match = users[0];
    if (!match) return null;
    return {
      sub: String(match.id ?? match.sub ?? ''),
      enabled: Boolean(match.enabled),
      email: match.email,
      username: match.username ?? '',
    };
  }

  async createUser(input: {
    username: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    temporaryPassword: string;
  }): Promise<{ sub: string }> {
    const res = await this.request('POST', `/admin/realms/${this.realm}/users`, {
      username: input.username,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      enabled: true,
      emailVerified: false,
      credentials: [
        {
          type: 'password',
          value: input.temporaryPassword,
          temporary: true,
        },
      ],
    });
    const expected = [201, 200];
    if (!expected.includes(res.status)) {
      throw new Error(`Identity provider user creation failed (${res.status})`);
    }
    const location = res.headers.get('location');
    if (!location) {
      throw new Error('Identity provider did not return a user location');
    }
    return { sub: decodeURIComponent(location.split('/').filter(Boolean).pop() ?? '') };
  }

  async ensureRealmRole(sub: string, role: RealmRole): Promise<void> {
    const path = await this.userPath(sub);
    if (!path) {
      throw new Error(`Identity provider user ${sub} not found`);
    }
    const rolePath = `/admin/realms/${this.realm}/roles/${role}`;
    const roleRes = await this.request('GET', rolePath);
    if (!roleRes.ok) throw new Error(`Identity provider realm role ${role} not found`);
    const roleRep = (await roleRes.json()) as KcRole;

    const gathered = await this.request('GET', `${path}/role-mappings/realm`);
    if (!gathered.ok) throw new Error(`Identity provider role listing failed (${gathered.status})`);
    const current = (await gathered.json()) as KcRole[];
    if (current.some((r) => r.name === role)) return;

    const mapped = await this.request('POST', `${path}/role-mappings/realm`, [roleRep]);
    if (!mapped.ok && mapped.status !== 204) {
      throw new Error(`Identity provider role mapping failed (${mapped.status})`);
    }
  }
}