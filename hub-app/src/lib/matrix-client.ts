/**
 * Matrix client wrapper for hubport chat.
 * Handles init, sync, send, and room management via matrix-js-sdk.
 */
import {
  createClient,
  type MatrixClient,
  type Room,
  type MatrixEvent,
  type ICreateClientOpts,
} from "matrix-js-sdk";

let client: MatrixClient | null = null;

// ─── Types ───────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  sender: string;
  senderName: string;
  avatarUrl?: string;
  body: string;
  timestamp: number;
  type: "text" | "image" | "file";
}

export interface ChatRoom {
  id: string;
  name: string;
  topic?: string;
  isSpace: boolean;
  isDirect: boolean;
  unreadCount: number;
  lastMessage?: ChatMessage;
  memberCount: number;
  avatarUrl?: string;
}

export interface ChatSpace {
  id: string;
  name: string;
  icon?: string;
  children: ChatRoom[];
  unreadTotal: number;
}

// ─── Client Lifecycle ────────────────────────────────────────────────

export async function initMatrixClient(
  homeserverUrl: string,
  accessToken: string,
  userId: string,
): Promise<MatrixClient> {
  if (client) return client;

  const opts: ICreateClientOpts = {
    baseUrl: homeserverUrl,
    accessToken,
    userId,
  };

  client = createClient(opts);

  await client.startClient({ initialSyncLimit: 20 });

  // Wait for initial sync
  await new Promise<void>((resolve) => {
    const onSync = (state: string) => {
      if (state === "PREPARED") {
        client?.removeListener("sync" as any, onSync);
        resolve();
      }
    };
    client?.on("sync" as any, onSync);
  });

  return client;
}

export function getMatrixClient(): MatrixClient | null {
  return client;
}

export async function stopMatrixClient(): Promise<void> {
  if (client) {
    client.stopClient();
    client = null;
  }
}

// ─── Rooms ───────────────────────────────────────────────────────────

export function getRooms(): ChatRoom[] {
  if (!client) return [];
  return client
    .getRooms()
    .filter((r) => r.getMyMembership() === "join" && !r.isSpaceRoom())
    .map(roomToChatRoom)
    .sort((a, b) => (b.lastMessage?.timestamp ?? 0) - (a.lastMessage?.timestamp ?? 0));
}

export function getSpaces(): ChatSpace[] {
  if (!client) return [];

  const spaces = client
    .getRooms()
    .filter((r) => r.getMyMembership() === "join" && r.isSpaceRoom());

  return spaces.map((space) => {
    const childEvents = space.currentState.getStateEvents("m.space.child");
    const childRoomIds = childEvents
      .map((e: MatrixEvent) => e.getStateKey())
      .filter(Boolean) as string[];

    const children = childRoomIds
      .map((id) => client?.getRoom(id))
      .filter((r): r is Room => r !== null && r !== undefined && r.getMyMembership() === "join")
      .map(roomToChatRoom);

    const unreadTotal = children.reduce((sum, c) => sum + c.unreadCount, 0);

    return {
      id: space.roomId,
      name: space.name || "Space",
      icon: getSpaceIcon(space.name),
      children,
      unreadTotal,
    };
  });
}

function getSpaceIcon(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("versammlung")) return "🏛️";
  if (lower.includes("dienste")) return "⚙️";
  if (lower.includes("dienstgruppe")) return "📋";
  if (lower.includes("cross") || lower.includes("tenant")) return "🌐";
  return "💬";
}

export function getDMs(): ChatRoom[] {
  if (!client) return [];
  const directRooms = (client.getAccountData("m.direct" as any) as any)?.getContent() ?? {};
  const dmRoomIds = new Set(Object.values(directRooms).flat() as string[]);

  return client
    .getRooms()
    .filter((r) => r.getMyMembership() === "join" && dmRoomIds.has(r.roomId))
    .map(roomToChatRoom)
    .sort((a, b) => (b.lastMessage?.timestamp ?? 0) - (a.lastMessage?.timestamp ?? 0));
}

