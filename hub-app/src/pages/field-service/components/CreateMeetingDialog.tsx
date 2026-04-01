/**
 * CreateMeetingDialog — Modal for creating a new service meeting
 * at a specific meeting point on a specific date/time.
 */

import { useState, useEffect } from "react";
import { X, CalendarDays, Clock, MapPin, Users } from "lucide-react";
import {
  listMeetingPoints,
  createServiceMeeting,
  type FieldServiceMeetingPoint,
} from "@/lib/field-service-api";

interface CreateMeetingDialogProps {
  token: string;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateMeetingDialog({ token, onClose, onCreated }: CreateMeetingDialogProps) {
  const [meetingPoints, setMeetingPoints] = useState<FieldServiceMeetingPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [meetingPointId, setMeetingPointId] = useState("");
  const [date, setDate] = useState(() => {
    const d = new Date();
    return d.toISOString().split("T")[0]!;
  });
  const [time, setTime] = useState("10:00");
  const [conductorId, setConductorId] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    listMeetingPoints(token)
      .then((pts) => {
        setMeetingPoints(pts);
        if (pts.length > 0 && !meetingPointId) {
          setMeetingPointId(pts[0]!.id);
          // Pre-fill time and conductor from meeting point defaults
          if (pts[0]!.time) setTime(pts[0]!.time);
          if (pts[0]!.conductorId) setConductorId(pts[0]!.conductorId);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleMeetingPointChange(id: string) {
    setMeetingPointId(id);
    const mp = meetingPoints.find((p) => p.id === id);
    if (mp) {
      if (mp.time) setTime(mp.time);
      if (mp.conductorId) setConductorId(mp.conductorId);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!meetingPointId || !date || !time || !conductorId) {
      setError("Bitte alle Pflichtfelder ausfüllen.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createServiceMeeting(
        {
          meetingPointId,
          date,
          time,
          conductorId,
          notes: notes || undefined,
        },
        token,
      );
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create meeting");
    } finally {
      setSaving(false);
    }
  }

  const selectedPoint = meetingPoints.find((p) => p.id === meetingPointId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <CalendarDays size={18} className="text-[var(--amber)]" />
            <h2 className="text-sm font-semibold">Neuer Diensttermin</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            <X size={16} className="text-[var(--text-muted)]" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-2 text-xs bg-red-500/10 border border-red-500/30 rounded-[var(--radius-sm)] text-red-400">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Meeting Point */}
              <div>
                <label className="flex items-center gap-1 text-xs text-[var(--text-muted)] mb-1">
                  <MapPin size={12} /> Treffpunkt
                </label>
                <select
                  value={meetingPointId}
                  onChange={(e) => handleMeetingPointChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
                  required
                >
                  <option value="">— Treffpunkt wählen —</option>
                  {meetingPoints.map((mp) => (
                    <option key={mp.id} value={mp.id}>
                      {mp.name} ({["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][mp.dayOfWeek]} {mp.time})
                    </option>
                  ))}
                </select>
                {selectedPoint?.address && (
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">{selectedPoint.address}</p>
                )}
              </div>

              {/* Date */}
              <div>
                <label className="flex items-center gap-1 text-xs text-[var(--text-muted)] mb-1">
                  <CalendarDays size={12} /> Datum
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
                  required
                />
              </div>

              {/* Time */}
              <div>
                <label className="flex items-center gap-1 text-xs text-[var(--text-muted)] mb-1">
                  <Clock size={12} /> Uhrzeit
                </label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
                  required
                />
              </div>

              {/* Conductor */}
              <div>
                <label className="flex items-center gap-1 text-xs text-[var(--text-muted)] mb-1">
                  <Users size={12} /> Leiter
                </label>
                <input
                  type="text"
                  value={conductorId}
                  onChange={(e) => setConductorId(e.target.value)}
                  placeholder="Publisher-ID des Leiters"
                  className="w-full px-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
                  required
                />
                {selectedPoint?.conductorName && (
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">
                    Standard-Leiter: {selectedPoint.conductorName}
                  </p>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-1 block">Notizen (optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] resize-none"
                />
              </div>
            </>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t border-[var(--border)]">
            <button
              type="submit"
              disabled={saving || loading}
              className="flex-1 py-2.5 text-sm font-semibold bg-[var(--amber)] text-black rounded-[var(--radius-sm)] hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
            >
              {saving ? "Erstelle..." : "Termin erstellen"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-sm text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer"
            >
              Abbrechen
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
