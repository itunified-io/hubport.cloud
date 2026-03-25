// hub-app/src/pages/meetings/planner/weekend/TalkPicker.tsx
import { useState, useEffect } from "react";
import { Search, X } from "lucide-react";
import type { PublicTalk } from "./types";

interface TalkPickerProps {
  apiUrl: string;
  headers: Record<string, string>;
  onSelect: (talk: PublicTalk) => void;
  onClose: () => void;
}

export function TalkPicker({ apiUrl, headers, onSelect, onClose }: TalkPickerProps) {
  const [talks, setTalks] = useState<PublicTalk[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/public-talks`, { headers });
        if (res.ok) setTalks(await res.json());
      } finally {
        setLoading(false);
      }
    })();
  }, [apiUrl, headers]);

  const filtered = talks.filter((t) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      String(t.talkNumber).includes(q) ||
      t.title.toLowerCase().includes(q)
    );
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[var(--bg-1)] rounded-[var(--radius)] p-4 w-full max-w-md border border-[var(--border)] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-[var(--text)] text-sm">Vortrag auswahlen</h3>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nummer oder Titel suchen..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] placeholder:text-zinc-600 focus:outline-none focus:border-[var(--border-2)]"
          />
        </div>

        {/* Talk list */}
        <div className="flex-1 overflow-y-auto space-y-0.5 min-h-0">
          {loading ? (
            <p className="text-sm text-[var(--text-muted)] py-4 text-center">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] py-4 text-center">Keine Vortrage gefunden</p>
          ) : (
            filtered.map((talk) => (
              <button
                key={talk.id}
                onClick={() => onSelect(talk)}
                className="w-full text-left px-3 py-2 rounded hover:bg-[var(--bg-2)] text-[var(--text)] cursor-pointer transition-colors"
              >
                <span className="text-[10px] font-bold text-[#047857] mr-2">#{talk.talkNumber}</span>
                <span className="text-sm">{talk.title}</span>
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
