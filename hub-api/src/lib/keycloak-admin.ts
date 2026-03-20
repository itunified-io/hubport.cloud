/**
 * Keycloak Admin Client — service account operations.
 *
 * Uses client credentials grant to obtain admin token,
 * then manages users via Keycloak Admin REST API.
 *
 * Env: KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_ADMIN_CLIENT_ID, KEYCLOAK_ADMIN_CLIENT_SECRET
 */

interface KeycloakUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  emailVerified: boolean;
  createdTimestamp: number;
  requiredActions: string[];
}

function getConfig() {
  const url = process.env.KEYCLOAK_URL;
  const realm = process.env.KEYCLOAK_REALM;
  const clientId = process.env.KEYCLOAK_ADMIN_CLIENT_ID;
  const clientSecret = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET;

  if (!url || !realm || !clientId || !clientSecret) {
    throw new Error(
      "Missing Keycloak admin env: KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_ADMIN_CLIENT_ID, KEYCLOAK_ADMIN_CLIENT_SECRET",
    );
  }

  return { url, realm, clientId, clientSecret };
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Obtain admin token via client credentials grant.
 * Caches token until 30s before expiry.
 */
export async function getAdminToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const { url, realm, clientId, clientSecret } = getConfig();
  const tokenUrl = `${url}/realms/${realm}/protocol/openid-connect/token`;

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
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
 * List all Keycloak users in the realm.
 */
export async function listKeycloakUsers(): Promise<KeycloakUser[]> {
  const token = await getAdminToken();
  const res = await fetch(`${adminUrl()}/users?max=1000`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Keycloak list users error: ${res.status}`);
  }

  return res.json() as Promise<KeycloakUser[]>;
}

/**
 * Get a single Keycloak user by ID.
 */
export async function getKeycloakUser(userId: string): Promise<KeycloakUser> {
  const token = await getAdminToken();
  const res = await fetch(`${adminUrl()}/users/${userId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Keycloak get user error: ${res.status}`);
  }

  return res.json() as Promise<KeycloakUser>;
}

/**
 * Create a new Keycloak user.
 * Returns the user ID from the Location header.
 */
export async function createKeycloakUser(
  email: string,
  firstName: string,
  lastName: string,
): Promise<string> {
  const token = await getAdminToken();
  const res = await fetch(`${adminUrl()}/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: email,
      email,
      firstName,
      lastName,
      enabled: true,
      emailVerified: false,
      requiredActions: ["CONFIGURE_TOTP", "UPDATE_PASSWORD"],
    }),
  });

  if (!res.ok) {
    throw new Error(`Keycloak create user error: ${res.status} ${await res.text()}`);
  }

  // Extract user ID from Location header
  const location = res.headers.get("Location");
  if (!location) throw new Error("No Location header in Keycloak create response");
  return location.split("/").pop()!;
}

/**
 * Assign a realm role to a Keycloak user.
 */
export async function assignKeycloakRole(
  userId: string,
  roleName: string,
): Promise<void> {
  const token = await getAdminToken();

  // First get the role representation
  const roleRes = await fetch(`${adminUrl()}/roles/${roleName}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!roleRes.ok) {
    throw new Error(`Keycloak role lookup error: ${roleRes.status}`);
  }
  const role = await roleRes.json();

  // Assign role to user
  const res = await fetch(
    `${adminUrl()}/users/${userId}/role-mappings/realm`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([role]),
    },
  );

  if (!res.ok) {
    throw new Error(`Keycloak assign role error: ${res.status}`);
  }
}

/**
 * Disable a Keycloak user (set enabled=false).
 */
export async function disableKeycloakUser(userId: string): Promise<void> {
  const token = await getAdminToken();
  const res = await fetch(`${adminUrl()}/users/${userId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ enabled: false }),
  });

  if (!res.ok) {
    throw new Error(`Keycloak disable user error: ${res.status}`);
  }
}

/**
 * Enable a Keycloak user (set enabled=true).
 */
export async function enableKeycloakUser(userId: string): Promise<void> {
  const token = await getAdminToken();
  const res = await fetch(`${adminUrl()}/users/${userId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ enabled: true }),
  });

  if (!res.ok) {
    throw new Error(`Keycloak enable user error: ${res.status}`);
  }
}

/**
 * Delete a Keycloak user permanently.
 */
export async function deleteKeycloakUser(userId: string): Promise<void> {
  const token = await getAdminToken();
  const res = await fetch(`${adminUrl()}/users/${userId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Keycloak delete user error: ${res.status}`);
  }
}

/**
 * Logout all sessions for a Keycloak user.
 */
export async function logoutKeycloakUser(userId: string): Promise<void> {
  const token = await getAdminToken();
  const res = await fetch(`${adminUrl()}/users/${userId}/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok && res.status !== 204) {
    throw new Error(`Keycloak logout error: ${res.status}`);
  }
}
