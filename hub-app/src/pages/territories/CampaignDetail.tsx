import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import {
  Megaphone,
  ArrowLeft,
  MapPin,
  Play,
  Square,
  BarChart3,
  Edit,
  Users,
  Calendar,
  Map,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { usePermissions } from "@/auth/PermissionProvider";
import { getApiUrl } from "@/lib/config";
import { MeetingPointManager } from "./MeetingPointManager";

interface MeetingPoint {
  id: string;
  name: string | null;
  conductorId: string;
  assistantIds: string[];
  territoryIds: string[];
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  dayOfWeek: string | null;
  time: string | null;
  fieldGroups: FieldGroup[];
}

interface FieldGroup {
  id: string;
  name: string | null;
  status: string;
  memberIds: string[];
  territoryIds: string[];
  startedAt: string | null;
  closedAt: string | null;
  locationShares: LocationShare[];
}

interface LocationShare {
  id: string;
  publisherId: string;
  isActive: boolean;
  duration: string;
  expiresAt: string;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastUpdatedAt: string | null;
}

interface Campaign {
  id: string;
  title: string;
  template: string;
  status: string;
  startDate: string;
  endDate: string;
  createdBy: string;
  meetingPoints: MeetingPoint[];
  invitations: unknown[];
}

const STATUS_COLORS: Record<string, string> = {
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

export function CampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { can } = usePermissions();
  const apiUrl = getApiUrl();
  const headers: HeadersInit = { Authorization: `Bearer ${user?.access_token}`, "Content-Type": "application/json" };

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "meeting-points" | "progress">("overview");
  const canManage = can("app:campaigns.manage");

  const fetchCampaign = async () => {
    try {
      const res = await fetch(`${apiUrl}/campaigns/${id}`, {
        headers: { Authorization: `Bearer ${user?.access_token}` },
      });
      if (res.ok) {
        setCampaign((await res.json()) as Campaign);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaign();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAction = async (action: "activate" | "close") => {
    try {
      await fetch(`${apiUrl}/campaigns/${id}/${action}`, {
        method: "POST",
        headers,
      });
      await fetchCampaign();
    } catch {
      // silently fail
    }
  };

  if (loading || !campaign) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-[var(--glass-2)] rounded w-48 animate-pulse" />
        <div className="h-32 bg-[var(--glass-2)] rounded-[var(--radius)] animate-pulse" />
      </div>
    );
  }

  const durationDays = Math.ceil(
    (new Date(campaign.endDate).getTime() - new Date(campaign.startDate).getTime()) / (1000 * 60 * 60 * 24),
  );
  const totalTerritories = new Set(campaign.meetingPoints.flatMap((mp) => mp.territoryIds)).size;
  const totalFieldGroups = campaign.meetingPoints.reduce((sum, mp) => sum + mp.fieldGroups.length, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/field-service/campaigns")}
            className="p-2 rounded hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            <ArrowLeft size={18} className="text-[var(--text-muted)]" />
          </button>
          <Megaphone size={20} className="text-[var(--amber)]" />
          <div>
            <h1 className="text-xl font-semibold text-[var(--text)]">{campaign.title}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_COLORS[campaign.status] ?? ""}`}>
                {campaign.status}
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {TEMPLATE_LABELS[campaign.template] ?? campaign.template}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canManage && campaign.status === "draft" && (
            <>
              <button
                onClick={() => navigate(`/field-service/campaigns/${id}`, { state: { edit: true } })}
                className="flex items-center gap-1 px-3 py-2 text-sm text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
              >
                <Edit size={14} /> Edit
              </button>
              <button
                onClick={() => handleAction("activate")}
                className="flex items-center gap-1 px-3 py-2 text-sm font-semibold text-black bg-[var(--green)] rounded-[var(--radius-sm)] hover:opacity-90 transition-colors cursor-pointer"
              >
                <Play size={14} /> Activate
              </button>
            </>
          )}
          {canManage && campaign.status === "active" && (
            <button
              onClick={() => handleAction("close")}
              className="flex items-center gap-1 px-3 py-2 text-sm font-semibold text-white bg-[var(--blue)] rounded-[var(--radius-sm)] hover:opacity-90 transition-colors cursor-pointer"
            >
              <Square size={14} /> Close Campaign
            </button>
          )}
          {(campaign.status === "closed" || campaign.status === "archived") && (
            <button
              onClick={() => navigate(`/field-service/campaigns/${id}/report`)}
              className="flex items-center gap-1 px-3 py-2 text-sm font-semibold bg-[var(--amber)] text-black rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer"
            >
              <BarChart3 size={14} /> View Report
            </button>
          )}
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Calendar} label="Duration" value={`${durationDays} days`} />
        <StatCard icon={Map} label="Territories" value={String(totalTerritories)} />
        <StatCard icon={MapPin} label="Meeting Points" value={String(campaign.meetingPoints.length)} />
        <StatCard icon={Users} label="Field Groups" value={String(totalFieldGroups)} />
      </div>

      {/* Dates */}
      <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
        <span>Start: {new Date(campaign.startDate).toLocaleDateString()}</span>
        <span>End: {new Date(campaign.endDate).toLocaleDateString()}</span>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--border)]">
        {(["overview", "meeting-points", "progress"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === tab
                ? "border-[var(--amber)] text-[var(--amber)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {tab === "overview" ? "Overview" : tab === "meeting-points" ? "Meeting Points" : "Progress"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          {campaign.meetingPoints.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
              <MapPin size={32} className="text-[var(--text-muted)] mb-2" strokeWidth={1.2} />
              <p className="text-sm text-[var(--text-muted)]">No meeting points configured.</p>
              {canManage && campaign.status === "draft" && (
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Switch to the Meeting Points tab to add them.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {campaign.meetingPoints.map((mp) => (
                <div key={mp.id} className="p-3 border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--bg-1)]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MapPin size={14} className="text-[var(--amber)]" />
                      <span className="text-sm font-medium text-[var(--text)]">
                        {mp.name ?? "Unnamed Point"}
                      </span>
                    </div>
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {mp.territoryIds.length} territories
                    </span>
                  </div>
                  {mp.address && (
                    <p className="text-xs text-[var(--text-muted)] mt-1 ml-5">{mp.address}</p>
                  )}
                  {mp.dayOfWeek && mp.time && (
                    <p className="text-xs text-[var(--text-muted)] mt-0.5 ml-5">
                      {mp.dayOfWeek} at {mp.time}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-2 ml-5">
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {mp.fieldGroups.length} field groups
                    </span>
                    {mp.fieldGroups.some((fg) => fg.status === "in_field") && (
                      <span className="text-[10px] text-[var(--green)] bg-[#22c55e14] px-1.5 py-0.5 rounded-full">
                        In field
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "meeting-points" && (
        <MeetingPointManager
          campaignId={campaign.id}
          campaignStatus={campaign.status}
          meetingPoints={campaign.meetingPoints}
          onRefresh={fetchCampaign}
        />
      )}

      {activeTab === "progress" && (
        <div className="space-y-4">
          <div className="p-6 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] text-center">
            <BarChart3 size={32} className="text-[var(--text-muted)] mx-auto mb-2" strokeWidth={1.2} />
            <p className="text-sm text-[var(--text-muted)]">
              {campaign.status === "active"
                ? "Progress tracking is available while the campaign is active."
                : campaign.status === "closed"
                  ? "Campaign is closed. View the full report for detailed stats."
                  : "Activate the campaign to begin tracking progress."}
            </p>
            {(campaign.status === "closed" || campaign.status === "archived") && (
              <button
                onClick={() => navigate(`/field-service/campaigns/${id}/report`)}
                className="mt-3 px-4 py-2 text-sm font-semibold bg-[var(--amber)] text-black rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer"
              >
                View Report
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="p-3 border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--bg-1)]">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} className="text-[var(--text-muted)]" />
        <span className="text-[10px] text-[var(--text-muted)]">{label}</span>
      </div>
      <p className="text-lg font-semibold text-[var(--text)]">{value}</p>
    </div>
  );
}
