import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import {
  Megaphone,
  Plus,
  Play,
  Square,
  Archive,
  Trash2,
  ChevronRight,
  Filter,
  MapPin,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { usePermissions } from "@/auth/PermissionProvider";
import { getApiUrl } from "@/lib/config";

interface Campaign {
  id: string;
  title: string;
  template: string;
  status: string;
  startDate: string;
  endDate: string;
  createdAt: string;
  meetingPoints: { id: string; name: string | null }[];
  _count: { invitations: number };
}

const STATUS_STYLES: Record<string, string> = {
  draft: "text-[var(--text-muted)] bg-[var(--glass)]",
  active: "text-[var(--green)] bg-[#22c55e14]",
  closed: "text-[var(--blue)] bg-[#3b82f614]",
  archived: "text-[var(--text-muted)] bg-[var(--glass)]",
};

const TEMPLATE_LABELS: Record<string, string> = {
  gedaechtnismahl: "Memorial",
  kongress: "Convention",
  predigtdienstaktion: "Special Campaign",
  custom: "Custom",
};

function statusBadge(status: string) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.draft}`}>
      {status}
    </span>
  );
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString()} - ${e.toLocaleDateString()}`;
}

export function CampaignList() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const apiUrl = getApiUrl();
  const headers: HeadersInit = { Authorization: `Bearer ${user?.access_token}` };

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const canManage = can("app:campaigns.manage");

  const fetchCampaigns = async () => {
    try {
      const url = statusFilter === "all"
        ? `${apiUrl}/campaigns`
        : `${apiUrl}/campaigns?status=${statusFilter}`;
      const res = await fetch(url, { headers });
      if (res.ok) {
        setCampaigns((await res.json()) as Campaign[]);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAction = async (id: string, action: "activate" | "close" | "delete") => {
    const methods: Record<string, { url: string; method: string }> = {
      activate: { url: `${apiUrl}/campaigns/${id}/activate`, method: "POST" },
      close: { url: `${apiUrl}/campaigns/${id}/close`, method: "POST" },
      delete: { url: `${apiUrl}/campaigns/${id}`, method: "DELETE" },
    };
    const config = methods[action];
    if (!config) return;

    try {
      await fetch(config.url, {
        method: config.method,
        headers: { ...headers, "Content-Type": "application/json" },
      });
      await fetchCampaigns();
    } catch {
      // silently fail
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Megaphone size={20} className="text-[var(--amber)]" />
          <h1 className="text-xl font-semibold text-[var(--text)]">Campaigns</h1>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-[var(--glass-2)] rounded-[var(--radius)] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Megaphone size={20} className="text-[var(--amber)]" />
          <h1 className="text-xl font-semibold text-[var(--text)]">Campaigns</h1>
        </div>
        {canManage && (
          <button
            onClick={() => navigate("/territories/campaigns/new")}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--amber)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer"
          >
            <Plus size={16} /> New Campaign
          </button>
        )}
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-2">
        <Filter size={14} className="text-[var(--text-muted)]" />
        {["all", "draft", "active", "closed", "archived"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors cursor-pointer ${
              statusFilter === s
                ? "bg-[var(--glass-2)] text-[var(--amber)]"
                : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)]"
            }`}
          >
            {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Campaign cards */}
      {campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
          <Megaphone size={40} className="text-[var(--text-muted)] mb-3" strokeWidth={1.2} />
          <p className="text-sm text-[var(--text-muted)]">No campaigns found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-4 p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] hover:border-[var(--border-2)] transition-colors"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigate(`/territories/campaigns/${c.id}`)}
                    className="text-sm font-semibold text-[var(--text)] hover:text-[var(--amber)] transition-colors cursor-pointer"
                  >
                    {c.title}
                  </button>
                  {statusBadge(c.status)}
                  <span className="text-[10px] text-[var(--text-muted)] px-1.5 py-0.5 bg-[var(--glass)] rounded">
                    {TEMPLATE_LABELS[c.template] ?? c.template}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
                  <span>{formatDateRange(c.startDate, c.endDate)}</span>
                  <span className="flex items-center gap-1">
                    <MapPin size={10} /> {c.meetingPoints.length} meeting points
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1">
                {canManage && c.status === "draft" && (
                  <button
                    onClick={() => handleAction(c.id, "activate")}
                    className="p-2 rounded text-[var(--green)] hover:bg-[#22c55e14] transition-colors cursor-pointer"
                    title="Activate"
                  >
                    <Play size={14} />
                  </button>
                )}
                {canManage && c.status === "active" && (
                  <button
                    onClick={() => handleAction(c.id, "close")}
                    className="p-2 rounded text-[var(--blue)] hover:bg-[#3b82f614] transition-colors cursor-pointer"
                    title="Close"
                  >
                    <Square size={14} />
                  </button>
                )}
                {canManage && c.status === "closed" && (
                  <button
                    onClick={() => navigate(`/territories/campaigns/${c.id}/report`)}
                    className="p-2 rounded text-[var(--amber)] hover:bg-[#d9770614] transition-colors cursor-pointer"
                    title="Report"
                  >
                    <Archive size={14} />
                  </button>
                )}
                {canManage && c.status === "draft" && (
                  <button
                    onClick={() => handleAction(c.id, "delete")}
                    className="p-2 rounded text-[var(--red)] hover:bg-[#ef444414] transition-colors cursor-pointer"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                <button
                  onClick={() => navigate(`/territories/campaigns/${c.id}`)}
                  className="p-2 rounded text-[var(--text-muted)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
