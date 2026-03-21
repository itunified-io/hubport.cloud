/**
 * Collapsible space/channel tree for the Spaces tab.
 * Renders pre-seeded spaces with nested channels and RBAC badges.
 */
import { useState } from "react";
import { ChevronDown, Lock } from "lucide-react";
import type { ChatSpace, ChatRoom } from "@/lib/matrix-client";

interface Props {
  spaces: ChatSpace[];
  onOpenRoom: (room: ChatRoom) => void;
}

export function SpaceTree({ spaces, onOpenRoom }: Props) {
  if (spaces.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
        <p className="text-xs">Keine Spaces verfügbar</p>
      </div>
    );
  }

  return (
    <div className="py-1">
      {spaces.map((space, i) => (
        <SpaceSection
          key={space.id}
          space={space}
          onOpenRoom={onOpenRoom}
          showDivider={i > 0}
        />
      ))}
    </div>
  );
}

function SpaceSection({
  space,
  onOpenRoom,
  showDivider,
}: {
  space: ChatSpace;
  onOpenRoom: (room: ChatRoom) => void;
  showDivider: boolean;
}) {
  const [expanded, setExpanded] = useState(true);

  const spaceColors: Record<string, { bg: string; text: string; border: string }> = {
    "🏛️": { bg: "rgba(217,119,6,0.08)", text: "#d97706", border: "rgba(217,119,6,0.15)" },
    "⚙️": { bg: "rgba(59,130,246,0.08)", text: "#3b82f6", border: "rgba(59,130,246,0.15)" },
    "📋": { bg: "rgba(34,197,94,0.08)", text: "#22c55e", border: "rgba(34,197,94,0.15)" },
    "🌐": { bg: "rgba(245,158,11,0.08)", text: "#f59e0b", border: "rgba(245,158,11,0.15)" },
  };
  const colors = spaceColors[space.icon ?? "💬"] ?? { bg: "rgba(217,119,6,0.08)", text: "#d97706", border: "rgba(217,119,6,0.15)" };

  return (
    <>
      {showDivider && (
        <div
          className="mx-3.5 my-1"
          style={{ height: 1, background: "rgba(255,255,255,0.03)" }}
        />
      )}
      <div className="px-3.5 py-1">
        {/* Space header */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2.5 py-2 cursor-pointer group"
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{
              background: `linear-gradient(135deg, ${colors.bg}, transparent)`,
              border: `1px solid ${colors.border}`,
            }}
          >
            <span className="text-sm">{space.icon}</span>
          </div>
          <span
            className="text-[13px] font-semibold flex-1 text-left"
            style={{ color: "var(--text)", letterSpacing: "-0.01em" }}
          >
            {space.name}
          </span>
          {space.unreadTotal > 0 && (
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded-md"
              style={{ background: colors.text, color: "#fff" }}
            >
              {space.unreadTotal}
            </span>
          )}
          <ChevronDown
            size={10}
            className="text-[var(--text-muted)] transition-transform"
            style={{ transform: expanded ? "rotate(0)" : "rotate(-90deg)" }}
          />
        </button>

        {/* Channels */}
        {expanded && (
          <div className="ml-10 flex flex-col gap-px mb-1">
            {space.children.map((room) => (
              <ChannelItem key={room.id} room={room} onClick={() => onOpenRoom(room)} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ChannelItem({
  room,
  onClick,
}: {
  room: ChatRoom;
  onClick: () => void;
}) {
  const isPrivate = room.name.toLowerCase().includes("älteste") || room.name.toLowerCase().includes("elder");

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[rgba(255,255,255,0.04)] transition-colors cursor-pointer text-left"
      style={
        room.unreadCount > 0
          ? { background: "rgba(217,119,6,0.06)", border: "1px solid rgba(217,119,6,0.1)" }
          : {}
      }
    >
      {isPrivate ? (
        <Lock size={11} className="text-[#a855f7] shrink-0" />
      ) : (
        <span className="text-[11px] font-semibold text-[var(--text-muted)] shrink-0 w-3 text-center">
          #
        </span>
      )}
      <span
        className="text-xs flex-1 truncate"
        style={{ color: room.unreadCount > 0 ? "var(--text)" : "var(--text-muted)" }}
      >
        {room.name}
      </span>
      {room.unreadCount > 0 && (
        <span className="text-[9px] font-bold px-1.5 py-px rounded-md bg-[#d97706] text-black shrink-0">
          {room.unreadCount}
        </span>
      )}
    </button>
  );
}
