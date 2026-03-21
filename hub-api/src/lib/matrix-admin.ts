/**
 * Matrix Synapse Admin API client.
 * Used to auto-provision users and rooms when publishers are created/modified.
 * Requires MATRIX_ADMIN_URL and MATRIX_ADMIN_TOKEN env vars.
 */

const MATRIX_URL = process.env.MATRIX_ADMIN_URL || "http://synapse:8008";
const MATRIX_TOKEN = process.env.MATRIX_ADMIN_TOKEN || "";
const SERVER_NAME = process.env.SYNAPSE_SERVER_NAME || "";

function headers() {
  return {
    Authorization: `Bearer ${MATRIX_TOKEN}`,
    "Content-Type": "application/json",
  };
}

export function isMatrixConfigured(): boolean {
  return Boolean(MATRIX_TOKEN && SERVER_NAME);
}

/**
 * Create or update a Matrix user via Synapse Admin API.
 * Idempotent — PUT creates if not exists, updates if exists.
 */
export async function ensureMatrixUser(
  localpart: string,
  displayName: string,
): Promise<boolean> {
  if (!isMatrixConfigured()) return false;
  try {
    const userId = `@${localpart}:${SERVER_NAME}`;
    const res = await fetch(`${MATRIX_URL}/_synapse/admin/v2/users/${encodeURIComponent(userId)}`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({
        displayname: displayName,
        deactivated: false,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Deactivate a Matrix user (when publisher is deactivated).
 */
export async function deactivateMatrixUser(localpart: string): Promise<boolean> {
  if (!isMatrixConfigured()) return false;
  try {
    const userId = `@${localpart}:${SERVER_NAME}`;
    const res = await fetch(`${MATRIX_URL}/_synapse/admin/v2/users/${encodeURIComponent(userId)}`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ deactivated: true }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Create a Matrix room via Synapse Admin API.
 * Returns room_id or null on failure.
 */
export async function createMatrixRoom(
  name: string,
  topic: string,
  inviteLocalparts: string[] = [],
  isPublic = false,
): Promise<string | null> {
  if (!isMatrixConfigured()) return null;
  try {
    // Use the admin user to create the room
    const adminUserId = `@admin:${SERVER_NAME}`;
    const invite = inviteLocalparts.map((lp) => `@${lp}:${SERVER_NAME}`);
    const res = await fetch(`${MATRIX_URL}/_synapse/admin/v1/rooms`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        name,
        topic,
        invite,
        preset: isPublic ? "public_chat" : "private_chat",
        creator: adminUserId,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { room_id: string };
    return data.room_id;
  } catch {
    return null;
  }
}

/**
 * Invite a user to a Matrix room.
 */
export async function inviteToRoom(roomId: string, localpart: string): Promise<boolean> {
  if (!isMatrixConfigured()) return false;
  try {
    const userId = `@${localpart}:${SERVER_NAME}`;
    const res = await fetch(`${MATRIX_URL}/_synapse/admin/v1/join/${encodeURIComponent(roomId)}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user_id: userId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Remove a user from a Matrix room.
 */
export async function removeFromRoom(roomId: string, localpart: string): Promise<boolean> {
  if (!isMatrixConfigured()) return false;
  try {
    const userId = `@${localpart}:${SERVER_NAME}`;
    const adminUserId = `@admin:${SERVER_NAME}`;
    const res = await fetch(`${MATRIX_URL}/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}/kick`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user_id: userId, admin_user_id: adminUserId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Default rooms created per tenant on first boot */
export const DEFAULT_ROOMS = [
  { alias: "general", name: "#general", topic: "Congregation-wide announcements and discussion", isPublic: true },
  { alias: "elders", name: "#elders", topic: "Elder-only discussion (private)", isPublic: false },
  { alias: "service", name: "#service", topic: "Field service coordination", isPublic: true },
  { alias: "technik", name: "#technik", topic: "Technical duties coordination", isPublic: false },
  { alias: "ordnungsdienst", name: "#ordnungsdienst", topic: "Attendant duties", isPublic: false },
  { alias: "reinigung", name: "#reinigung", topic: "Cleaning schedule coordination", isPublic: true },
];
