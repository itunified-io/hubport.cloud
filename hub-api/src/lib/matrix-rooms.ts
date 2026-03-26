/**
 * Pre-seeded Matrix spaces and rooms for hubport.cloud tenants.
 * Auto-provisioned on first boot or when a new publisher is approved.
 *
 * Space membership is RBAC-controlled:
 * - Open rooms (requiredRole=null) → all publishers
 * - "elder" rooms → congregationRole === "elder"
 * - "elder_or_ms" rooms → elder OR ministerialServant
 * - AppRole-gated rooms → publisher has the named AppRole (or alias)
 */
import { createRoom, addRoomToSpace, joinUserToRoom } from "./matrix-admin.js";

// ─── Space Definitions ──────────────────────────────────────────────

interface SpaceDefinition {
  name: string;
  topic: string;
  rooms: RoomDefinition[];
}

interface RoomDefinition {
  name: string;
  topic: string;
  isPrivate: boolean;
  /** Role key for access control. null = all publishers */
  requiredRole: string | null;
}

export const DEFAULT_SPACES: SpaceDefinition[] = [
  {
    name: "Versammlung",
    topic: "Versammlungsweite Kommunikation",
    rooms: [
      { name: "Allgemein", topic: "Allgemeine Ankündigungen und Austausch", isPrivate: false, requiredRole: null },
      { name: "Älteste", topic: "Ältestenschaft — vertraulich", isPrivate: true, requiredRole: "elder" },
      { name: "Älteste + Dienstamtgehilfen", topic: "Älteste und Dienstamtgehilfen — vertraulich", isPrivate: true, requiredRole: "elder_or_ms" },
      { name: "Predigtdienst", topic: "Predigtdienst-Koordination", isPrivate: false, requiredRole: null },
    ],
  },
  {
    name: "Dienste",
    topic: "Dienstaufgaben und Koordination",
    rooms: [
      { name: "Technik", topic: "Audio, Video, Zoom — technische Koordination", isPrivate: false, requiredRole: "Technik" },
      { name: "Ordnungsdienst", topic: "Saalordner und Empfang", isPrivate: false, requiredRole: "Ordnungsdienst" },
      { name: "Reinigung", topic: "Reinigungsplan und Absprachen", isPrivate: false, requiredRole: "Cleaning Responsible" },
      { name: "Garten", topic: "Gartenpflege und Winterdienst", isPrivate: false, requiredRole: "Cleaning Responsible" },
    ],
  },
];

/**
 * Maps a room's requiredRole to all AppRole names that grant access.
 * Allows e.g. "Cleaning Responsible" room to include all cleaning sub-roles.
 */
export const ROOM_ROLE_ALIASES: Record<string, string[]> = {
  "Technik": ["Technik", "Technik Responsible"],
  "Ordnungsdienst": ["Ordnungsdienst"],
  "Cleaning Responsible": ["Cleaning Responsible", "Grundreinigung", "Sichtreinigung"],
};

// ─── Access Check ───────────────────────────────────────────────────

/**
 * Check if a publisher should be in a room based on the room's requiredRole.
 */
export function shouldJoinRoom(
  requiredRole: string | null,
  publisherRoles: string[],
  congregationRole: string,
): boolean {
  if (requiredRole === null) return true;
  if (requiredRole === "elder") return congregationRole === "elder";
  if (requiredRole === "elder_or_ms") {
    return congregationRole === "elder" || congregationRole === "ministerialServant";
  }
  // Check AppRole name match (including aliases)
  const aliases = ROOM_ROLE_ALIASES[requiredRole];
  if (aliases) {
    return aliases.some((r) => publisherRoles.includes(r));
  }
  return publisherRoles.includes(requiredRole);
}

// ─── Provisioning ────────────────────────────────────────────────────

export interface ProvisionedSpace {
  spaceId: string;
  name: string;
  rooms: Array<{ roomId: string; name: string; requiredRole: string | null }>;
}

/**
 * Create all default spaces and rooms.
 * Returns the provisioned structure for storage.
 */
export async function provisionDefaultSpaces(): Promise<ProvisionedSpace[]> {
  const result: ProvisionedSpace[] = [];

  for (const spaceDef of DEFAULT_SPACES) {
    const spaceId = await createRoom({
      name: spaceDef.name,
      topic: spaceDef.topic,
      isSpace: true,
    });

    const rooms: ProvisionedSpace["rooms"] = [];

    for (const roomDef of spaceDef.rooms) {
      const roomId = await createRoom({
        name: roomDef.name,
        topic: roomDef.topic,
        isPrivate: roomDef.isPrivate,
      });

      await addRoomToSpace(spaceId, roomId);

      rooms.push({
        roomId,
        name: roomDef.name,
        requiredRole: roomDef.requiredRole,
      });
    }

    result.push({ spaceId, name: spaceDef.name, rooms });
  }

  return result;
}

/**
 * Auto-join a publisher to all rooms they have access to.
 * Called when a publisher is approved or roles change.
 */
export async function joinPublisherToRooms(
  matrixUserId: string,
  publisherRoles: string[],
  congregationRole: string,
  provisionedSpaces: ProvisionedSpace[],
): Promise<void> {
  for (const space of provisionedSpaces) {
    // Join the space itself
    await joinUserToRoom(space.spaceId, matrixUserId).catch(() => {});

    for (const room of space.rooms) {
      if (shouldJoinRoom(room.requiredRole, publisherRoles, congregationRole)) {
        await joinUserToRoom(room.roomId, matrixUserId).catch(() => {});
      }
    }
  }
}
