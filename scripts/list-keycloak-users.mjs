/**
 * ReservaYa — Lista usuarios del realm de Keycloak (solo lectura)
 * para revisar el alcance antes de la limpieza.
 */
import 'dotenv/config';

const issuer = process.env.OIDC_ISSUER ?? '';
const base = process.env.OIDC_ADMIN_BASE_URL ?? issuer.replace(/\/realms\/.*$/, '');
const realm = (issuer.split('/realms/')[1] ?? 'reserwaya').replace(/\/$/, '');

const res = await fetch(`${base}/realms/${realm}/protocol/openid-connect/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.OIDC_ADMIN_CLIENT_ID ?? '',
    client_secret: process.env.OIDC_ADMIN_CLIENT_SECRET ?? '',
  }),
});
if (!res.ok) throw new Error(`token failed ${res.status}`);
const { access_token } = await res.json();

const auth = { Authorization: `Bearer ${access_token}` };

const usersRes = await fetch(`${base}/admin/realms/${realm}/users?max=100`, { headers: auth });
const users = await usersRes.json();

console.log(`Total usuarios en realm "${realm}": ${users.length}\n`);
for (const u of users) {
  const isServiceAccount = Boolean(u.serviceAccountClientId);
  const rolesRes = await fetch(`${base}/admin/realms/${realm}/users/${u.id}/role-mappings`, { headers: auth });
  const rolesJson = rolesRes.ok ? await rolesRes.json() : [];
  const roles = Array.isArray(rolesJson) ? rolesJson.map((r) => r.name ?? r.id) : [];
  console.log(
    `- id=${u.id} email=${u.email ?? '-'} username=${u.username ?? '-'} enabled=${u.enabled}` +
      `${isServiceAccount ? ` SERVICE_ACCOUNT(${u.serviceAccountClientId})` : ''} roles=[${roles.join(', ')}]`,
  );
}

// Roles del realm
const realmRolesRes = await fetch(`${base}/admin/realms/${realm}/roles`, { headers: auth });
if (realmRolesRes.ok) {
  const realmRoles = await realmRolesRes.json();
  console.log('\nRoles del realm:', realmRoles.map((r) => r.name).join(', '));
}

// Grupos
const groupsRes = await fetch(`${base}/admin/realms/${realm}/groups`, { headers: auth });
if (groupsRes.ok) {
  const groups = await groupsRes.json();
  console.log('Groups:', groups.length ? groups.map((g) => g.name).join(', ') : '(ninguno)');
}
