/**
 * Synapse Admin API client for hubport.cloud.
 * Manages Matrix users, rooms, and spaces programmatically.
 *
 * Env: MATRIX_ADMIN_URL (http://synapse:8008), SYNAPSE_REGISTRATION_SECRET
 */

function getMatrixConfig() {
  const adminUrl = process.env.MATRIX_ADMIN_URL || "http://synapse:8008";
  const serverName = process.env.SYNAPSE_SERVER_NAME || "localhost";
  const registrationSecret = process.env.SYNAPSE_REGISTRATION_SECRET;
  return { adminUrl, serverName, registrationSecret };
}

let adminToken: string | null = null;

/**
 * Get admin token via Synapse shared secret registration or login.
 */
async function getAdminToken(): Promise<string> {
  if (adminToken) return adminToken;

  const { adminUrl, registrationSecret } = getMatrixConfig();
  if (!registrationSecret) {
    throw new Error("SYNAPSE_REGISTRATION_SECRET not set");
  }

  const crypto = await import("node:crypto");

  // Get nonce for registration
  const nonceRes = await fetch(`${adminUrl}/_synapse/admin/v1/register`);
  if (!nonceRes.ok) throw new Error(`Synapse nonce failed: ${nonceRes.status}`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };

  // HMAC for admin registration
  const mac = crypto
    .createHmac("sha1", registrationSecret)
    .update(nonce + "\x00" + "hubport-admin" + "\x00" + "hubport-admin-secret" + "\x00" + "admin")
    .digest("hex");

  const regRes = await fetch(`${adminUrl}/_synapse/admin/v1/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nonce, username: "hubport-admin", password: "hubport-admin-secret", admin: true, mac }),
  });

  if (regRes.ok) {
    adminToken = ((await regRes.json()) as { access_token: string }).access_token;
    return adminToken;
  }

  // Already exists — login
  const loginRes = await fetch(`${adminUrl}/_matrix/client/v3/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: "hubport-admin" },
      password: "hubport-admin-secret",
    }),
  });
  if (!loginRes.ok) throw new Error(`Synapse admin login failed: ${loginRes.status}`);
  adminToken = ((await loginRes.json()) as { access_token: string }).access_token;
  return adminToken;
}

// ─── Users ───────────────────────────────────────────────────────────

export async function ensureMatrixUser(localpart: string, displayName: string, avatarUrl?: string): Promise<void> {
  const { adminUrl, serverName } = getMatrixConfig();
  const token = await getAdminToken();
  const body: Record<string, unknown> = { displayname: displayName, deactivated: false };
  if (avatarUrl) body.avatar_url = avatarUrl;

  const res = await fetch(`${adminUrl}/_synapse/admin/v2/users/${encodeURIComponent(`@${localpart}:${serverName}`)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Synapse user create failed: ${res.status}`);
}

export async function deactivateMatrixUser(localpart: string): Promise<void> {
  const { adminUrl, serverName } = getMatrixConfig();
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
  const { adminUrl } = getMatrixConfig();
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
  name: string; topic?: string; isSpace?: boolean; isPrivate?: boolean; invite?: string[];
}): Promise<string> {
  const { adminUrl } = getMatrixConfig();
  const token = await getAdminToken();
  const body: Record<string, unknown> = {
    name: opts.name, topic: opts.topic,
    visibility: opts.isPrivate ? "private" : "public",
    preset: opts.isPrivate ? "private_chat" : "public_chat",
    power_level_content_override: { events_default: 0, invite: 50, kick: 50, ban: 50, state_default: 50 },
  };
  if (opts.isSpace) body.creation_content = { type: "m.space" };
  if (opts.invite?.length) body.invite = opts.invite;

  const res = await fetch(`${adminUrl}/_matrix/client/v3/createRoom`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Synapse create room failed: ${res.status}`);
  return ((await res.json()) as { room_id: string }).room_id;
}

export async function addRoomToSpace(spaceId: string, childRoomId: string): Promise<void> {
  const { adminUrl, serverName } = getMatrixConfig();
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
  const { adminUrl } = getMatrixConfig();
  const token = await getAdminToken();
  await fetch(`${adminUrl}/_synapse/admin/v1/join/${encodeURIComponent(roomId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId }),
  });
}

export async function removeFromRoom(roomId: string, userId: string): Promise<void> {
  const { adminUrl } = getMatrixConfig();
  const token = await getAdminToken();
  await fetch(`${adminUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/kick`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, reason: "Removed by admin" }),
  });
}
