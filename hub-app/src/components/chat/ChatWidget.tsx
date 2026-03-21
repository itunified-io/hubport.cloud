/**
 * LinkedIn-style chat widget — bottom-right popup.
 * States: collapsed (bubble), expanded (conversation list), thread (messages).
 * Full-screen overlay on mobile (< 768px).
 */
import { useState, useEffect, useCallback } from "react";
import { MessageCircle, X, Minimize2 } from "lucide-react";
import { ConversationList } from "./ConversationList";
import { MessageThread } from "./MessageThread";
import {
  initMatrixClient,
  stopMatrixClient,
  getMatrixClient,
  onRoomTimeline,
  type ChatRoom,
  type ChatMessage,
} from "@/lib/matrix-client";
import { useAuth } from "@/auth/useAuth";

type WidgetState = "collapsed" | "list" | "thread";

export function ChatWidget() {
  const { user } = useAuth();
  const accessToken = user?.access_token;
  const [state, setState] = useState<WidgetState>("collapsed");
  const [activeRoom, setActiveRoom] = useState<ChatRoom | null>(null);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [matrixReady, setMatrixReady] = useState(false);

  // Get Matrix homeserver URL from runtime config
  const config = (window as any).__HUBPORT_CONFIG__;
  const matrixUrl = config?.chatUrl
    ? config.chatUrl.replace("chat-", "matrix-")
    : null;
  const userId = config?.rpId
    ? `@${accessToken ? "user" : "anon"}:${config.rpId}`
    : null;

  // Listen for header toggle event
  useEffect(() => {
    const handler = () => {
      setState((s) => (s === "collapsed" ? "list" : "collapsed"));
    };
    window.addEventListener("hubport:toggle-chat", handler);
    return () => window.removeEventListener("hubport:toggle-chat", handler);
  }, []);

  // Init Matrix client
  useEffect(() => {
    if (!matrixUrl || !accessToken) return;

    // Matrix SSO: exchange OIDC token for Matrix access token
    // For now, use the Keycloak access token directly (Synapse OIDC handles this)
    initMatrixClient(matrixUrl, accessToken, userId ?? "")
      .then(() => setMatrixReady(true))
      .catch((err) => console.warn("[chat] Matrix init failed:", err));

    return () => {
      stopMatrixClient();
    };
  }, [matrixUrl, accessToken, userId]);

  // Listen for new messages (unread count)
  useEffect(() => {
    if (!matrixReady) return;
    const unsub = onRoomTimeline((_roomId: string, _msg: ChatMessage) => {
      // Update unread count
      const client = getMatrixClient();
      if (!client) return;
      const rooms = client.getRooms().filter((r) => r.getMyMembership() === "join");
      const total = rooms.reduce(
        (sum, r) => sum + ((r as any).getUnreadNotificationCount?.("total") ?? 0),
        0,
      );
      setUnreadTotal(total);
    });
    return unsub;
  }, [matrixReady]);

  const handleOpenRoom = useCallback((room: ChatRoom) => {
    setActiveRoom(room);
    setState("thread");
  }, []);

  const handleBack = useCallback(() => {
    setActiveRoom(null);
    setState("list");
  }, []);

  // Don't render if no Matrix URL configured
  if (!matrixUrl) return null;

  // Collapsed: floating amber bubble
  if (state === "collapsed") {
    return (
      <button
        onClick={() => setState("list")}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full flex items-center justify-center cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95"
        style={{
          background: "linear-gradient(135deg, #d97706, #b45309)",
          boxShadow: "0 4px 20px rgba(217, 119, 6, 0.35), 0 0 0 1px rgba(255,255,255,0.05)",
        }}
        title="Chat öffnen"
      >
        <MessageCircle size={22} className="text-white" />
        {unreadTotal > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full text-[10px] font-bold text-white"
            style={{ background: "#ef4444", boxShadow: "0 2px 4px rgba(239,68,68,0.4)" }}
          >
            {unreadTotal > 99 ? "99+" : unreadTotal}
          </span>
        )}
      </button>
    );
  }

  // Expanded: popup widget
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  return (
    <div
      className={`fixed z-50 flex flex-col ${
        isMobile
          ? "inset-0"
          : "bottom-0 right-6 w-[400px] max-h-[600px]"
      }`}
      style={{
        borderRadius: isMobile ? 0 : "16px 16px 0 0",
        border: isMobile ? "none" : "1px solid rgba(255,255,255,0.06)",
        background: "rgba(10, 10, 12, 0.97)",
        backdropFilter: "blur(20px)",
        boxShadow: isMobile
          ? "none"
          : "0 -12px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.03)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b shrink-0"
        style={{
          borderColor: "rgba(255,255,255,0.04)",
          background: "linear-gradient(135deg, rgba(24,24,27,0.95), rgba(20,20,24,0.98))",
          borderRadius: isMobile ? 0 : "16px 16px 0 0",
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, #d97706, #b45309)",
              boxShadow: "0 2px 8px rgba(217,119,6,0.3)",
            }}
          >
            <MessageCircle size={15} className="text-white" />
          </div>
          <span className="text-[var(--text)] font-semibold text-sm tracking-tight">
            Nachrichten
          </span>
          {unreadTotal > 0 && (
            <span
              className="text-[10px] font-bold text-white px-2 py-0.5 rounded-full"
              style={{
                background: "linear-gradient(135deg, #d97706, #b45309)",
                boxShadow: "0 1px 4px rgba(217,119,6,0.3)",
              }}
            >
              {unreadTotal}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {state === "thread" && (
            <button
              onClick={handleBack}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
              style={{ background: "rgba(255,255,255,0.04)" }}
            >
              <Minimize2 size={13} />
            </button>
          )}
          <button
            onClick={() => {
              setState("collapsed");
              setActiveRoom(null);
            }}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {state === "list" && (
          <ConversationList
            onOpenRoom={handleOpenRoom}
            matrixReady={matrixReady}
          />
        )}
        {state === "thread" && activeRoom && (
          <MessageThread room={activeRoom} onBack={handleBack} />
        )}
      </div>
    </div>
  );
}