// ─── Messages ────────────────────────────────────────────────────────

export function getRoomMessages(roomId: string, limit = 50): ChatMessage[] {
  if (!client) return [];
  const room = client.getRoom(roomId);
  if (!room) return [];

  return room.timeline
    .filter((e) => e.getType() === "m.room.message")
    .slice(-limit)
    .map(eventToMessage);
}

export async function sendMessage(roomId: string, body: string): Promise<void> {
  if (!client) throw new Error("Matrix client not initialized");
  await client.sendTextMessage(roomId, body);
}

export async function sendImageMessage(
  roomId: string,
  file: File,
): Promise<void> {
  if (!client) throw new Error("Matrix client not initialized");
  const upload = await client.uploadContent(file, { type: file.type });
  await client.sendImageMessage(roomId, upload.content_uri, { size: file.size }, file.name);
}

// ─── Typing ──────────────────────────────────────────────────────────

export function sendTypingNotification(
  roomId: string,
  typing: boolean,
): void {
  client?.sendTyping(roomId, typing, typing ? 30000 : 0);
}

// ─── Helpers ─────────────────────────────────────────────────────────

function roomToChatRoom(room: Room): ChatRoom {
  const timeline = room.timeline.filter((e) => e.getType() === "m.room.message");
  const lastEvent = timeline[timeline.length - 1];
  const hsUrl = client?.getHomeserverUrl() ?? "";

  return {
    id: room.roomId,
    name: room.name || "Unnamed",
    topic: room.currentState
      .getStateEvents("m.room.topic", "")
      ?.getContent()?.topic,
    isSpace: room.isSpaceRoom(),
    isDirect: false, // Caller determines this
    unreadCount: (room as any).getUnreadNotificationCount?.("total") ?? 0,
    lastMessage: lastEvent ? eventToMessage(lastEvent) : undefined,
    memberCount: room.getJoinedMemberCount(),
    avatarUrl:
      room.getAvatarUrl(hsUrl, 40, 40, "crop") ?? undefined,
  };
}

function eventToMessage(event: MatrixEvent): ChatMessage {
  const hsUrl = client?.getHomeserverUrl() ?? "";
  const sender = event.sender;

  return {
    id: event.getId() ?? "",
    sender: event.getSender() ?? "",
    senderName: sender?.name ?? event.getSender() ?? "",
    avatarUrl: sender?.getAvatarUrl(hsUrl, 32, 32, "crop", false, false) ?? undefined,
    body: event.getContent()?.body ?? "",
    timestamp: event.getTs(),
    type: getMessageType(event),
  };
}

function getMessageType(event: MatrixEvent): "text" | "image" | "file" {
  const msgtype = event.getContent()?.msgtype;
  if (msgtype === "m.image") return "image";
  if (msgtype === "m.file") return "file";
  return "text";
}

// ─── Event Listeners ─────────────────────────────────────────────────

export function onRoomTimeline(
  callback: (roomId: string, message: ChatMessage) => void,
): () => void {
  if (!client) return () => {};

  const handler = (event: MatrixEvent, room: Room | undefined) => {
    if (event.getType() !== "m.room.message") return;
    if (!room) return;
    callback(room.roomId, eventToMessage(event));
  };

  client.on("Room.timeline" as any, handler);
  return () => client?.removeListener("Room.timeline" as any, handler);
}

export function onTyping(
  callback: (roomId: string, userIds: string[]) => void,
): () => void {
  if (!client) return () => {};

  const handler = (_event: MatrixEvent, member: any) => {
    if (!member?.roomId) return;
    const room = client?.getRoom(member.roomId);
    if (!room) return;
    const typingMembers = room.currentState
      .getStateEvents("m.typing", "")
      ?.getContent()?.user_ids ?? [];
    callback(member.roomId, typingMembers);
  };

  client.on("RoomMember.typing" as any, handler);
  return () => client?.removeListener("RoomMember.typing" as any, handler);
}
