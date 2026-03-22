import { useState, useEffect } from "react";
import { FormattedMessage } from "react-intl";
import { ClipboardList, ChevronDown, ChevronRight, User, ArrowRight } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";

interface AuditEntry {
  id: string;
  actorId: string;
  actorName: string | null;
  action: string;
  objectType: string;
  objectId: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  createdAt: string;
}

/** Human-readable action labels */
const ACTION_LABELS: Record<string, string> = {
  "publisher.create": "Created publisher",
  "publisher.update": "Updated publisher",
  "publisher.delete": "Deleted publisher",
  "publisher.self.update": "Updated own profile",
  "publisher.self.gdpr_delete": "Requested GDPR deletion",
  "publisher.self.deactivate": "Deactivated own account",
  "user.invite": "Invited user",
  "user.approve": "Approved user",
  "user.reject": "Rejected user",
  "user.deactivate": "Deactivated user",
  "user.reactivate": "Reactivated user",
  "role.assign": "Assigned role",
  "role.remove": "Removed role",
};

/** Color mapping for action categories */
function actionColor(action: string): string {
  if (action.includes("delete") || action.includes("reject") || action.includes("deactivate"))
    return "text-[var(--red)]";
  if (action.includes("create") || action.includes("invite") || action.includes("approve") || action.includes("reactivate"))
    return "text-[var(--green)]";
  return "text-[var(--amber)]";
}

/** Compute changed fields between before/after states */
function computeChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): { field: string; from: unknown; to: unknown }[] {
  if (!before || !after) return [];
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of allKeys) {
    // Skip internal fields
    if (["id", "createdAt", "updatedAt", "keycloakSub"].includes(key)) continue;
    const bVal = JSON.stringify(before[key]);
    const aVal = JSON.stringify(after[key]);
    if (bVal !== aVal) {
      changes.push({ field: key, from: before[key], to: after[key] });
    }
  }
  return changes;
}

export function AuditLog() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const fetchAudit = async () => {
      try {
        const apiUrl = getApiUrl();
        const res = await fetch(`${apiUrl}/audit`, {
          headers: { Authorization: `Bearer ${user?.access_token}` },
        });
        if (res.ok) setEntries(await res.json() as AuditEntry[]);
      } finally {
        setLoading(false);
      }
    };
    fetchAudit();
  }, [user?.access_token]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[var(--text)]">
        <FormattedMessage id="audit.title" />
      </h1>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
          <ClipboardList size={40} className="text-[var(--text-muted)] mb-3" strokeWidth={1.2} />
          <p className="text-sm text-[var(--text-muted)]">
            <FormattedMessage id="audit.empty" />
          </p>
        </div>
      ) : (
        <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] divide-y divide-[var(--border)]">
          {entries.map((entry) => {
            const label = ACTION_LABELS[entry.action] ?? entry.action;
            const changes = computeChanges(entry.beforeState, entry.afterState);
            const isExpanded = expandedId === entry.id;

            return (
              <div key={entry.id}>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-[var(--glass)] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                      {new Date(entry.createdAt).toLocaleString()}
                    </span>
                    <span className={`text-sm font-medium truncate ${actionColor(entry.action)}`}>
                      {label}
                    </span>
                    <span className="text-xs text-[var(--text-muted)] truncate">
                      {entry.objectType}
                      {entry.objectId && ` #${entry.objectId.slice(0, 8)}`}
                    </span>
                    <span className="hidden sm:inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
                      <User size={10} />
                      {entry.actorName ?? entry.actorId.slice(0, 8)}
                    </span>
                  </div>
                  {isExpanded ? (
                    <ChevronDown size={14} className="text-[var(--text-muted)]" />
                  ) : (
                    <ChevronRight size={14} className="text-[var(--text-muted)]" />
                  )}
                </button>
                {isExpanded && (
                  <div className="px-4 pb-3 space-y-3">
                    <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
                      <span>
                        <FormattedMessage id="audit.actor" />:{" "}
                        <span className="text-[var(--text)]">
                          {entry.actorName ?? "—"}
                        </span>
                        <span className="ml-1 font-mono text-[10px]">({entry.actorId.slice(0, 8)})</span>
                      </span>
                    </div>

                    {/* Show diff for updates */}
                    {changes.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase">
                          <FormattedMessage id="audit.changes" />
                        </p>
                        <div className="border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--bg-2)] divide-y divide-[var(--border)]">
                          {changes.map((c) => (
                            <div key={c.field} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                              <span className="font-medium text-[var(--text)] min-w-[100px]">{c.field}</span>
                              <span className="text-[var(--text-muted)] truncate max-w-[120px]">
                                {c.from === null || c.from === undefined ? "—" : String(c.from)}
                              </span>
                              <ArrowRight size={10} className="text-[var(--text-muted)] shrink-0" />
                              <span className="text-[var(--text)] truncate max-w-[120px]">
                                {c.to === null || c.to === undefined ? "—" : String(c.to)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Show raw state for create/delete (no diff) */}
                    {changes.length === 0 && entry.afterState && (
                      <div>
                        <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase">Details</p>
                        <pre className="text-xs text-[var(--text)] bg-[var(--bg-2)] p-2 rounded overflow-x-auto">
                          {JSON.stringify(entry.afterState, null, 2)}
                        </pre>
                      </div>
                    )}
                    {changes.length === 0 && !entry.afterState && entry.beforeState && (
                      <div>
                        <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase">Details</p>
                        <pre className="text-xs text-[var(--text)] bg-[var(--bg-2)] p-2 rounded overflow-x-auto">
                          {JSON.stringify(entry.beforeState, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
