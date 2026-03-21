/**
 * Message thread — right panel of the chat widget.
 * Shows message bubbles (sender left, own right) with avatars.
 */
import { useState, useEffect, useRef } from "react";
import { MessageInput } from "./MessageInput";
import { CallControls } from "./CallControls";
import {
  getRoomMessages,
  sendMessage,
  sendTypingNotification,
  onRoomTimeline,
  getMatrixClient,
  type ChatRoom,
  type ChatMessage,
} from "@/lib/matrix-client";

interface Props {
  room: ChatRoom;
  onBack: () => void;
}

export function MessageThread({ room }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const client = getMatrixClient();
  const myUserId = client?.getUserId() ?? "";

  // Load messages
  useEffect(() => {
    setMessages(getRoomMessages(room.id));
  }, [room.id]);

  // Listen for new messages
  useEffect(() => {
    const unsub = onRoomTimeline((roomId, msg) => {
      if (roomId === room.id) {
        setMessages((prev) => [...prev, msg]);
      }
    });
    return unsub;
  }, [room.id]);

  // Scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const handleSend = async (text: string) => {
    await sendMessage(room.id, text);
    sendTypingNotification(room.id, false);
  };

  const handleTyping = (typing: boolean) => {
    sendTypingNotification(room.id, typing);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div
        className="flex items-center gap-3 px-4 py-2.5 border-b shrink-0"
        style={{ borderColor: "rgba(255,255,255,0.04)" }}
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[11px] font-semibold"
          style={{
            background: room.isDirect ? "rgba(34,197,94,0.15)" : "rgba(217,119,6,0.15)",
            color: room.isDirect ? "#22c55e" : "#d97706",
          }}
        >
          {room.name
            .split(" ")
            .map((w) => w[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-[var(--text)] truncate">{room.name}</p>
          <p className="text-[10px] text-[var(--text-muted)]">
            {room.memberCount} Mitglieder
          </p>
        </div>
        <CallControls roomId={room.id} roomName={room.name} isDirect={room.isDirect} />
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3"
        style={{ background: "rgba(5,5,7,0.5)" }}
      >
        {messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-xs text-[var(--text-muted)]">Noch keine Nachrichten</p>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isOwn={msg.sender === myUserId}
            />
          ))
        )}
      </div>

      {/* Input */}
      <MessageInput onSend={handleSend} onTyping={handleTyping} />
    </div>
  );
}

function MessageBubble({
  message,
  isOwn,
}: {
  message: ChatMessage;
  isOwn: boolean;
}) {
  const initials = message.senderName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const time = new Date(message.timestamp).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`flex gap-2 ${isOwn ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10px] font-semibold mt-0.5"
        style={{
          background: isOwn ? "rgba(217,119,6,0.15)" : "rgba(34,197,94,0.15)",
          color: isOwn ? "#d97706" : "#22c55e",
        }}
      >
        {message.avatarUrl ? (
          <img src={message.avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
        ) : (
          initials
        )}
      </div>

      {/* Bubble */}
      <div className={isOwn ? "text-right" : ""}>
        <p className="text-[10px] text-[var(--text-muted)] mb-0.5">
          {isOwn ? "Du" : message.senderName.split(" ")[0]} · {time}
        </p>
        <div
          className="px-3 py-2 text-xs text-[var(--text)] max-w-[260px] inline-block"
          style={{
            background: isOwn ? "rgba(217,119,6,0.1)" : "rgba(255,255,255,0.04)",
            borderRadius: isOwn ? "12px 0 12px 12px" : "0 12px 12px 12px",
            textAlign: "left",
          }}
        >
          {message.body}
        </div>
      </div>
    </div>
  );
}
