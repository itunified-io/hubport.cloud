/**
 * Chat page — embeds Element Web (Matrix client) via iframe.
 * SSO is handled automatically by Keycloak OIDC (same session).
 * The chat URL is derived from the runtime config (WEBAUTHN_RP_ID domain).
 */
import { FormattedMessage } from "react-intl";
import { MessageCircle, ExternalLink } from "lucide-react";

function getChatUrl(): string | null {
  // Runtime config: window.__HUBPORT_CONFIG__.chatUrl (set by runtime-config.js)
  const config = (window as unknown as { __HUBPORT_CONFIG__?: { chatUrl?: string } }).__HUBPORT_CONFIG__;
  if (config?.chatUrl) return config.chatUrl;

  // Derive from RP_ID: pez-north-uat.hubport.cloud → chat-pez-north-uat.hubport.cloud
  const rpId = (window as unknown as { __HUBPORT_CONFIG__?: { rpId?: string } }).__HUBPORT_CONFIG__?.rpId;
  if (rpId) return `https://chat-${rpId}`;

  return null;
}

export function Chat() {
  const chatUrl = getChatUrl();

  if (!chatUrl) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <MessageCircle size={40} className="text-[var(--text-muted)] mb-3" strokeWidth={1.2} />
        <p className="text-sm text-[var(--text-muted)]">
          <FormattedMessage id="chat.notConfigured" />
        </p>
      </div>
    );
  }

  return (
    <div className="h-[calc(100dvh-4rem)] flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)]">
        <h1 className="text-sm font-medium text-[var(--text)] flex items-center gap-2">
          <MessageCircle size={16} className="text-[var(--amber)]" />
          <FormattedMessage id="nav.chat" />
        </h1>
        <a
          href={chatUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
        >
          <FormattedMessage id="chat.openExternal" />
          <ExternalLink size={12} />
        </a>
      </div>

      {/* Element iframe — full height */}
      <iframe
        src={chatUrl}
        title="Chat"
        className="flex-1 w-full border-0"
        allow="camera; microphone; display-capture; clipboard-write; clipboard-read"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
      />
    </div>
  );
}
