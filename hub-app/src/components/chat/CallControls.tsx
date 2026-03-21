/**
 * CallControls — voice/video call overlay using self-hosted Jitsi Meet.
 * Opens a full-screen modal with Jitsi iframe when a call is initiated.
 */
import { useState, useCallback } from "react";
import { Phone, Video, PhoneOff } from "lucide-react";

interface Props {
  roomId: string;
  roomName: string;
  isDirect: boolean;
}

/** Simple hash of room ID to create a valid Jitsi room name */
function roomIdToConference(roomId: string): string {
  let hash = 0;
  for (let i = 0; i < roomId.length; i++) {
    hash = ((hash << 5) - hash + roomId.charCodeAt(i)) | 0;
  }
  return `hubport-${Math.abs(hash).toString(36)}`;
}

function getJitsiUrl(): string {
  const config = (window as unknown as Record<string, unknown>).__HUBPORT_CONFIG__ as
    | { jitsiUrl?: string; chatUrl?: string }
    | undefined;
  return config?.jitsiUrl || config?.chatUrl?.replace("chat-", "meet-") || "";
}

export function CallControls({ roomId, roomName }: Props) {
  const [activeCall, setActiveCall] = useState<"voice" | "video" | null>(null);

  const startCall = useCallback((type: "voice" | "video") => {
    if (!getJitsiUrl()) return;
    setActiveCall(type);
  }, []);

  const endCall = useCallback(() => {
    setActiveCall(null);
  }, []);

  const conference = roomIdToConference(roomId);
  const jitsiUrl = getJitsiUrl();
  const jitsiParams = [
    `#config.startWithAudioOnly=${activeCall === "voice"}`,
    `&config.prejoinConfig.enabled=false`,
    `&config.disableDeepLinking=true`,
    `&config.toolbarButtons=["microphone","camera","hangup","chat","tileview"]`,
    `&userInfo.displayName=${encodeURIComponent(roomName)}`,
  ].join("");

  return (
    <>
      {/* Call buttons in header */}
      <div className="flex gap-1">
        <button
          onClick={() => startCall("voice")}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
          style={{ background: "rgba(255,255,255,0.04)" }}
          title="Anrufen"
        >
          <Phone size={13} />
        </button>
        <button
          onClick={() => startCall("video")}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
          style={{ background: "rgba(255,255,255,0.04)" }}
          title="Videoanruf"
        >
          <Video size={13} />
        </button>
      </div>

      {/* Call modal overlay */}
      {activeCall && jitsiUrl && (
        <div
          className="fixed inset-0 z-[9999] flex flex-col"
          style={{ background: "#050507" }}
        >
          {/* Call header */}
          <div
            className="flex items-center justify-between px-4 py-3 shrink-0"
            style={{
              background: "rgba(255,255,255,0.02)",
              borderBottom: "1px solid rgba(255,255,255,0.04)",
            }}
          >
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm font-medium text-[#e4e4e7]">
                {activeCall === "voice" ? "Sprachanruf" : "Videoanruf"} —{" "}
                {roomName}
              </span>
            </div>
            <button
              onClick={endCall}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
            >
              <PhoneOff size={14} />
              <span className="text-xs font-medium">Auflegen</span>
            </button>
          </div>

          {/* Jitsi iframe */}
          <iframe
            src={`${jitsiUrl}/${conference}${jitsiParams}`}
            className="flex-1 w-full border-0"
            allow="camera; microphone; display-capture; autoplay; clipboard-write"
            allowFullScreen
          />
        </div>
      )}
    </>
  );
}
