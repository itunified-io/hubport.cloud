import { useState, useEffect } from "react";
import {
  Users,
  LogIn,
  LogOut,
  Clock,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";

interface FieldGroup {
  id: string;
  name: string | null;
  status: string;
  memberIds: string[];
  sessionDate: string | null;
  sessionTime: string | null;
  meetingPointId: string;
}

interface FieldGroupJoinProps {
  /** Current publisher's ID */
  publisherId: string;
  /** Active campaign's meeting point IDs to list field groups from */
  meetingPointIds: string[];
}

export function FieldGroupJoin({ publisherId, meetingPointIds }: FieldGroupJoinProps) {
  const { user } = useAuth();
  const apiUrl = getApiUrl();
  const headers: HeadersInit = { Authorization: `Bearer ${user?.access_token}`, "Content-Type": "application/json" };

  const [groups, setGroups] = useState<FieldGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    const fetchGroups = async () => {
      // Fetch field groups from each meeting point's campaign detail
      // For now, we'll rely on the parent providing field groups
      // This component is shown within a campaign context
      setLoading(false);
    };
    fetchGroups();
  }, [meetingPointIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleJoin = async (fgId: string) => {
    setActionLoading(fgId);
    try {
      const fg = groups.find((g) => g.id === fgId);
      if (!fg) return;
      const updatedMembers = [...fg.memberIds, publisherId];
      await fetch(`${apiUrl}/field-groups/${fgId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ memberIds: updatedMembers }),
      });
      setGroups((prev) =>
        prev.map((g) =>
          g.id === fgId ? { ...g, memberIds: updatedMembers } : g,
        ),
      );
    } catch {
      // silently fail
    } finally {
      setActionLoading(null);
    }
  };

  const handleLeave = async (fgId: string) => {
    setActionLoading(fgId);
    try {
      const fg = groups.find((g) => g.id === fgId);
      if (!fg) return;
      const updatedMembers = fg.memberIds.filter((id) => id !== publisherId);
      await fetch(`${apiUrl}/field-groups/${fgId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ memberIds: updatedMembers }),
      });
      setGroups((prev) =>
        prev.map((g) =>
          g.id === fgId ? { ...g, memberIds: updatedMembers } : g,
        ),
      );
    } catch {
      // silently fail
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-16 bg-[var(--glass-2)] rounded-[var(--radius-sm)] animate-pulse" />
        ))}
      </div>
    );
  }

  const openGroups = groups.filter((g) => g.status === "open" || g.status === "in_field");

  if (openGroups.length === 0) {
    return (
      <div className="py-6 text-center border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
        <Users size={24} className="text-[var(--text-muted)] mx-auto mb-2" strokeWidth={1.2} />
        <p className="text-sm text-[var(--text-muted)]">No open field groups right now.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
        Available Field Groups
      </h4>
      {openGroups.map((fg) => {
        const isMember = fg.memberIds.includes(publisherId);
        const isLoading = actionLoading === fg.id;

        return (
          <div
            key={fg.id}
            className="flex items-center gap-3 p-3 border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--bg-1)]"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Users size={12} className="text-[var(--text-muted)]" />
                <span className="text-xs font-medium text-[var(--text)]">
                  {fg.name ?? "Field Group"}
                </span>
                {fg.status === "in_field" && (
                  <span className="text-[9px] text-[var(--green)] bg-[#22c55e14] px-1.5 py-0.5 rounded-full">
                    In field
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-[10px] text-[var(--text-muted)]">
                <span className="flex items-center gap-1">
                  <Users size={9} /> {fg.memberIds.length} members
                </span>
                {fg.sessionTime && (
                  <span className="flex items-center gap-1">
                    <Clock size={9} /> {fg.sessionTime}
                  </span>
                )}
              </div>
            </div>
            <div>
              {isMember ? (
                <button
                  onClick={() => handleLeave(fg.id)}
                  disabled={isLoading}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[var(--red)] bg-[#ef444414] rounded hover:bg-[#ef444428] transition-colors disabled:opacity-40 cursor-pointer"
                >
                  <LogOut size={10} /> {isLoading ? "..." : "Leave"}
                </button>
              ) : (
                <button
                  onClick={() => handleJoin(fg.id)}
                  disabled={isLoading}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[var(--green)] bg-[#22c55e14] rounded hover:bg-[#22c55e28] transition-colors disabled:opacity-40 cursor-pointer"
                >
                  <LogIn size={10} /> {isLoading ? "..." : "Join"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
