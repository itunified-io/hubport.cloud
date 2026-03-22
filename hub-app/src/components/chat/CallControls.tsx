/**
 * CallControls — voice/video call overlay using self-hosted Jitsi Meet.
 * SEC-004 F-18: JWT auth + HMAC room names (no guest access, no predictable rooms).
 */
import { useState, useCallback } from "react";
import { Phone, Video, PhoneOff } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";

interface Props {
  roomId: string;
  roomName: string;
  isDirect: boolean;
}

function getJitsiUrl(): string {
  const config = (window as unknown as Record<string, unknown>).__HUBPORT_CONFIG__ as
    | { jitsiUrl?: string; chatUrl?: string }
    | undefined;
  return config?.jitsiUrl || config?.chatUrl?.replace("chat-", "meet-") || "";
}

export function CallControls({ roomId, roomName }: Props) {
  const { user } = useAuth();
  const [activeCall, setActiveCall] = useState<"voice" | "video" | null>(null);
  const [jitsiToken, setJitsiToken] = useState<string | null>(null);
  const [conference, setConference] = useState<string | null>(null);

  const startCall = useCallback(async (type: "voice" | "video") => {
    if (!getJitsiUrl() || !user?.access_token) return;
    try {
      const res = await fetch(`${getApiUrl()}/meetings/jitsi-token`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${user.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roomId }),
      });
      if (!res.ok) return;
      const { token, room } = (await res.json()) as { token: string; room: string };
      setJitsiToken(token);
      setConference(room);
      setActiveCall(type);
    } catch {
      // Silently fail — button stays inactive
    }
  }, [user?.access_token, roomId]);

  const endCall = useCallback(() => {
    setActiveCall(null);
    setJitsiToken(null);
    setConference(null);
  }, []);

  const jitsiUrl = getJitsiUrl();
  const jitsiParams = activeCall && jitsiToken
    ? [
        `?jwt=${jitsiToken}`,
        `#config.startWithAudioOnly=${activeCall === "voice"}`,
        `&config.prejoinConfig.enabled=false`,
        `&config.disableDeepLinking=true`,
        `&config.toolbarButtons=["microphone","camera","hangup","chat","tileview"]`,
      ].join("")
    : "";

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
      {activeCall && jitsiUrl && conference && (
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
