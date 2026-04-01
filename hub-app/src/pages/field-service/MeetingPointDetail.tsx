import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, MapPin, Clock, Users, Map, Pencil, Trash2, Calendar } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { usePermissions } from "@/auth/PermissionProvider";
import {
  getMeetingPoint,
  deleteMeetingPoint,
  type FieldServiceMeetingPoint,
} from "@/lib/field-service-api";

const DAY_LABELS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

export function MeetingPointDetail() {
  const { user } = useAuth();
  const token = user?.access_token;
  const { can } = usePermissions();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [point, setPoint] = useState<FieldServiceMeetingPoint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !id) return;
    setLoading(true);
    getMeetingPoint(id, token)
      .then(setPoint)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, id]);

  async function handleDelete() {
    if (!token || !id || !confirm("Treffpunkt wirklich löschen?")) return;
    try {
      await deleteMeetingPoint(id, token);
      navigate("/field-service/meeting-points");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!point) {
    return (
      <div className="p-6 text-center text-[var(--text-muted)]">
        <p>Treffpunkt nicht gefunden.</p>
        <button
          onClick={() => navigate("/field-service/meeting-points")}
          className="mt-4 text-[var(--amber)] hover:underline cursor-pointer"
        >
          Zurück zur Liste
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate("/field-service/meeting-points")}
          className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
        >
          <ArrowLeft size={18} />
        </button>
        <MapPin size={22} className="text-[var(--amber)]" />
        <h1 className="text-xl font-semibold flex-1">{point.name}</h1>
        {!point.isActive && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">
            Inaktiv
          </span>
        )}
      </div>

      {error && (
        <div className="p-3 mb-4 bg-red-500/10 border border-red-500/30 rounded-[var(--radius-sm)] text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Info */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-[var(--glass)] border border-[var(--border)] rounded-[var(--radius)] p-5 space-y-4">
            <div className="flex items-center gap-3">
              <Clock size={16} className="text-[var(--amber)]" />
              <span className="text-sm">
                <span className="font-medium">{DAY_LABELS[point.dayOfWeek]}</span> um{" "}
                <span className="font-medium">{point.time}</span> Uhr
              </span>
            </div>

            {point.address && (
              <div className="flex items-center gap-3">
                <Map size={16} className="text-[var(--text-muted)]" />
                <span className="text-sm">{point.address}</span>
              </div>
            )}

            {point.conductorName && (
              <div className="flex items-center gap-3">
                <Users size={16} className="text-[var(--text-muted)]" />
                <span className="text-sm">Dienstleiter: {point.conductorName}</span>
              </div>
            )}

            {point.territoryIds.length > 0 && (
              <div className="flex items-center gap-3">
                <Map size={16} className="text-[var(--text-muted)]" />
                <span className="text-sm">
                  {point.territoryIds.length} Gebiet{point.territoryIds.length !== 1 ? "e" : ""} zugeordnet
                </span>
              </div>
            )}

            {point.maxParticipants && (
              <div className="text-xs text-[var(--text-muted)]">
                Max. {point.maxParticipants} Teilnehmer
              </div>
            )}

            {point.notes && (
              <div className="mt-4 pt-4 border-t border-[var(--border)]">
                <p className="text-xs text-[var(--text-muted)] mb-1">Notizen</p>
                <p className="text-sm">{point.notes}</p>
              </div>
            )}
          </div>

          {/* Upcoming meetings placeholder */}
          <div className="bg-[var(--glass)] border border-[var(--border)] rounded-[var(--radius)] p-5">
            <div className="flex items-center gap-2 mb-3">
              <Calendar size={16} className="text-[var(--amber)]" />
              <h2 className="text-sm font-medium">Kommende Termine</h2>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Termine werden in der Predigtdienstgruppen-Planung erstellt.
            </p>
          </div>
        </div>

        {/* Sidebar actions */}
        <div>
          {can("app:meeting_points.manage") && (
            <div className="bg-[var(--glass)] border border-[var(--border)] rounded-[var(--radius)] p-4 space-y-2">
              <button
                onClick={() => navigate(`/field-service/meeting-points/${id}?edit=true`)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-[var(--radius-sm)] hover:bg-[var(--glass-2)] transition-colors cursor-pointer"
              >
                <Pencil size={14} /> Bearbeiten
              </button>
              <button
                onClick={handleDelete}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 rounded-[var(--radius-sm)] hover:bg-red-500/10 transition-colors cursor-pointer"
              >
                <Trash2 size={14} /> Löschen
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
