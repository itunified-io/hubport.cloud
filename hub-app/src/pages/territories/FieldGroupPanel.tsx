import { useState } from "react";
import {
  Users,
  Plus,
  Play,
  Square,
  X,
  Save,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { usePermissions } from "@/auth/PermissionProvider";
import { getApiUrl } from "@/lib/config";

interface FieldGroup {
  id: string;
  name: string | null;
  status: string;
  memberIds: string[];
  territoryIds: string[];
  sessionDate: string | null;
  sessionTime: string | null;
  startedAt: string | null;
  closedAt: string | null;
  notes: string | null;
}

interface FieldGroupPanelProps {
  meetingPointId: string;
  fieldGroups: FieldGroup[];
  onRefresh: () => void;
}

const STATUS_STYLES: Record<string, string> = {
  open: "text-[var(--blue)] bg-[#3b82f614]",
  in_field: "text-[var(--green)] bg-[#22c55e14]",
  closed: "text-[var(--text-muted)] bg-[var(--glass)]",
};

export function FieldGroupPanel({ meetingPointId, fieldGroups, onRefresh }: FieldGroupPanelProps) {
  const { user } = useAuth();
  const { can } = usePermissions();
  const apiUrl = getApiUrl();
  const headers: HeadersInit = { Authorization: `Bearer ${user?.access_token}`, "Content-Type": "application/json" };
  const canConduct = can("app:campaigns.conduct");

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [sessionDate, setSessionDate] = useState("");
  const [sessionTime, setSessionTime] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    setSaving(true);
    try {
      await fetch(`${apiUrl}/meeting-points/${meetingPointId}/field-groups`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: name || undefined,
          sessionDate: sessionDate || undefined,
          sessionTime: sessionTime || undefined,
          notes: notes || undefined,
        }),
      });
      setShowCreate(false);
      setName("");
      setSessionDate("");
      setSessionTime("");
      setNotes("");
      onRefresh();
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (fgId: string, action: "start" | "close") => {
    try {
      await fetch(`${apiUrl}/field-groups/${fgId}/${action}`, {
        method: "POST",
        headers,
      });
      onRefresh();
    } catch {
      // silently fail
    }
  };

  if (!canConduct) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
          Field Groups
        </h4>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[var(--amber)] border border-dashed border-[var(--amber)] rounded hover:bg-[#d9770614] transition-colors cursor-pointer"
          >
            <Plus size={10} /> New Group
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="p-3 border border-[var(--amber)] rounded-[var(--radius-sm)] bg-[var(--bg-2)] space-y-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Group name (optional)"
            className="w-full px-3 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              className="px-2 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
            />
            <input
              type="time"
              value={sessionTime}
              onChange={(e) => setSessionTime(e.target.value)}
              className="px-2 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
            />
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Notes..."
            className="w-full px-3 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)] resize-none"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowCreate(false)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-[var(--text-muted)] border border-[var(--border)] rounded hover:bg-[var(--glass)] transition-colors cursor-pointer"
            >
              <X size={10} /> Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={saving}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold bg-[var(--amber)] text-black rounded hover:bg-[var(--amber-light)] transition-colors disabled:opacity-40 cursor-pointer"
            >
              <Save size={10} /> {saving ? "..." : "Create"}
            </button>
          </div>
        </div>
      )}

      {/* Field group list */}
      {fieldGroups.map((fg) => (
        <div key={fg.id} className="p-3 border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--bg-2)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users size={12} className="text-[var(--text-muted)]" />
              <span className="text-xs font-medium text-[var(--text)]">
                {fg.name ?? "Field Group"}
              </span>
              <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-medium ${STATUS_STYLES[fg.status] ?? ""}`}>
                {fg.status.replace("_", " ")}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {fg.status === "open" && canConduct && (
                <button
                  onClick={() => handleAction(fg.id, "start")}
                  className="p-1 rounded text-[var(--green)] hover:bg-[#22c55e14] transition-colors cursor-pointer"
                  title="Start (go to field)"
                >
                  <Play size={12} />
                </button>
              )}
              {fg.status === "in_field" && canConduct && (
                <button
                  onClick={() => handleAction(fg.id, "close")}
                  className="p-1 rounded text-[var(--red)] hover:bg-[#ef444414] transition-colors cursor-pointer"
                  title="Close group"
                >
                  <Square size={12} />
                </button>
              )}
            </div>
          </div>
          <div className="mt-1 text-[10px] text-[var(--text-muted)] space-y-0.5">
            <p>{fg.memberIds.length} members</p>
            {fg.sessionDate && <p>Date: {new Date(fg.sessionDate).toLocaleDateString()}</p>}
            {fg.sessionTime && <p>Time: {fg.sessionTime}</p>}
            {fg.notes && <p className="italic">{fg.notes}</p>}
          </div>
        </div>
      ))}

      {fieldGroups.length === 0 && !showCreate && (
        <p className="text-xs text-[var(--text-muted)] text-center py-3">
          No field groups yet.
        </p>
      )}
    </div>
  );
}
