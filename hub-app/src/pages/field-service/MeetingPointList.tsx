import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import {
  MapPin,
  Plus,
  Clock,
  Users,
  Map,
  Pencil,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { usePermissions } from "@/auth/PermissionProvider";
import { FormattedMessage } from "react-intl";
import {
  listMeetingPoints,
  deleteMeetingPoint,
  type FieldServiceMeetingPoint,
} from "@/lib/field-service-api";

const DAY_LABELS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

export function MeetingPointList() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [points, setPoints] = useState<FieldServiceMeetingPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const token = user?.access_token;

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    listMeetingPoints(token)
      .then(setPoints)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleDelete(id: string) {
    if (!token || !confirm("Treffpunkt wirklich löschen?")) return;
    try {
      await deleteMeetingPoint(id, token);
      setPoints((prev) => prev.filter((p) => p.id !== id));
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

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <MapPin size={24} className="text-[var(--amber)]" />
          <h1 className="text-xl font-semibold">
            <FormattedMessage id="nav.fieldService.meetingPoints" />
          </h1>
        </div>
        {can("app:meeting_points.manage") && (
          <button
            onClick={() => navigate("/field-service/meeting-points/new")}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--amber)] text-black rounded-[var(--radius-sm)] font-medium text-sm hover:opacity-90 transition-opacity cursor-pointer"
          >
            <Plus size={16} />
            Neuer Treffpunkt
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 mb-4 bg-red-500/10 border border-red-500/30 rounded-[var(--radius-sm)] text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Empty state */}
      {points.length === 0 && !error && (
        <div className="text-center py-16 text-[var(--text-muted)]">
          <MapPin size={48} className="mx-auto mb-4 opacity-30" />
          <p className="text-lg mb-2">Keine Treffpunkte vorhanden</p>
          <p className="text-sm">Erstelle einen Treffpunkt für den regelmäßigen Predigtdienst.</p>
        </div>
      )}

      {/* Card grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {points.map((point) => (
          <div
            key={point.id}
            className="bg-[var(--glass)] border border-[var(--border)] rounded-[var(--radius)] p-4 hover:border-[var(--amber)] transition-colors cursor-pointer"
            onClick={() => navigate(`/field-service/meeting-points/${point.id}`)}
          >
            {/* Name + active badge */}
            <div className="flex items-start justify-between mb-3">
              <h3 className="font-medium text-sm truncate flex-1">{point.name}</h3>
              {!point.isActive && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 ml-2">
                  Inaktiv
                </span>
              )}
            </div>

            {/* Day + Time */}
            <div className="flex items-center gap-2 mb-2 text-xs text-[var(--text-muted)]">
              <Clock size={13} />
              <span className="font-medium text-[var(--amber)]">
                {DAY_LABELS[point.dayOfWeek]} {point.time}
              </span>
            </div>

            {/* Address */}
            {point.address && (
              <div className="flex items-center gap-2 mb-2 text-xs text-[var(--text-muted)]">
                <Map size={13} />
                <span className="truncate">{point.address}</span>
              </div>
            )}

            {/* Conductor */}
            {point.conductorName && (
              <div className="flex items-center gap-2 mb-2 text-xs text-[var(--text-muted)]">
                <Users size={13} />
                <span>Leiter: {point.conductorName}</span>
              </div>
            )}

            {/* Territory count */}
            {point.territoryIds.length > 0 && (
              <div className="text-xs text-[var(--text-muted)] mt-2">
                {point.territoryIds.length} Gebiet{point.territoryIds.length !== 1 ? "e" : ""}
              </div>
            )}

            {/* Actions */}
            {can("app:meeting_points.manage") && (
              <div className="flex gap-2 mt-3 pt-3 border-t border-[var(--border)]">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/field-service/meeting-points/${point.id}?edit=true`);
                  }}
                  className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                >
                  <Pencil size={12} /> Bearbeiten
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(point.id);
                  }}
                  className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 ml-auto cursor-pointer"
                >
                  <Trash2 size={12} /> Löschen
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
