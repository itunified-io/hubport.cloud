import { useState, useEffect } from "react";
import { FormattedMessage } from "react-intl";
import { ClipboardList, ChevronDown, ChevronRight } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";

interface AuditEntry {
  id: string;
  actorId: string;
  action: string;
  objectType: string;
  objectId: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  createdAt: string;
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
          {entries.map((entry) => (
            <div key={entry.id}>
              <button
                onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-[var(--glass)] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                  <span className="text-sm font-mono text-[var(--amber)] truncate">
                    {entry.action}
                  </span>
                  <span className="text-xs text-[var(--text-muted)] truncate">
                    {entry.objectType}
                    {entry.objectId && ` #${entry.objectId.slice(0, 8)}`}
                  </span>
                </div>
                {expandedId === entry.id ? (
                  <ChevronDown size={14} className="text-[var(--text-muted)]" />
                ) : (
                  <ChevronRight size={14} className="text-[var(--text-muted)]" />
                )}
              </button>
              {expandedId === entry.id && (
                <div className="px-4 pb-3 space-y-2">
                  <p className="text-xs text-[var(--text-muted)]">
                    Actor: <span className="font-mono">{entry.actorId}</span>
                  </p>
                  {entry.beforeState && (
                    <div>
                      <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase">Before</p>
                      <pre className="text-xs text-[var(--text)] bg-[var(--bg-2)] p-2 rounded overflow-x-auto">
                        {JSON.stringify(entry.beforeState, null, 2)}
                      </pre>
                    </div>
                  )}
                  {entry.afterState && (
                    <div>
                      <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase">After</p>
                      <pre className="text-xs text-[var(--text)] bg-[var(--bg-2)] p-2 rounded overflow-x-auto">
                        {JSON.stringify(entry.afterState, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
