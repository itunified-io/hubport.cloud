/**
 * Synapse Admin API client for hubport.cloud.
 * Manages Matrix users, rooms, and spaces programmatically.
 *
 * Env: MATRIX_ADMIN_URL, SYNAPSE_ADMIN_USER, SYNAPSE_SERVER_NAME
 * Vault (ADR-0083): synapse_admin_password, synapse_registration_secret
 */

import { getSynapseAdminPassword, getSynapseRegistrationSecret } from './vault-client.js';

/** Retry-aware fetch — backs off on 429 rate limits from Synapse. */
async function matrixFetch(url: string, init: RequestInit, maxRetries = 6): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429 || attempt === maxRetries) return res;
    const body = await res.json().catch(() => ({} as Record<string, unknown>)) as { retry_after_ms?: number };
    const waitMs = body.retry_after_ms ?? (2000 * (attempt + 1));
    await new Promise((r) => setTimeout(r, waitMs));
  }
  // unreachable, but TypeScript needs it
  return fetch(url, init);
}

async function getMatrixConfig() {
  const adminUrl = process.env.MATRIX_ADMIN_URL || "http://synapse:8008";
  const serverName = process.env.SYNAPSE_SERVER_NAME || "localhost";
  const adminUser = process.env.SYNAPSE_ADMIN_USER;
  if (!adminUser) {
    throw new Error("SYNAPSE_ADMIN_USER environment variable is required");
  }
  const adminPassword = await getSynapseAdminPassword();
  const registrationSecret = await getSynapseRegistrationSecret().catch(() => undefined);
  return { adminUrl, serverName, registrationSecret, adminUser, adminPassword };
}

let adminToken: string | null = null;

/**
 * Get admin token via Synapse shared secret registration or login.
 */
async function getAdminToken(): Promise<string> {
  if (adminToken) return adminToken;

  const { adminUrl, registrationSecret, adminUser, adminPassword } = await getMatrixConfig();

  // Try registration first (if secret available), then fall back to login
  if (registrationSecret) {
    try {
      const crypto = await import("node:crypto");

      // Get nonce for registration
      const nonceRes = await fetch(`${adminUrl}/_synapse/admin/v1/register`);
      if (nonceRes.ok) {
        const { nonce } = (await nonceRes.json()) as { nonce: string };

        // HMAC for admin registration
        const mac = crypto
          .createHmac("sha1", registrationSecret)
          .update(nonce + "\x00" + adminUser + "\x00" + adminPassword + "\x00" + "admin")
          .digest("hex");

        const regRes = await fetch(`${adminUrl}/_synapse/admin/v1/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nonce, username: adminUser, password: adminPassword, admin: true, mac }),
        });

        if (regRes.ok) {
          adminToken = ((await regRes.json()) as { access_token: string }).access_token;
          return adminToken;
        }
      }
    } catch {
      // Registration failed — fall through to login
    }
  }

  // Login with existing admin credentials
  const loginRes = await fetch(`${adminUrl}/_matrix/client/v3/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: adminUser },
      password: adminPassword,
    }),
  });
  if (!loginRes.ok) throw new Error(`Synapse admin login failed: ${loginRes.status}`);
  adminToken = ((await loginRes.json()) as { access_token: string }).access_token;
  return adminToken;
}

// ─── Users ───────────────────────────────────────────────────────────

export async function ensureMatrixUser(localpart: string, displayName: string, avatarUrl?: string): Promise<void> {
  const { adminUrl, serverName } = await getMatrixConfig();
  const token = await getAdminToken();
  const body: Record<string, unknown> = { displayname: displayName, deactivated: false };
  if (avatarUrl) body.avatar_url = avatarUrl;

  const res = await matrixFetch(`${adminUrl}/_synapse/admin/v2/users/${encodeURIComponent(`@${localpart}:${serverName}`)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Synapse user create failed: ${res.status}`);
}

export async function deactivateMatrixUser(localpart: string): Promise<void> {
  const { adminUrl, serverName } = await getMatrixConfig();
  const token = await getAdminToken();
  await fetch(`${adminUrl}/_synapse/admin/v2/users/${encodeURIComponent(`@${localpart}:${serverName}`)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ deactivated: true }),
  });
}

// ─── Media Upload ───────────────────────────────────────────────────

export async function uploadMatrixMedia(
  buffer: Buffer,
  contentType: string,
  filename: string,
): Promise<string> {
  const { adminUrl } = await getMatrixConfig();
  const token = await getAdminToken();

  const res = await fetch(
    `${adminUrl}/_matrix/media/v3/upload?filename=${encodeURIComponent(filename)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
      body: buffer,
    },
  );

  if (!res.ok) throw new Error(`Synapse media upload failed: ${res.status}`);
  return ((await res.json()) as { content_uri: string }).content_uri;
}

