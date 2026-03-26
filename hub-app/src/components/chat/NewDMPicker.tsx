/**
 * New DM Picker — modal for selecting a publisher to start a direct message.
 * Fetches the member list from hub-api and lets the user search + select.
 */
import { useState, useEffect, useMemo } from "react";
import { Search, X, MessageCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";
import { useIntl } from "react-intl";

interface Member {
  id: string;
  name: string;
  avatarUrl?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onDMCreated: (roomId: string, targetName: string) => void;
}

export function NewDMPicker({ open, onClose, onDMCreated }: Props) {
  const { user } = useAuth();
  const intl = useIntl();
  const apiUrl = getApiUrl();
  const [members, setMembers] = useState<Member[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);

  // Fetch members when opened
  useEffect(() => {
    if (!open || !user?.access_token) return;
    setLoading(true);
    fetch(`${apiUrl}/chat/members`, {
      headers: { Authorization: `Bearer ${user.access_token}` },
    })
      .then((r) => r.json())
      .then((data) => setMembers(data as Member[]))
      .catch(() => setMembers([]))
      .finally(() => setLoading(false));
  }, [open, apiUrl, user?.access_token]);

  const filtered = useMemo(() => {
    if (!search) return members;
    const q = search.toLowerCase();
    return members.filter((m) => m.name.toLowerCase().includes(q));
  }, [members, search]);

  const handleSelect = async (member: Member) => {
    if (!user?.access_token || creating) return;
    setCreating(member.id);
    try {
      const res = await fetch(`${apiUrl}/chat/dm`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${user.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ targetPublisherId: member.id }),
      });
      if (res.ok) {
        const data = (await res.json()) as { roomId: string; targetName: string };
        onDMCreated(data.roomId, data.targetName);
        onClose();
      }
    } catch {
      // Silently fail — user can retry
    } finally {
      setCreating(null);
    }
  };

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-10 flex flex-col" style={{ background: "rgba(10, 10, 12, 0.98)" }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b shrink-0"
        style={{ borderColor: "rgba(255,255,255,0.04)" }}
      >
        <span className="text-sm font-semibold text-[var(--text)]">
          {intl.formatMessage({ id: "chat.dm.picker.title", defaultMessage: "Neue Nachricht" })}
        </span>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
          style={{ background: "rgba(255,255,255,0.04)" }}
        >
          <X size={13} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b" style={{ borderColor: "rgba(255,255,255,0.03)" }}>
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <Search size={13} className="text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder={intl.formatMessage({ id: "chat.dm.picker.search", defaultMessage: "Suchen..." })}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent border-none outline-none text-xs text-[var(--text)] placeholder-[var(--text-muted)] w-full"
            autoFocus
          />
        </div>
      </div>

      {/* Member list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-[var(--text-muted)]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
            <p className="text-xs">Keine Personen gefunden</p>
          </div>
        ) : (
          filtered.map((member) => (
            <button
              key={member.id}
              onClick={() => handleSelect(member)}
              disabled={creating !== null}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[rgba(255,255,255,0.03)] transition-colors cursor-pointer text-left disabled:opacity-50"
            >
              {/* Avatar */}
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold"
                style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}
              >
                {member.avatarUrl ? (
                  <img src={member.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
                ) : (
                  member.name
                    .split(" ")
                    .map((w) => w[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()
                )}
              </div>

              {/* Name */}
              <span className="text-xs font-medium text-[var(--text)] flex-1">{member.name}</span>

              {/* Creating indicator */}
              {creating === member.id ? (
                <Loader2 size={14} className="animate-spin text-[#d97706]" />
              ) : (
                <MessageCircle size={14} className="text-[var(--text-muted)]" />
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
