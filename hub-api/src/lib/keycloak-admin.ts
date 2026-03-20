/**
 * Keycloak Admin REST API helper.
 *
 * Uses client credentials grant (service account) to manage user accounts.
 * All operations gracefully degrade if env vars are not configured.
 */

const KEYCLOAK_URL = process.env.KEYCLOAK_URL;
const REALM = process.env.KEYCLOAK_REALM;
const CLIENT_ID = process.env.KEYCLOAK_ADMIN_CLIENT_ID;
const CLIENT_SECRET = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET;

export interface KeycloakResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

interface KeycloakUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  createdTimestamp: number;
}

function isConfigured(): boolean {
  return !!(KEYCLOAK_URL && REALM && CLIENT_ID && CLIENT_SECRET);
}

async function getAdminToken(): Promise<string> {
  if (!isConfigured()) {
    throw new Error("Keycloak admin env vars not configured");
  }
  const tokenUrl = `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`;
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Keycloak token error: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

/**
 * List all users in the Keycloak realm.
 */
export async function listKeycloakUsers(): Promise<KeycloakResult<KeycloakUser[]>> {
  if (!isConfigured()) {
    return { success: false, error: "Keycloak admin not configured" };
  }
  try {
    const token = await getAdminToken();
    const res = await fetch(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/users?max=1000`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` };
    }
    const users = (await res.json()) as KeycloakUser[];
    return { success: true, data: users };
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message };
  }
}

/**
 * Create a new Keycloak user with optional email + temporary password.
 */
export async function createKeycloakUser(
  email: string,
  firstName: string,
  lastName: string,
): Promise<KeycloakResult<{ userId: string }>> {
  if (!isConfigured()) {
    return { success: false, error: "Keycloak admin not configured" };
  }
  try {
    const token = await getAdminToken();
    const res = await fetch(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/users`,
      {
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
          requiredActions: ["UPDATE_PASSWORD", "CONFIGURE_TOTP"],
        }),
      },
    );
    if (res.status === 201) {
      // Extract user ID from Location header
      const location = res.headers.get("Location") ?? "";
      const userId = location.split("/").pop() ?? "";
      return { success: true, data: { userId } };
    }
    const body = await res.text().catch(() => "");
    return { success: false, error: `HTTP ${res.status}: ${body}` };
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message };
  }
}

/**
 * Assign a realm role to a Keycloak user.
 */
export async function assignKeycloakRole(
  userId: string,
  roleName: string,
): Promise<KeycloakResult> {
  if (!isConfigured()) {
    return { success: false, error: "Keycloak admin not configured" };
  }
  try {
    const token = await getAdminToken();

    // First, get the role representation
    const roleRes = await fetch(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/roles/${roleName}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!roleRes.ok) {
      return { success: false, error: `Role '${roleName}' not found` };
    }
    const role = await roleRes.json();

    // Assign role to user
    const res = await fetch(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${userId}/role-mappings/realm`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([role]),
      },
    );
    if (res.ok || res.status === 204) return { success: true };
    const body = await res.text().catch(() => "");
    return { success: false, error: `HTTP ${res.status}: ${body}` };
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message };
  }
}

/**
 * Disable a Keycloak user (set enabled=false).
 */
export async function disableKeycloakUser(userId: string): Promise<KeycloakResult> {
  if (!isConfigured()) {
    return { success: false, error: "Keycloak admin not configured" };
  }
  try {
    const token = await getAdminToken();
    const res = await fetch(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${userId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enabled: false }),
      },
    );
    if (res.ok) return { success: true };
    const body = await res.text().catch(() => "");
    return { success: false, error: `HTTP ${res.status}: ${body}` };
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message };
  }
}

/**
 * Re-enable a Keycloak user.
 */
export async function enableKeycloakUser(userId: string): Promise<KeycloakResult> {
  if (!isConfigured()) {
    return { success: false, error: "Keycloak admin not configured" };
  }
  try {
    const token = await getAdminToken();
    const res = await fetch(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${userId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enabled: true }),
      },
    );
    if (res.ok) return { success: true };
    const body = await res.text().catch(() => "");
    return { success: false, error: `HTTP ${res.status}: ${body}` };
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message };
  }
}

/**
 * Delete a Keycloak user entirely (GDPR).
 */
export async function deleteKeycloakUser(userId: string): Promise<KeycloakResult> {
  if (!isConfigured()) {
    return { success: false, error: "Keycloak admin not configured" };
  }
  try {
    const token = await getAdminToken();
    const res = await fetch(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${userId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (res.ok || res.status === 404) return { success: true };
    const body = await res.text().catch(() => "");
    return { success: false, error: `HTTP ${res.status}: ${body}` };
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message };
  }
}

/**
 * Revoke all active sessions for a Keycloak user.
 */
export async function logoutKeycloakUser(userId: string): Promise<KeycloakResult> {
  if (!isConfigured()) {
    return { success: false, error: "Keycloak admin not configured" };
  }
  try {
    const token = await getAdminToken();
    const res = await fetch(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${userId}/logout`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (res.ok) return { success: true };
    const body = await res.text().catch(() => "");
    return { success: false, error: `HTTP ${res.status}: ${body}` };
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message };
  }
}
