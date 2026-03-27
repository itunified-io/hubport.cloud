/**
 * Minimal Keycloak Admin Client for portal user management.
 * Uses client credentials grant against the central-api-admin service account.
 *
 * Env: KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_ADMIN_CLIENT_ID
 * Secret: KEYCLOAK_ADMIN_CLIENT_SECRET (from Vault via ESO)
 */

/** Sanitize a Keycloak path segment: reject path traversal chars. */
function safePath(value: string, name: string): string {
  if (!value || /[\/\\?#]/.test(value)) {
    throw new Error(`Invalid ${name}: contains path-separator or query characters`);
  }
  return encodeURIComponent(value);
}

function getConfig() {
  const url = process.env.KEYCLOAK_URL;
  const realm = process.env.KEYCLOAK_REALM;
  const clientId = process.env.KEYCLOAK_ADMIN_CLIENT_ID;
  const clientSecret = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET;

  if (!url || !realm || !clientId || !clientSecret) {
    throw new Error(
      'Missing Keycloak admin env: KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_ADMIN_CLIENT_ID, KEYCLOAK_ADMIN_CLIENT_SECRET',
    );
  }

  return { url, realm, clientId, clientSecret };
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Obtain admin token via client credentials grant.
 * Caches token until 30s before expiry.
 */
async function getAdminToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const { url, realm, clientId, clientSecret } = getConfig();
  const tokenUrl = `${url}/realms/${realm}/protocol/openid-connect/token`;

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    throw new Error(`Keycloak token error: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 30) * 1000,
  };

  return data.access_token;
}

function adminUrl(): string {
  const { url, realm } = getConfig();
  return `${url}/admin/realms/${realm}`;
}

/**
 * Create a portal user in the central Keycloak realm.
 * Sets emailVerified=true (admin-approved) and UPDATE_PASSWORD required action.
 * Returns the Keycloak user ID.
 */
export async function createPortalUser(
  email: string,
  firstName: string,
  lastName: string,
): Promise<string> {
  const token = await getAdminToken();
  const res = await fetch(`${adminUrl()}/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username: email,
      email,
      firstName,
      lastName,
      enabled: true,
      emailVerified: true,
      requiredActions: ['UPDATE_PASSWORD'],
    }),
  });

  if (res.status === 409) {
    // User already exists — look up by email
    const existing = await findUserByEmail(email);
    if (existing) return existing;
    throw new Error('Keycloak user conflict but not found by email');
  }

  if (!res.ok) {
    throw new Error(`Keycloak create user error: ${res.status} ${await res.text()}`);
  }

  const location = res.headers.get('Location');
  if (!location) throw new Error('No Location header in Keycloak create response');
  return location.split('/').pop()!;
}

/**
 * Find a Keycloak user by email. Returns user ID or null.
 */
async function findUserByEmail(email: string): Promise<string | null> {
  const token = await getAdminToken();
  const res = await fetch(
    `${adminUrl()}/users?email=${encodeURIComponent(email)}&exact=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) return null;
  const users = (await res.json()) as { id: string }[];
  return users.length > 0 ? users[0]!.id : null;
}

/**
 * Delete a portal user from the central Keycloak realm.
 */
export async function deletePortalUser(keycloakUserId: string): Promise<void> {
  const token = await getAdminToken();
  const res = await fetch(
    `${adminUrl()}/users/${safePath(keycloakUserId, 'keycloakUserId')}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (res.status === 404) return; // already deleted
  if (!res.ok) {
    throw new Error(`Keycloak delete user error: ${res.status} ${await res.text()}`);
  }
}
