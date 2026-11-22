/**
 * ReservaYa — Configura la política de contraseñas del realm en Keycloak (H-A02).
 *   cd Codigo/Back && node scripts/set-keycloak-password-policy.mjs
 */
import 'dotenv/config';
const issuer = process.env.OIDC_ISSUER ?? '';
const base = process.env.OIDC_ADMIN_BASE_URL ?? issuer.replace(/\/realms\/.*$/, '');
const realm = (issuer.split('/realms/')[1] ?? 'reserwaya').replace(/\/$/, '');

const tokenRes = await fetch(`${base}/realms/${realm}/protocol/openid-connect/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.OIDC_ADMIN_CLIENT_ID ?? '',
    client_secret: process.env.OIDC_ADMIN_CLIENT_SECRET ?? '',
  }),
});
if (!tokenRes.ok) throw new Error(`token failed ${tokenRes.status}`);
const { access_token } = await tokenRes.json();
const headers = { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' };

// Leer el realm actual
const realmRes = await fetch(`${base}/admin/realms/${realm}`, { headers });
if (!realmRes.ok) throw new Error(`get realm failed ${realmRes.status}`);
const realmData = await realmRes.json();

const policy = 'length(8) and digits(1) and lowerCase(1) and upperCase(1) and specialChars(1) and notUsername and passwordHistory(3)';
realmData.passwordPolicy = policy;

const putRes = await fetch(`${base}/admin/realms/${realm}`, {
  method: 'PUT',
  headers,
  body: JSON.stringify(realmData),
});
console.log('PUT realm status:', putRes.status);
if (!putRes.ok) console.log(await putRes.text());

// Verificar
const verifyRes = await fetch(`${base}/admin/realms/${realm}`, { headers });
const verify = await verifyRes.json();
console.log('passwordPolicy actual:', verify.passwordPolicy);
