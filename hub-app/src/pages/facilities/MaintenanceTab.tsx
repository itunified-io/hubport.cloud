import { useState, useEffect } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { AlertTriangle, Plus, ChevronDown } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { usePermissions } from "@/auth/PermissionProvider";
import { getApiUrl } from "@/lib/config";
import { MaintenanceForm } from "./MaintenanceForm";
import { MaintenanceDetail } from "./MaintenanceDetail";

interface Issue {
  id: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  location: string | null;
  reporter: { id: string; firstName: string; lastName: string };
  assignee: { id: string; firstName: string; lastName: string } | null;
  createdAt: string;
  _count: { photos: number; comments: number };
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400",
  high: "bg-orange-400/20 text-orange-400",
  medium: "bg-yellow-400/20 text-yellow-400",
  low: "bg-blue-400/20 text-blue-400",
};

const STATUS_COLORS: Record<string, string> = {
  reported: "text-[var(--text-muted)]",
  under_review: "text-[var(--amber)]",
  approved: "text-[var(--green)]",
  forwarded_to_ldc: "text-purple-400",
  in_progress: "text-blue-400",
  resolved: "text-[var(--green)]",
  closed: "text-[var(--text-muted)]",
  rejected: "text-red-400",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function MaintenanceTab() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const intl = useIntl();
  const apiUrl = getApiUrl();
  const headers = { Authorization: `Bearer ${user?.access_token}`, "Content-Type": "application/json" };
  const canManage = can("manage:facilities.maintenance");
  const canReport = can("facilities:report");

  const [issues, setIssues] = useState<Issue[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterPriority, setFilterPriority] = useState("");

  const fetchIssues = async (cursor?: string) => {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (filterStatus) params.set("status", filterStatus);
    if (filterCategory) params.set("category", filterCategory);
    if (filterPriority) params.set("priority", filterPriority);

    try {
      const res = await fetch(`${apiUrl}/facilities/maintenance?${params}`, { headers });
      if (res.ok) {
        const data = await res.json() as { data: Issue[]; nextCursor: string | null };
        if (cursor) {
          setIssues((prev) => [...prev, ...data.data]);
        } else {
          setIssues(data.data);
        }
        setNextCursor(data.nextCursor);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchIssues(); }, [user?.access_token, filterStatus, filterCategory, filterPriority]);

  const onCreated = () => {
    setShowForm(false);
    fetchIssues();
  };

  if (selectedId) {
    return (
      <MaintenanceDetail
        issueId={selectedId}
        onBack={() => { setSelectedId(null); fetchIssues(); }}
      />
    );
  }

  // Calculate stats
  const openCritical = issues.filter((i) => ["reported", "under_review", "approved"].includes(i.status) && ["critical", "high"].includes(i.priority)).length;
  const inProgress = issues.filter((i) => i.status === "in_progress").length;
  const forwarded = issues.filter((i) => i.status === "forwarded_to_ldc").length;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const completedMonth = issues.filter((i) => ["resolved", "closed"].includes(i.status) && new Date(i.createdAt) >= monthStart).length;

  return (
    <div className="space-y-6">
      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "facilities.maintenance.stats.openCritical", value: openCritical, color: "text-red-400" },
          { label: "facilities.maintenance.stats.inProgress", value: inProgress, color: "text-blue-400" },
          { label: "facilities.maintenance.stats.forwarded", value: forwarded, color: "text-purple-400" },
          { label: "facilities.maintenance.stats.completedMonth", value: completedMonth, color: "text-[var(--green)]" },
        ].map((stat) => (
          <div key={stat.label} className="p-3 border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--bg-1)]">
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-[var(--text-muted)]"><FormattedMessage id={stat.label} /></div>
          </div>
        ))}
      </div>

      {/* Actions + Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="px-3 py-1.5 text-sm bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]">
            <option value="">{intl.formatMessage({ id: "facilities.filter.allStatus" })}</option>
            {["reported", "under_review", "approved", "forwarded_to_ldc", "in_progress", "resolved", "closed", "rejected"].map((s) => (
              <option key={s} value={s}>{intl.formatMessage({ id: `facilities.status.${s}` })}</option>
            ))}
          </select>
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="px-3 py-1.5 text-sm bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]">
            <option value="">{intl.formatMessage({ id: "facilities.filter.allCategories" })}</option>
            {["electrical", "plumbing", "hvac", "structural", "safety", "grounds", "interior", "audio_video", "other"].map((c) => (
              <option key={c} value={c}>{intl.formatMessage({ id: `facilities.category.${c}` })}</option>
            ))}
          </select>
          <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} className="px-3 py-1.5 text-sm bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]">
            <option value="">{intl.formatMessage({ id: "facilities.filter.allPriorities" })}</option>
            {["critical", "high", "medium", "low"].map((p) => (
              <option key={p} value={p}>{intl.formatMessage({ id: `facilities.priority.${p}` })}</option>
            ))}
          </select>
        </div>
        {canReport && (
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 bg-[var(--amber)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer">
            <Plus size={14} />
            <FormattedMessage id="facilities.maintenance.create" />
          </button>
        )}
      </div>

      {/* Create Form Modal */}
      {showForm && <MaintenanceForm onClose={() => setShowForm(false)} onCreated={onCreated} />}

      {/* Issue List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : issues.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
          <AlertTriangle size={40} className="text-[var(--text-muted)] mb-3" strokeWidth={1.2} />
          <p className="text-sm text-[var(--text-muted)]"><FormattedMessage id="facilities.maintenance.empty" /></p>
        </div>
      ) : (
        <div className="space-y-2">
          {issues.map((issue) => (
            <button
              key={issue.id}
              onClick={() => setSelectedId(issue.id)}
              className="w-full text-left p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-[var(--text)]">{issue.title}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${PRIORITY_COLORS[issue.priority] ?? ""}`}>
                      {intl.formatMessage({ id: `facilities.priority.${issue.priority}` })}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/20 text-blue-400">
                      {intl.formatMessage({ id: `facilities.category.${issue.category}` })}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {issue.reporter.firstName} {issue.reporter.lastName} · {timeAgo(issue.createdAt)}
                    {issue._count.photos > 0 && ` · ${issue._count.photos} photos`}
                    {issue._count.comments > 0 && ` · ${issue._count.comments} comments`}
                  </div>
                </div>
                <span className={`text-xs font-medium ${STATUS_COLORS[issue.status] ?? ""}`}>
                  {intl.formatMessage({ id: `facilities.status.${issue.status}` })}
                </span>
              </div>
            </button>
          ))}
          {nextCursor && (
            <button onClick={() => fetchIssues(nextCursor)} className="w-full py-3 text-sm text-[var(--amber)] hover:bg-[var(--glass)] rounded-[var(--radius)] transition-colors cursor-pointer flex items-center justify-center gap-1">
              <ChevronDown size={14} />
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
