/**
 * Pre-seeded Matrix spaces and rooms for hubport.cloud tenants.
 * Auto-provisioned on first boot or when a new publisher is approved.
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
  /** AppRole name required to access. null = all publishers */
  requiredRole: string | null;
}

export const DEFAULT_SPACES: SpaceDefinition[] = [
  {
    name: "Versammlung",
    topic: "Versammlungsweite Kommunikation",
    rooms: [
      { name: "Allgemein", topic: "Allgemeine Ankündigungen und Austausch", isPrivate: false, requiredRole: null },
      { name: "Älteste", topic: "Ältestenschaft — vertraulich", isPrivate: true, requiredRole: "elder" },
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

// ─── Provisioning ────────────────────────────────────────────────────

interface ProvisionedSpace {
  spaceId: string;
  name: string;
  rooms: Array<{ roomId: string; name: string; requiredRole: string | null }>;
}

/**
 * Create all default spaces and rooms.
 * Returns the provisioned structure for storage.
 * Idempotent — skips if rooms already exist (check by name).
 */
export async function provisionDefaultSpaces(): Promise<ProvisionedSpace[]> {
  const result: ProvisionedSpace[] = [];

  for (const spaceDef of DEFAULT_SPACES) {
    // Create the space
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

      // Add room as child of space
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
      // Check access
      if (room.requiredRole === null) {
        // Open to all publishers
        await joinUserToRoom(room.roomId, matrixUserId).catch(() => {});
      } else if (room.requiredRole === "elder" && congregationRole === "elder") {
        await joinUserToRoom(room.roomId, matrixUserId).catch(() => {});
      } else if (publisherRoles.includes(room.requiredRole)) {
        await joinUserToRoom(room.roomId, matrixUserId).catch(() => {});
      }
      // Otherwise: not joined (no access)
    }
  }
}