// ─── Rooms / Spaces ──────────────────────────────────────────────────

export async function createRoom(opts: {
  name: string; topic?: string; isSpace?: boolean; isPrivate?: boolean; isDirect?: boolean; invite?: string[];
}): Promise<string> {
  const { adminUrl } = await getMatrixConfig();
  const token = await getAdminToken();

  // DMs use trusted_private_chat preset with is_direct flag
  let preset = opts.isPrivate ? "private_chat" : "public_chat";
  if (opts.isDirect) preset = "trusted_private_chat";

  const body: Record<string, unknown> = {
    name: opts.name, topic: opts.topic,
    visibility: opts.isPrivate || opts.isDirect ? "private" : "public",
    preset,
    power_level_content_override: { events_default: 0, invite: 50, kick: 50, ban: 50, state_default: 50 },
    is_direct: opts.isDirect ?? false,
  };
  if (opts.isSpace) body.creation_content = { type: "m.space" };
  if (opts.invite?.length) body.invite = opts.invite;

  const res = await matrixFetch(`${adminUrl}/_matrix/client/v3/createRoom`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Synapse create room failed: ${res.status}`);
  return ((await res.json()) as { room_id: string }).room_id;
}

/**
 * Set the m.direct account data for a user, marking a room as a DM.
 * This is required for Matrix clients to display the room in the DM section.
 */
export async function setDirectRoom(userId: string, targetUserId: string, roomId: string): Promise<void> {
  const { adminUrl } = await getMatrixConfig();
  const token = await getAdminToken();

  // GET current m.direct data
  const getRes = await fetch(
    `${adminUrl}/_matrix/client/v3/user/${encodeURIComponent(userId)}/account_data/m.direct`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  let directMap: Record<string, string[]> = {};
  if (getRes.ok) {
    directMap = (await getRes.json()) as Record<string, string[]>;
  }

  // Add the new DM room
  if (!directMap[targetUserId]) directMap[targetUserId] = [];
  if (!directMap[targetUserId].includes(roomId)) {
    directMap[targetUserId].push(roomId);
  }

  // PUT updated m.direct data
  await fetch(
    `${adminUrl}/_matrix/client/v3/user/${encodeURIComponent(userId)}/account_data/m.direct`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(directMap),
    },
  );
}

/**
 * Set a user's power level in a specific room.
 * Power level 0 = normal (can post), 50 = moderator, 100 = admin.
 */
export async function setUserPowerLevel(roomId: string, userId: string, level: number): Promise<void> {
  const { adminUrl } = await getMatrixConfig();
  const token = await getAdminToken();

  // GET current power levels
  const getRes = await fetch(
    `${adminUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels/`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!getRes.ok) throw new Error(`Failed to get power levels: ${getRes.status}`);

  const powerLevels = (await getRes.json()) as Record<string, unknown>;
  const users = (powerLevels.users || {}) as Record<string, number>;
  users[userId] = level;
  powerLevels.users = users;

  // PUT updated power levels
  const putRes = await fetch(
    `${adminUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels/`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(powerLevels),
    },
  );
  if (!putRes.ok) throw new Error(`Failed to set power levels: ${putRes.status}`);
}

export async function addRoomToSpace(spaceId: string, childRoomId: string): Promise<void> {
  const { adminUrl, serverName } = await getMatrixConfig();
  const token = await getAdminToken();
  await fetch(
    `${adminUrl}/_matrix/client/v3/rooms/${encodeURIComponent(spaceId)}/state/m.space.child/${encodeURIComponent(childRoomId)}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ via: [serverName], suggested: true }),
    },
  );
}

export async function joinUserToRoom(roomId: string, userId: string): Promise<void> {
  const { adminUrl } = await getMatrixConfig();
  const token = await getAdminToken();
  await matrixFetch(`${adminUrl}/_synapse/admin/v1/join/${encodeURIComponent(roomId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId }),
  });
}

export async function removeFromRoom(roomId: string, userId: string): Promise<void> {
  const { adminUrl } = await getMatrixConfig();
  const token = await getAdminToken();
  await matrixFetch(`${adminUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/kick`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, reason: "Removed by admin" }),
  });
}

/**
 * Get a Matrix access token for a specific user via the Synapse admin API.
 * Uses POST /_synapse/admin/v1/users/{userId}/login to create a token
 * that the frontend Matrix JS SDK can use to connect.
 */
export async function getMatrixUserToken(matrixUserId: string): Promise<string> {
  const { adminUrl } = await getMatrixConfig();
  const token = await getAdminToken();
  const res = await matrixFetch(
    `${adminUrl}/_synapse/admin/v1/users/${encodeURIComponent(matrixUserId)}/login`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  if (!res.ok) throw new Error(`Synapse user login failed: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}
