/**
 * Matrix provisioning service for hubport.cloud tenants.
 *
 * Orchestrates: space creation, user provisioning, room membership sync.
 * All operations are idempotent and non-fatal — chat failure should never
 * block core app functionality.
 */
import prisma from "./prisma.js";
import { ensureMatrixUser, joinUserToRoom, removeFromRoom } from "./matrix-admin.js";
import { provisionDefaultSpaces, joinPublisherToRooms } from "./matrix-rooms.js";

// ─── Types ──────────────────────────────────────────────────────────

interface ProvisionedRoom {
  roomId: string;
  name: string;
  requiredRole: string | null;
}

interface ProvisionedSpace {
  spaceId: string;
  name: string;
  rooms: ProvisionedRoom[];
}

// ─── Space Provisioning ─────────────────────────────────────────────

/**
 * Ensure default Matrix spaces exist for this tenant.
 * Checks DB first; if no spaces found, calls provisionDefaultSpaces()
 * and persists the result. Idempotent.
 */
export async function ensureSpacesProvisioned(): Promise<ProvisionedSpace[]> {
  // Check if spaces already exist in DB
  const existing = await prisma.matrixSpaceConfig.findMany();
  if (existing.length > 0) {
    return existing.map((s) => ({
      spaceId: s.spaceId,
      name: s.spaceName,
      rooms: s.rooms as unknown as ProvisionedRoom[],
    }));
  }

  // Provision via Matrix admin API
  const provisioned = await provisionDefaultSpaces();

  // Persist to DB
  for (const space of provisioned) {
    await prisma.matrixSpaceConfig.create({
      data: {
        spaceId: space.spaceId,
        spaceName: space.name,
        rooms: JSON.parse(JSON.stringify(space.rooms)),
      },
    });
  }

  return provisioned;
}

// ─── User Provisioning ──────────────────────────────────────────────

/**
 * Create a Matrix user for a publisher and join them to appropriate rooms.
 * Called during onboarding completion and during migration of existing users.
 * Non-fatal — wrapped in try/catch at call sites.
 */
export async function provisionMatrixUserForPublisher(publisher: {
  id: string;
  firstName: string;
  lastName: string;
  displayName?: string | null;
  congregationRole: string;
}): Promise<void> {
  const displayName = publisher.displayName ?? `${publisher.firstName} ${publisher.lastName}`;
  const localpart = publisher.id;

  // 1. Create/update Matrix user
  await ensureMatrixUser(localpart, displayName);

  // 2. Ensure spaces are provisioned
  const spaces = await ensureSpacesProvisioned();

  // 3. Get publisher's AppRole names
  const appRoleMembers = await prisma.appRoleMember.findMany({
    where: { publisherId: publisher.id },
    include: { role: { select: { name: true } } },
  });
  const publisherRoles = appRoleMembers.map((arm) => arm.role.name);

  // 4. Build Matrix user ID
  const serverName = process.env.SYNAPSE_SERVER_NAME || "localhost";
  const matrixUserId = `@${localpart}:${serverName}`;

  // 5. Join rooms based on roles
  await joinPublisherToRooms(matrixUserId, publisherRoles, publisher.congregationRole, spaces);
}

// ─── Membership Sync ────────────────────────────────────────────────

/**
 * Sync a publisher's Matrix room memberships based on their current roles.
 * Called when AppRoles or congregationRole change.
 * Joins missing rooms, removes from unauthorized rooms.
 */
export async function syncPublisherRoomMemberships(publisherId: string): Promise<void> {
  const publisher = await prisma.publisher.findUnique({
    where: { id: publisherId },
    include: {
      appRoles: { include: { role: { select: { name: true } } } },
    },
  });
  if (!publisher || publisher.status !== "active") return;

  const spaces = await ensureSpacesProvisioned();
  const publisherRoles = publisher.appRoles.map((arm) => arm.role.name);
  const serverName = process.env.SYNAPSE_SERVER_NAME || "localhost";
  const matrixUserId = `@${publisher.id}:${serverName}`;

  for (const space of spaces) {
    // Always join the space itself
    await joinUserToRoom(space.spaceId, matrixUserId).catch(() => {});

    for (const room of space.rooms) {
      const shouldJoin = shouldJoinRoom(room.requiredRole, publisherRoles, publisher.congregationRole);
      if (shouldJoin) {
        await joinUserToRoom(room.roomId, matrixUserId).catch(() => {});
      } else {
        // Remove from room if they shouldn't be there
        await removeFromRoom(room.roomId, matrixUserId).catch(() => {});
      }
    }
  }
}

/**
 * Check if a publisher should be in a room based on the room's requiredRole.
 */
function shouldJoinRoom(
  requiredRole: string | null,
  publisherRoles: string[],
  congregationRole: string,
): boolean {
  if (requiredRole === null) return true; // Open to all publishers
  if (requiredRole === "elder") return congregationRole === "elder";
  if (requiredRole === "elder_or_ms") {
    return congregationRole === "elder" || congregationRole === "ministerial_servant";
  }
  // Check AppRole name match (also check related roles from ROOM_ACCESS_MAP)
  const relatedRoles = ROOM_ROLE_ALIASES[requiredRole];
  if (relatedRoles) {
    return relatedRoles.some((r) => publisherRoles.includes(r));
  }
  return publisherRoles.includes(requiredRole);
}

/**
 * Maps a room's requiredRole to all AppRole names that grant access.
 * Allows e.g. "Cleaning Responsible" room to include sub-roles.
 */
const ROOM_ROLE_ALIASES: Record<string, string[]> = {
  "Technik": ["Technik", "Technik Responsible"],
  "Ordnungsdienst": ["Ordnungsdienst"],
  "Cleaning Responsible": ["Cleaning Responsible", "Grundreinigung", "Sichtreinigung"],
};

// ─── Bulk Migration ─────────────────────────────────────────────────

/**
 * Provision Matrix users for all active publishers who don't yet have one.
 * Called from the admin provision endpoint for existing-tenant migration.
 */
export async function provisionAllActivePublishers(): Promise<{ provisioned: number; failed: number }> {
  const publishers = await prisma.publisher.findMany({
    where: { status: "active" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      displayName: true,
      congregationRole: true,
    },
  });

  let provisioned = 0;
  let failed = 0;

  for (const pub of publishers) {
    try {
      await provisionMatrixUserForPublisher(pub);
      provisioned++;
    } catch {
      failed++;
    }
  }

  return { provisioned, failed };
}
