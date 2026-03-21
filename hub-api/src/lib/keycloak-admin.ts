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

// ─── Credential Management (ADR-0077) ───────────────────────────────

export interface KeycloakCredential {
  id: string;
  type: string; // "password" | "otp" | "webauthn"
  userLabel?: string;
  createdDate?: number;
  credentialData?: string;
}

export interface KeycloakSession {
  id: string;
  ipAddress: string;
  start: number;
  lastAccess: number;
  clients: Record<string, string>;
}

/**
 * Get all credentials for a user.
 */
export async function getUserCredentials(
  userId: string,
): Promise<KeycloakCredential[]> {
  const token = await getAdminToken();
  const res = await fetch(`${adminUrl()}/users/${userId}/credentials`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Keycloak get credentials error: ${res.status}`);
  return res.json() as Promise<KeycloakCredential[]>;
}

/**
 * Remove a specific credential by ID.
 */
export async function removeCredential(
  userId: string,
  credentialId: string,
): Promise<void> {
  const token = await getAdminToken();
  const res = await fetch(
    `${adminUrl()}/users/${userId}/credentials/${credentialId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) throw new Error(`Keycloak remove credential error: ${res.status}`);
}

/**
 * Reset user password via Admin API.
 */
export async function resetPassword(
  userId: string,
  newPassword: string,
  temporary: boolean = false,
): Promise<void> {
  const token = await getAdminToken();
  const res = await fetch(`${adminUrl()}/users/${userId}/reset-password`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "password", value: newPassword, temporary }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Keycloak reset password error: ${res.status} — ${body}`);
  }
}

/**
 * Get all active sessions for a user.
 */
export async function getUserSessions(
  userId: string,
): Promise<KeycloakSession[]> {
  const token = await getAdminToken();
  const res = await fetch(`${adminUrl()}/users/${userId}/sessions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Keycloak get sessions error: ${res.status}`);
  return res.json() as Promise<KeycloakSession[]>;
}

/**
 * Revoke a specific session by ID.
 */
export async function revokeSession(sessionId: string): Promise<void> {
  const { url, realm } = getConfig();
  const token = await getAdminToken();
  const res = await fetch(
    `${url}/admin/realms/${realm}/sessions/${sessionId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) throw new Error(`Keycloak revoke session error: ${res.status}`);
}

/**
 * Update user requiredActions.
 */
export async function updateRequiredActions(
  userId: string,
  actions: string[],
): Promise<void> {
  const token = await getAdminToken();
  const res = await fetch(`${adminUrl()}/users/${userId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requiredActions: actions }),
  });
  if (!res.ok)
    throw new Error(`Keycloak update required actions error: ${res.status}`);
}

// ─── WebAuthn + TOTP Helpers (Keycloak-Only Storage) ─────────────────

/**
 * Check if user has a WebAuthn Passwordless credential in Keycloak.
 */
export async function hasPasskey(userId: string): Promise<boolean> {
  const creds = await getUserCredentials(userId);
  return creds.some((c) => c.type === "webauthn-passwordless");
}

/**
 * Count WebAuthn Passwordless credentials.
 */
export async function getPasskeyCount(userId: string): Promise<number> {
  const creds = await getUserCredentials(userId);
  return creds.filter((c) => c.type === "webauthn-passwordless").length;
}

/**
 * Check if user has OTP (TOTP) credential in Keycloak.
 */
export async function hasTotp(userId: string): Promise<boolean> {
  const creds = await getUserCredentials(userId);
  return creds.some((c) => c.type === "otp");
}

/**
 * Add a required action to force credential setup on next login.
 * Actions: "webauthn-register-passwordless", "CONFIGURE_TOTP"
 */
export async function addRequiredAction(
  userId: string,
  action: string,
): Promise<void> {
  const user = await getKeycloakUser(userId);
  const actions = user.requiredActions || [];
  if (!actions.includes(action)) {
    actions.push(action);
    await updateRequiredActions(userId, actions);
  }
}

/**
 * Remove a required action from a user.
 */
export async function removeRequiredAction(
  userId: string,
  action: string,
): Promise<void> {
  const user = await getKeycloakUser(userId);
  const actions = (user.requiredActions || []).filter((a) => a !== action);
  await updateRequiredActions(userId, actions);
}

/**
 * Get all passkey credential details (for profile page display).
 */
export async function getPasskeys(
  userId: string,
): Promise<Array<{ id: string; label: string; createdDate: number }>> {
  const creds = await getUserCredentials(userId);
  return creds
    .filter((c) => c.type === "webauthn-passwordless")
    .map((c) => ({
      id: c.id,
      label: c.userLabel || "Passkey",
      createdDate: c.createdDate || 0,
    }));
}

/**
 * Verify a password by attempting a resource owner password grant.
 * Returns true if the password is correct.
 */
export async function verifyPassword(
  username: string,
  password: string,
): Promise<boolean> {
  const { url, realm } = getConfig();
  const res = await fetch(
    `${url}/realms/${realm}/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "hub-app",
        username,
        password,
      }),
    },
  );
  return res.ok;
}
