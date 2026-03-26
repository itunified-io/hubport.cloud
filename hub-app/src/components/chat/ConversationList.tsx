/**
 * Chat conversation list — left panel of the widget.
 * Tabs: Alle | Spaces | DMs | Ungelesen
 * Space tree with collapsible sections and RBAC badges.
 * "+" button opens NewDMPicker (requires CHAT_SEND permission).
 */
import { useState, useMemo } from "react";
import { Search, Plus } from "lucide-react";
import { SpaceTree } from "./SpaceTree";
import { NewDMPicker } from "./NewDMPicker";
import { usePermissions } from "@/auth/PermissionProvider";
import {
  getRooms,
  getSpaces,
  getDMs,
  type ChatRoom,
} from "@/lib/matrix-client";

type Tab = "all" | "spaces" | "dms" | "unread";

interface Props {
  onOpenRoom: (room: ChatRoom) => void;
  matrixReady: boolean;
}

export function ConversationList({ onOpenRoom, matrixReady }: Props) {
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [showDMPicker, setShowDMPicker] = useState(false);
  const { can } = usePermissions();
  const canSend = can("app:chat.send");

  const rooms = useMemo(() => (matrixReady ? getRooms() : []), [matrixReady]);
  const spaces = useMemo(() => (matrixReady ? getSpaces() : []), [matrixReady]);
  const dms = useMemo(() => (matrixReady ? getDMs() : []), [matrixReady]);

  const filteredRooms = useMemo(() => {
    let list: ChatRoom[];
    switch (tab) {
      case "spaces":
        return []; // Handled by SpaceTree
      case "dms":
        list = dms;
        break;
      case "unread":
        list = rooms.filter((r) => r.unreadCount > 0);
        break;
      default:
        list = rooms;
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((r) => r.name.toLowerCase().includes(q));
    }
    return list;
  }, [tab, rooms, dms, search]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "all", label: "Alle" },
    { key: "spaces", label: "Spaces" },
    { key: "dms", label: "DMs" },
    { key: "unread", label: "Ungelesen" },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-3 py-2 border-b" style={{ borderColor: "rgba(255,255,255,0.03)" }}>
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <Search size={13} className="text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Suchen..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent border-none outline-none text-xs text-[var(--text)] placeholder-[var(--text-muted)] w-full"
          />
        </div>
      </div>

      {/* Tabs — pill style + New DM button */}
      <div
        className="flex items-center gap-1 px-3 py-2 border-b"
        style={{ borderColor: "rgba(255,255,255,0.03)" }}
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="px-3 py-1 rounded-lg text-[11px] font-medium cursor-pointer transition-all"
            style={
              tab === t.key
                ? {
                    background: "linear-gradient(135deg, #d97706, #b45309)",
                    color: "#000",
                    fontWeight: 600,
                    boxShadow: "0 1px 4px rgba(217,119,6,0.25)",
                  }
                : {
                    background: "rgba(255,255,255,0.03)",
                    color: "var(--text-muted)",
                  }
            }
          >
            {t.label}
          </button>
        ))}
        {/* New DM button — only shown if user has CHAT_SEND permission */}
        {canSend && (
          <button
            onClick={() => setShowDMPicker(true)}
            className="ml-auto w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer transition-all hover:scale-105"
            style={{
              background: "linear-gradient(135deg, #d97706, #b45309)",
              boxShadow: "0 1px 4px rgba(217,119,6,0.25)",
            }}
            title="Neue Nachricht"
          >
            <Plus size={14} className="text-white" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto relative">
        {tab === "spaces" ? (
          <SpaceTree spaces={spaces} onOpenRoom={onOpenRoom} />
        ) : filteredRooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
            <MessageCircleOff size={24} className="mb-2 opacity-40" />
            <p className="text-xs">Keine Nachrichten</p>
          </div>
        ) : (
          filteredRooms.map((room) => (
            <ConversationItem
              key={room.id}
              room={room}
              onClick={() => onOpenRoom(room)}
            />
          ))
        )}

        {/* New DM Picker overlay */}
        <NewDMPicker
          open={showDMPicker}
          onClose={() => setShowDMPicker(false)}
          onDMCreated={(roomId, targetName) => {
            setShowDMPicker(false);
            // Open the newly created DM thread
            onOpenRoom({
              id: roomId,
              name: targetName,
              isDirect: true,
              isSpace: false,
              unreadCount: 0,
              memberCount: 2,
            });
          }}
        />
      </div>
    </div>
  );
}

function MessageCircleOff({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className={className}
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function ConversationItem({
  room,
  onClick,
}: {
  room: ChatRoom;
  onClick: () => void;
}) {
  const initials = room.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const timeStr = room.lastMessage
    ? formatTime(room.lastMessage.timestamp)
    : "";

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[rgba(255,255,255,0.03)] transition-colors cursor-pointer text-left"
      style={
        room.unreadCount > 0
          ? { borderLeft: "3px solid #d97706", background: "rgba(217,119,6,0.04)" }
          : {}
      }
    >
      {/* Avatar */}
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold"
        style={{
          background: room.isDirect
            ? "rgba(34,197,94,0.15)"
            : "rgba(217,119,6,0.15)",
          color: room.isDirect ? "#22c55e" : "#d97706",
        }}
      >
        {room.avatarUrl ? (
          <img
            src={room.avatarUrl}
            alt=""
            className="w-9 h-9 rounded-full object-cover"
          />
        ) : (
          initials
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span
            className="text-xs font-medium truncate"
            style={{ color: "var(--text)" }}
          >
            {room.name}
          </span>
          <span className="text-[10px] text-[var(--text-muted)] shrink-0 ml-2">
            {timeStr}
          </span>
        </div>
        {room.lastMessage && (
          <p className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
            {room.lastMessage.senderName.split(" ")[0]}:{" "}
            {room.lastMessage.body}
          </p>
        )}
      </div>

      {/* Unread badge */}
      {room.unreadCount > 0 && (
        <span
          className="shrink-0 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full text-[9px] font-bold"
          style={{
            background: "#d97706",
            color: "#000",
          }}
        >
          {room.unreadCount}
        </span>
      )}
    </button>
  );
}

function formatTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Jetzt";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Gestern";
  if (days < 7) return `${days}T`;
  return new Date(ts).toLocaleDateString("de-DE", { day: "numeric", month: "short" });
}
