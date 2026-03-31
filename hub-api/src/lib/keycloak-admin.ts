/**
 * Keycloak Admin Client — service account operations.
 *
 * Uses client credentials grant to obtain admin token,
 * then manages users via Keycloak Admin REST API.
 *
 * Env: KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_ADMIN_CLIENT_ID
 * Secrets: admin client secret via Vault (getKeycloakClientSecret), verify client secret via Vault (getVerifyClientSecret)
 */

import { getKeycloakClientSecret } from "./vault-client.js";

/** Sanitize a Keycloak path segment: reject path traversal chars, always encode. */
function safePath(value: string, name: string): string {
  if (!value || /[\/\\?#]/.test(value)) {
    throw new Error(`Invalid ${name}: contains path-separator or query characters`);
  }
  return encodeURIComponent(value);
}

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

  if (!url || !realm || !clientId) {
    throw new Error(
      "Missing Keycloak admin env: KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_ADMIN_CLIENT_ID",
    );
  }

  return { url, realm, clientId };
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

  const { url, realm, clientId } = getConfig();
  const clientSecret = await getKeycloakClientSecret();
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
  const res = await fetch(`${adminUrl()}/users/${safePath(userId, "userId")}`, {
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
 * Create a Keycloak user for an invited publisher.
 * Unlike createKeycloakUser(), this sets emailVerified=true (invite code = proof)
 * and uses a random temporary password.
 */
export async function createInvitedKeycloakUser(
  email: string,
  firstName?: string,
  lastName?: string,
): Promise<{ userId: string; tempPassword: string }> {
  const token = await getAdminToken();
  const { randomBytes } = await import("node:crypto");
  // Password must meet KC policy: 12+ chars, upper, lower, digit, special
  const tempPassword = randomBytes(9).toString("base64").slice(0, 12) + "Aa1!";

  const res = await fetch(`${adminUrl()}/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: email,
      email,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      enabled: true,
      emailVerified: true,
      credentials: [
        {
          type: "password",
          value: tempPassword,
          temporary: true,
        },
      ],
      requiredActions: ["UPDATE_PASSWORD", "CONFIGURE_TOTP", "webauthn-register-passwordless"],
    }),
  });

  if (res.status === 409) {
    // User already exists (e.g., previous invite attempt) — look up by email
    const searchRes = await fetch(
      `${adminUrl()}/users?email=${encodeURIComponent(email)}&exact=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!searchRes.ok) throw new Error(`Keycloak user lookup error: ${searchRes.status}`);
    const users = (await searchRes.json()) as Array<{ id: string }>;
    if (users.length === 0) throw new Error("Keycloak 409 but user not found by email");
    const userId = users[0].id;

    // Ensure required actions are set (may be missing from previous incomplete invite)
    const updateRes = await fetch(`${adminUrl()}/users/${userId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        requiredActions: ["UPDATE_PASSWORD", "CONFIGURE_TOTP", "webauthn-register-passwordless"],
        credentials: [
          {
            type: "password",
            value: tempPassword,
            temporary: true,
          },
        ],
      }),
    });
    if (!updateRes.ok) {
      throw new Error(`Keycloak update existing user error: ${updateRes.status} ${await updateRes.text()}`);
    }

    // Ensure "publisher" realm role is assigned
    try { await assignKeycloakRole(userId, "publisher"); } catch { /* role may already be assigned */ }

    return { userId, tempPassword };
  }

  if (!res.ok) {
    throw new Error(`Keycloak createInvitedUser error: ${res.status} ${await res.text()}`);
  }

  const location = res.headers.get("Location");
  if (!location) throw new Error("No Location header in Keycloak create response");
  const userId = location.split("/").pop()!;

  // Assign default "publisher" realm role for base permissions
  try { await assignKeycloakRole(userId, "publisher"); } catch { /* role may not exist yet */ }

  return { userId, tempPassword };
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
    `${adminUrl()}/users/${safePath(userId, "userId")}/role-mappings/realm`,
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
 * Remove a realm role from a Keycloak user.
 */
export async function removeKeycloakRole(
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

  // Remove role from user
  const res = await fetch(
    `${adminUrl()}/users/${safePath(userId, "userId")}/role-mappings/realm`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([role]),
    },
  );

  if (!res.ok) {
    throw new Error(`Keycloak remove role error: ${res.status}`);
  }
}

/**
 * Disable a Keycloak user (set enabled=false).
 */
export async function disableKeycloakUser(userId: string): Promise<void> {
  const token = await getAdminToken();
  const res = await fetch(`${adminUrl()}/users/${safePath(userId, "userId")}`, {
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
  const res = await fetch(`${adminUrl()}/users/${safePath(userId, "userId")}`, {
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
  const res = await fetch(`${adminUrl()}/users/${safePath(userId, "userId")}`, {
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
  const res = await fetch(`${adminUrl()}/users/${safePath(userId, "userId")}/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok && res.status !== 204) {
    throw new Error(`Keycloak logout error: ${res.status}`);
  }
}

/**
 * Send Keycloak "execute actions" email — user receives a link to complete
 * required actions (UPDATE_PASSWORD, CONFIGURE_TOTP, webauthn-register-passwordless).
 * Requires SMTP configured in Keycloak realm.
 */
export async function sendExecuteActionsEmail(
  userId: string,
  actions: string[],
  redirectUri?: string,
  clientId?: string,
  lifespan = 86400, // 24 hours
): Promise<void> {
  const token = await getAdminToken();
  const params = new URLSearchParams();
  params.set("lifespan", String(lifespan));
  if (redirectUri) params.set("redirect_uri", redirectUri);
  if (clientId) params.set("client_id", clientId);
  const res = await fetch(
    `${adminUrl()}/users/${safePath(userId, "userId")}/execute-actions-email?${params}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(actions),
    },
  );

  if (!res.ok) {
    throw new Error(`Keycloak execute-actions-email error: ${res.status} ${await res.text()}`);
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
  const res = await fetch(`${adminUrl()}/users/${safePath(userId, "userId")}/credentials`, {
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
    `${adminUrl()}/users/${safePath(userId, "userId")}/credentials/${safePath(credentialId, "credentialId")}`,
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
  const res = await fetch(`${adminUrl()}/users/${safePath(userId, "userId")}/reset-password`, {
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
  const res = await fetch(`${adminUrl()}/users/${safePath(userId, "userId")}/sessions`, {
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
    `${url}/admin/realms/${realm}/sessions/${safePath(sessionId, "sessionId")}`,
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
  const res = await fetch(`${adminUrl()}/users/${safePath(userId, "userId")}`, {
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
 * Verify a user's password via the Keycloak Admin API.
 *
 * Temporarily clears requiredActions on the user (which block password grants
 * when 2FA is enforced), attempts a password grant via hub-verify, then
 * restores the original requiredActions. This avoids the "Account is not fully
 * set up" error that blocks direct grants before TOTP is configured.
 *
 * Falls back to admin-only credential reset test if hub-verify is unavailable.
 */
export async function verifyPassword(
  username: string,
  password: string,
): Promise<boolean> {
  const { url, realm } = getConfig();

  // 1. Get admin token + find user
  const token = await getAdminToken();
  const safeUser = safePath(username, "username");
  const usersRes = await fetch(
    `${url}/admin/realms/${safePath(realm, "realm")}/users?username=${safeUser}&exact=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!usersRes.ok) return false;
  const users = (await usersRes.json()) as Array<{ id: string; requiredActions: string[] }>;
  if (users.length === 0) return false;

  const userId = safePath(users[0].id, "userId");
  const savedActions = users[0].requiredActions ?? [];

  try {
    // 2. Temporarily clear requiredActions so password grant isn't blocked by CONFIGURE_TOTP
    if (savedActions.length > 0) {
      await fetch(
        `${url}/admin/realms/${safePath(realm, "realm")}/users/${userId}`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ requiredActions: [] }),
        },
      );
    }

    // 3. Attempt password grant via hub-verify
    let verifySecret: string;
    try {
      const { getVerifyClientSecret } = await import("./vault-client.js");
      verifySecret = await getVerifyClientSecret();
    } catch {
      // hub-verify not provisioned — fall back to admin client
      const clientSecret = await getKeycloakClientSecret();
      verifySecret = clientSecret;
      // Use hub-api client (has directAccessGrants=false, so this will fail)
      // Return false gracefully — password verification not available
      return false;
    }

    const res = await fetch(
      `${url}/realms/${realm}/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "password",
          client_id: "hub-verify",
          client_secret: verifySecret,
          username,
          password,
        }),
      },
    );
    return res.ok;
  } finally {
    // 4. Always restore requiredActions
    if (savedActions.length > 0) {
      const restoreToken = await getAdminToken();
      await fetch(
        `${url}/admin/realms/${safePath(realm, "realm")}/users/${userId}`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${restoreToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ requiredActions: savedActions }),
        },
      );
    }
  }
}
