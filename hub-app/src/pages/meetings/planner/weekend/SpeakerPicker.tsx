// hub-app/src/pages/meetings/planner/weekend/SpeakerPicker.tsx
import { useState, useEffect } from "react";
import { Search, X, User } from "lucide-react";
import type { Speaker, PublicTalk } from "./types";

interface SpeakerPickerProps {
  talk: PublicTalk;
  meetingId: string;
  apiUrl: string;
  headers: Record<string, string>;
  onScheduled: () => void;
  onClose: () => void;
}

export function SpeakerPicker({ talk, meetingId, apiUrl, headers, onScheduled, onClose }: SpeakerPickerProps) {
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/speakers`, { headers });
        if (res.ok) setSpeakers(await res.json());
      } finally {
        setLoading(false);
      }
    })();
  }, [apiUrl, headers]);

  const filtered = speakers.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = `${s.firstName} ${s.lastName}`.toLowerCase();
    return name.includes(q) || (s.congregationName?.toLowerCase().includes(q) ?? false);
  });

  const handleSelect = async (speaker: Speaker) => {
    setSubmitting(true);
    try {
      const res = await fetch(`${apiUrl}/public-talks/schedule`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          meetingId,
          publicTalkId: talk.id,
          speakerId: speaker.id,
          mode: speaker.isLocal ? "local" : "guest",
        }),
      });
      if (res.ok) {
        onScheduled();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[var(--bg-1)] rounded-[var(--radius)] p-4 w-full max-w-sm border border-[var(--border)] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-[var(--text)] text-sm">Redner auswahlen</h3>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
        <div className="text-[10px] text-[var(--text-muted)] mb-3">
          #{talk.talkNumber}: {talk.title}
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name oder Versammlung..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] placeholder:text-zinc-600 focus:outline-none focus:border-[var(--border-2)]"
          />
        </div>

        {/* Speaker list */}
        <div className="flex-1 overflow-y-auto space-y-0.5 min-h-0">
          {loading ? (
            <p className="text-sm text-[var(--text-muted)] py-4 text-center">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] py-4 text-center">Keine Redner gefunden</p>
          ) : (
            filtered.map((speaker) => (
              <button
                key={speaker.id}
                onClick={() => handleSelect(speaker)}
                disabled={submitting}
                className="w-full text-left px-3 py-2 rounded hover:bg-[var(--bg-2)] text-[var(--text)] cursor-pointer transition-colors flex items-center gap-2.5 disabled:opacity-50"
              >
                <User size={14} className="shrink-0 text-[var(--text-muted)]" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {speaker.displayName ?? `${speaker.firstName} ${speaker.lastName}`}
                  </div>
                  {speaker.congregationName && (
                    <div className="text-[10px] text-zinc-600 truncate">{speaker.congregationName}</div>
                  )}
                </div>
                <span className={`text-[8px] font-semibold px-1.5 py-px rounded-full ${speaker.isLocal ? "bg-[#14532d] text-[#86efac]" : "bg-[#1e3a5f] text-[#93c5fd]"}`}>
                  {speaker.isLocal ? "Lokal" : "Gast"}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Cancel */}
        <button
          onClick={onClose}
          className="mt-3 w-full px-3 py-1.5 border border-[var(--border)] rounded text-sm text-[var(--text-muted)] hover:bg-[var(--bg-2)] cursor-pointer"
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}
