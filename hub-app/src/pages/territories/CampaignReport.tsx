import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import {
  BarChart3,
  ArrowLeft,
  Download,
  Map,
  Users,
  MapPin,
  Home,
  Eye,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";

interface ReportSummary {
  totalTerritories: number;
  totalAddresses: number;
  totalVisits: number;
  coveragePercent: number;
  visitsByOutcome: Record<string, number>;
  avgVisitsPerTerritory: number;
}

interface TerritoryBreakdown {
  territoryId: string;
  territoryNumber: string;
  addressCount: number;
  visitedAddresses: number;
  totalVisits: number;
  coveragePercent: number;
}

interface PublisherStat {
  publisherId: string;
  publisherName: string;
  totalVisits: number;
  uniqueAddresses: number;
}

interface MeetingPointStat {
  meetingPointId: string;
  meetingPointName: string | null;
  territoryCount: number;
  totalVisits: number;
  coveragePercent: number;
}

interface CampaignReport {
  summary: ReportSummary;
  territories: TerritoryBreakdown[];
  publishers: PublisherStat[];
  meetingPoints: MeetingPointStat[];
}

const OUTCOME_COLORS: Record<string, string> = {
  home: "bg-[var(--green)]",
  not_home: "bg-[var(--text-muted)]",
  return_visit: "bg-[var(--blue)]",
  study: "bg-[var(--amber)]",
  do_not_call: "bg-[var(--red)]",
};

const OUTCOME_LABELS: Record<string, string> = {
  home: "Home",
  not_home: "Not Home",
  return_visit: "Return Visit",
  study: "Study",
  do_not_call: "Do Not Call",
};

export function CampaignReport() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const apiUrl = getApiUrl();

  const [report, setReport] = useState<CampaignReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchReport = async () => {
      try {
        const res = await fetch(`${apiUrl}/campaigns/${id}/report`, {
          headers: { Authorization: `Bearer ${user?.access_token}` },
        });
        if (res.ok) {
          setReport((await res.json()) as CampaignReport);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    };
    fetchReport();
  }, [apiUrl, id, user?.access_token]);

  const handleExport = () => {
    // Trigger CSV download
    const url = `${apiUrl}/campaigns/${id}/report/export`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `campaign-${id}.csv`;
    // Fetch with auth header and create blob
    fetch(url, {
      headers: { Authorization: `Bearer ${user?.access_token}` },
    })
      .then((res) => res.blob())
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        a.href = blobUrl;
        a.click();
        URL.revokeObjectURL(blobUrl);
      })
      .catch(() => {
        // silently fail
      });
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-[var(--glass-2)] rounded w-48 animate-pulse" />
        <div className="grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-[var(--glass-2)] rounded-[var(--radius)] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 rounded hover:bg-[var(--glass)] transition-colors cursor-pointer">
            <ArrowLeft size={18} className="text-[var(--text-muted)]" />
          </button>
          <h1 className="text-xl font-semibold text-[var(--text)]">Campaign Report</h1>
        </div>
        <p className="text-sm text-[var(--text-muted)]">Report not available.</p>
      </div>
    );
  }

  const maxMeetingPointVisits = Math.max(...report.meetingPoints.map((mp) => mp.totalVisits), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 rounded hover:bg-[var(--glass)] transition-colors cursor-pointer">
            <ArrowLeft size={18} className="text-[var(--text-muted)]" />
          </button>
          <BarChart3 size={20} className="text-[var(--amber)]" />
          <h1 className="text-xl font-semibold text-[var(--text)]">Campaign Report</h1>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
        >
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Map} label="Territories" value={String(report.summary.totalTerritories)} />
        <StatCard icon={Home} label="Addresses" value={String(report.summary.totalAddresses)} />
        <StatCard icon={Eye} label="Total Visits" value={String(report.summary.totalVisits)} />
        <StatCard
          icon={BarChart3}
          label="Coverage"
          value={`${report.summary.coveragePercent}%`}
          accent={report.summary.coveragePercent >= 80 ? "green" : report.summary.coveragePercent >= 50 ? "amber" : "red"}
        />
      </div>

      {/* Visits by outcome */}
      <div className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
        <h3 className="text-sm font-semibold text-[var(--text)] mb-3">Visits by Outcome</h3>
        <div className="flex gap-4 flex-wrap">
          {Object.entries(report.summary.visitsByOutcome).map(([outcome, count]) => (
            <div key={outcome} className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${OUTCOME_COLORS[outcome] ?? "bg-[var(--glass-2)]"}`} />
              <span className="text-xs text-[var(--text)]">
                {OUTCOME_LABELS[outcome] ?? outcome}: <span className="font-semibold">{count}</span>
              </span>
            </div>
          ))}
        </div>
        {/* Simple bar visualization */}
        <div className="mt-3 h-6 flex rounded-full overflow-hidden">
          {Object.entries(report.summary.visitsByOutcome).map(([outcome, count]) => {
            const pct = report.summary.totalVisits > 0
              ? (count / report.summary.totalVisits) * 100
              : 0;
            if (pct === 0) return null;
            return (
              <div
                key={outcome}
                className={`${OUTCOME_COLORS[outcome] ?? "bg-[var(--glass-2)]"} transition-all`}
                style={{ width: `${pct}%` }}
                title={`${OUTCOME_LABELS[outcome] ?? outcome}: ${count} (${pct.toFixed(1)}%)`}
              />
            );
          })}
        </div>
      </div>

      {/* Per-territory breakdown */}
      <div className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
        <h3 className="text-sm font-semibold text-[var(--text)] mb-3 flex items-center gap-2">
          <Map size={14} /> Per-Territory Breakdown
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[var(--text-muted)] border-b border-[var(--border)]">
                <th className="text-left py-2 pr-4">Territory</th>
                <th className="text-right py-2 px-2">Addresses</th>
                <th className="text-right py-2 px-2">Visited</th>
                <th className="text-right py-2 px-2">Visits</th>
                <th className="text-right py-2 px-2">Coverage</th>
                <th className="py-2 pl-4 w-32">Progress</th>
              </tr>
            </thead>
            <tbody>
              {report.territories.map((t) => (
                <tr key={t.territoryId} className="border-b border-[var(--border)]">
                  <td className="py-2 pr-4 font-medium text-[var(--text)]">#{t.territoryNumber}</td>
                  <td className="text-right py-2 px-2 text-[var(--text-muted)]">{t.addressCount}</td>
                  <td className="text-right py-2 px-2 text-[var(--text-muted)]">{t.visitedAddresses}</td>
                  <td className="text-right py-2 px-2 text-[var(--text-muted)]">{t.totalVisits}</td>
                  <td className="text-right py-2 px-2 text-[var(--text)]">{t.coveragePercent}%</td>
                  <td className="py-2 pl-4">
                    <div className="h-2 bg-[var(--glass-2)] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          t.coveragePercent >= 80
                            ? "bg-[var(--green)]"
                            : t.coveragePercent >= 50
                              ? "bg-[var(--amber)]"
                              : "bg-[var(--red)]"
                        }`}
                        style={{ width: `${t.coveragePercent}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-publisher stats */}
      <div className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
        <h3 className="text-sm font-semibold text-[var(--text)] mb-3 flex items-center gap-2">
          <Users size={14} /> Per-Publisher Stats
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[var(--text-muted)] border-b border-[var(--border)]">
                <th className="text-left py-2 pr-4">Publisher</th>
                <th className="text-right py-2 px-2">Total Visits</th>
                <th className="text-right py-2 px-2">Unique Addresses</th>
              </tr>
            </thead>
            <tbody>
              {report.publishers.map((p) => (
                <tr key={p.publisherId} className="border-b border-[var(--border)]">
                  <td className="py-2 pr-4 text-[var(--text)]">{p.publisherName}</td>
                  <td className="text-right py-2 px-2 text-[var(--text-muted)]">{p.totalVisits}</td>
                  <td className="text-right py-2 px-2 text-[var(--text-muted)]">{p.uniqueAddresses}</td>
                </tr>
              ))}
              {report.publishers.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-[var(--text-muted)]">
                    No visit data recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-meeting-point comparison (horizontal bars) */}
      <div className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
        <h3 className="text-sm font-semibold text-[var(--text)] mb-3 flex items-center gap-2">
          <MapPin size={14} /> Meeting Point Comparison
        </h3>
        <div className="space-y-3">
          {report.meetingPoints.map((mp) => {
            const barWidth = maxMeetingPointVisits > 0
              ? (mp.totalVisits / maxMeetingPointVisits) * 100
              : 0;
            return (
              <div key={mp.meetingPointId} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--text)]">
                    {mp.meetingPointName ?? "Unnamed"}
                  </span>
                  <span className="text-[var(--text-muted)]">
                    {mp.totalVisits} visits | {mp.territoryCount} territories | {mp.coveragePercent}% coverage
                  </span>
                </div>
                <div className="h-4 bg-[var(--glass-2)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--amber)] rounded-full transition-all"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            );
          })}
          {report.meetingPoints.length === 0 && (
            <p className="text-xs text-[var(--text-muted)] text-center py-4">
              No meeting point data.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent?: "green" | "amber" | "red";
}) {
  const accentColor = accent === "green"
    ? "text-[var(--green)]"
    : accent === "red"
      ? "text-[var(--red)]"
      : accent === "amber"
        ? "text-[var(--amber)]"
        : "text-[var(--text)]";

  return (
    <div className="p-3 border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--bg-1)]">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} className="text-[var(--text-muted)]" />
        <span className="text-[10px] text-[var(--text-muted)]">{label}</span>
      </div>
      <p className={`text-lg font-semibold ${accentColor}`}>{value}</p>
    </div>
  );
}
