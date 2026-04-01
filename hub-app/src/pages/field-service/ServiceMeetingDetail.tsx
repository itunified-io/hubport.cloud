import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  Users,
  Play,
  CheckCircle,
  Map,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { usePermissions } from "@/auth/PermissionProvider";
import {
  getServiceMeeting,
  startMeeting,
  completeMeeting,
  startFieldGroup,
  completeFieldGroup,
  type ServiceGroupMeeting,
} from "@/lib/field-service-api";
import { FieldGroupManager } from "./components/FieldGroupManager";

const STATUS_STYLES: Record<string, string> = {
  planned: "bg-blue-500/20 text-blue-400",
  active: "bg-green-500/20 text-green-400",
  completed: "bg-[var(--glass)] text-[var(--text-muted)]",
  cancelled: "bg-red-500/20 text-red-400",
};

const STATUS_LABELS: Record<string, string> = {
  planned: "Geplant",
  active: "Aktiv",
  completed: "Abgeschlossen",
  cancelled: "Abgesagt",
};

export function ServiceMeetingDetail() {
  const { user } = useAuth();
  const token = user?.access_token;
  const { can } = usePermissions();
  const navigate = useNavigate();
  const { meetingId } = useParams<{ meetingId: string }>();
  const [meeting, setMeeting] = useState<ServiceGroupMeeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !meetingId) return;
    setLoading(true);
    getServiceMeeting(meetingId, token)
      .then(setMeeting)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, meetingId]);

  async function handleStart() {
    if (!token || !meetingId) return;
    try {
      const updated = await startMeeting(meetingId, token);
      setMeeting(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Start failed");
    }
  }

  async function handleComplete() {
    if (!token || !meetingId || !confirm("Meeting wirklich abschließen?")) return;
    try {
      const updated = await completeMeeting(meetingId, token);
      setMeeting(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Complete failed");
    }
  }

  async function handleStartGroup(groupId: string) {
    if (!token) return;
    try {
      await startFieldGroup(groupId, token);
      const updated = await getServiceMeeting(meetingId!, token);
      setMeeting(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Start group failed");
    }
  }

  async function handleCompleteGroup(groupId: string) {
    if (!token) return;
    try {
      await completeFieldGroup(groupId, token);
      const updated = await getServiceMeeting(meetingId!, token);
      setMeeting(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Complete group failed");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="p-6 text-center text-[var(--text-muted)]">
        <p>Termin nicht gefunden.</p>
        <button
          onClick={() => navigate("/field-service/groups")}
          className="mt-4 text-[var(--amber)] hover:underline cursor-pointer"
        >
          Zurück
        </button>
      </div>
    );
  }

  const date = new Date(meeting.date);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate("/field-service/groups")}
          className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
        >
          <ArrowLeft size={18} />
        </button>
        <CalendarDays size={22} className="text-[var(--amber)]" />
        <div className="flex-1">
          <h1 className="text-xl font-semibold">
            {meeting.meetingPoint?.name ?? "Diensttermin"}
          </h1>
          <div className="flex items-center gap-3 text-sm text-[var(--text-muted)]">
            <span className="flex items-center gap-1">
              <Clock size={13} />
              {date.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })} um {meeting.time}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[meeting.status] ?? ""}`}>
              {STATUS_LABELS[meeting.status] ?? meeting.status}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        {can("app:service_meetings.conduct") && (
          <div className="flex gap-2">
            {meeting.status === "planned" && (
              <button
                onClick={handleStart}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-[var(--radius-sm)] font-medium text-sm hover:opacity-90 transition-opacity cursor-pointer"
              >
                <Play size={14} /> Meeting starten
              </button>
            )}
            {meeting.status === "active" && (
              <button
                onClick={handleComplete}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--amber)] text-black rounded-[var(--radius-sm)] font-medium text-sm hover:opacity-90 transition-opacity cursor-pointer"
              >
                <CheckCircle size={14} /> Abschließen
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 mb-4 bg-red-500/10 border border-red-500/30 rounded-[var(--radius-sm)] text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Signups */}
          <div className="bg-[var(--glass)] border border-[var(--border)] rounded-[var(--radius)] p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium flex items-center gap-2">
                <Users size={16} className="text-[var(--amber)]" />
                Anmeldungen ({meeting.signups?.filter((s) => !s.cancelledAt).length ?? 0})
              </h2>
            </div>
            {(!meeting.signups || meeting.signups.filter((s) => !s.cancelledAt).length === 0) ? (
              <p className="text-xs text-[var(--text-muted)]">Noch keine Anmeldungen.</p>
            ) : (
              <div className="space-y-2">
                {meeting.signups
                  .filter((s) => !s.cancelledAt)
                  .map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-3 px-3 py-2 bg-[var(--glass-2)] rounded-[var(--radius-sm)]"
                    >
                      <div className="w-7 h-7 rounded-full bg-[var(--amber)]/20 text-[var(--amber)] flex items-center justify-center text-xs font-medium">
                        {(s.publisherName ?? "?")[0]}
                      </div>
                      <span className="text-sm">{s.publisherName ?? s.publisherId}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Field Groups */}
          <div className="bg-[var(--glass)] border border-[var(--border)] rounded-[var(--radius)] p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium flex items-center gap-2">
                <Map size={16} className="text-[var(--amber)]" />
                Predigtdienstgruppen ({meeting.fieldGroups?.length ?? 0})
              </h2>
            </div>

            {can("app:service_meetings.conduct") && token ? (
              <FieldGroupManager
                meetingId={meeting.id}
                token={token}
                signups={meeting.signups ?? []}
                fieldGroups={meeting.fieldGroups ?? []}
                meetingStatus={meeting.status}
                onRefresh={async () => {
                  const updated = await getServiceMeeting(meetingId!, token);
                  setMeeting(updated);
                }}
              />
            ) : (
              /* Read-only view for non-conductors */
              (!meeting.fieldGroups || meeting.fieldGroups.length === 0) ? (
                <p className="text-xs text-[var(--text-muted)]">
                  Noch keine Gruppen erstellt.
                </p>
              ) : (
                <div className="space-y-3">
                  {meeting.fieldGroups.map((g) => (
                    <div
                      key={g.id}
                      className="p-3 bg-[var(--glass-2)] rounded-[var(--radius-sm)] border border-[var(--border)]"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{g.name ?? "Gruppe"}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          g.status === "in_field" ? "bg-green-500/20 text-green-400" :
                          g.status === "completed" ? "bg-[var(--glass)] text-[var(--text-muted)]" :
                          "bg-blue-500/20 text-blue-400"
                        }`}>
                          {g.status === "in_field" ? "Im Dienst" : g.status === "completed" ? "Zurück" : "Geplant"}
                        </span>
                      </div>
                      <div className="text-xs text-[var(--text-muted)]">
                        Leiter: {g.leaderName ?? g.leaderId} · {g.memberIds.length} Mitglieder · {g.territoryIds.length} Gebiete
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {/* Group action buttons for conductor */}
            {can("app:service_meetings.conduct") && meeting.fieldGroups && meeting.fieldGroups.length > 0 && (
              <div className="mt-4 space-y-2">
                {meeting.fieldGroups.map((g) => (
                  <div key={g.id} className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-muted)]">{g.name ?? "Gruppe"}</span>
                    <div className="flex gap-2">
                      {g.status === "planned" && (
                        <button
                          onClick={() => handleStartGroup(g.id)}
                          className="text-xs px-2 py-1 bg-green-600/20 text-green-400 rounded hover:bg-green-600/30 transition-colors cursor-pointer"
                        >
                          Los geht&apos;s
                        </button>
                      )}
                      {g.status === "in_field" && (
                        <button
                          onClick={() => handleCompleteGroup(g.id)}
                          className="text-xs px-2 py-1 bg-[var(--amber)]/20 text-[var(--amber)] rounded hover:bg-[var(--amber)]/30 transition-colors cursor-pointer"
                        >
                          Zurück
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar info */}
        <div className="space-y-4">
          <div className="bg-[var(--glass)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <h3 className="text-xs font-medium text-[var(--text-muted)] mb-3">Details</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Treffpunkt</span>
                <span>{meeting.meetingPoint?.name ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Leiter</span>
                <span>{meeting.conductorName ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Status</span>
                <span>{STATUS_LABELS[meeting.status] ?? meeting.status}</span>
              </div>
              {meeting.startedAt && (
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Gestartet</span>
                  <span className="text-xs">{new Date(meeting.startedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              )}
              {meeting.completedAt && (
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Beendet</span>
                  <span className="text-xs">{new Date(meeting.completedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              )}
            </div>
          </div>

          {meeting.notes && (
            <div className="bg-[var(--glass)] border border-[var(--border)] rounded-[var(--radius)] p-4">
              <h3 className="text-xs font-medium text-[var(--text-muted)] mb-2">Notizen</h3>
              <p className="text-sm">{meeting.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
