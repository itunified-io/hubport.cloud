/**
 * Chat message input bar with send button and attachment hints.
 */
import { useState, useRef, useCallback } from "react";
import { Send, Paperclip, Smile, Image as ImageIcon } from "lucide-react";

interface Props {
  onSend: (text: string) => Promise<void>;
  onTyping: (typing: boolean) => void;
}

export function MessageInput({ onSend, onTyping }: Props) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleChange = (value: string) => {
    setText(value);
    onTyping(value.length > 0);
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => onTyping(false), 3000);
  };

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setText("");
      inputRef.current?.focus();
    } finally {
      setSending(false);
    }
  }, [text, sending, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      className="px-3 py-2.5 border-t shrink-0"
      style={{ borderColor: "rgba(255,255,255,0.04)" }}
    >
      <div
        className="flex items-end gap-2 rounded-xl px-3 py-2"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {/* Attachment buttons */}
        <div className="flex gap-0.5 pb-0.5">
          <button
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
            title="Bild"
          >
            <ImageIcon size={14} />
          </button>
          <button
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
            title="Datei"
          >
            <Paperclip size={14} />
          </button>
          <button
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
            title="Emoji"
          >
            <Smile size={14} />
          </button>
        </div>

        {/* Text input */}
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Nachricht verfassen..."
          rows={1}
          className="flex-1 bg-transparent border-none outline-none text-xs text-[var(--text)] placeholder-[var(--text-muted)] resize-none min-h-[24px] max-h-[96px] py-0.5"
          style={{ lineHeight: "1.5" }}
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            background: text.trim()
              ? "linear-gradient(135deg, #d97706, #b45309)"
              : "rgba(255,255,255,0.06)",
            color: text.trim() ? "#000" : "var(--text-muted)",
            boxShadow: text.trim() ? "0 1px 4px rgba(217,119,6,0.25)" : "none",
          }}
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  );
}
