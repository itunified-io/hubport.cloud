import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, MapPin, Save } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import {
  createMeetingPoint,
  getMeetingPoint,
  updateMeetingPoint,
} from "@/lib/field-service-api";
import { listTerritories, type TerritoryListItem } from "@/lib/territory-api";

const DAY_OPTIONS = [
  { value: 0, label: "Sonntag" },
  { value: 1, label: "Montag" },
  { value: 2, label: "Dienstag" },
  { value: 3, label: "Mittwoch" },
  { value: 4, label: "Donnerstag" },
  { value: 5, label: "Freitag" },
  { value: 6, label: "Samstag" },
];

export function MeetingPointForm() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const token = user?.access_token;
  const isEdit = Boolean(id);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [dayOfWeek, setDayOfWeek] = useState(6); // Saturday default
  const [time, setTime] = useState("10:00");
  const [maxParticipants, setMaxParticipants] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [selectedTerritoryIds, setSelectedTerritoryIds] = useState<string[]>([]);
  const [territories, setTerritories] = useState<TerritoryListItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);

  // Load existing data for edit
  useEffect(() => {
    if (!token) return;
    if (isEdit && id) {
      getMeetingPoint(id, token)
        .then((mp) => {
          setName(mp.name);
          setAddress(mp.address ?? "");
          setLatitude(mp.latitude);
          setLongitude(mp.longitude);
          setDayOfWeek(mp.dayOfWeek);
          setTime(mp.time);
          setMaxParticipants(mp.maxParticipants);
          setNotes(mp.notes ?? "");
          setSelectedTerritoryIds(mp.territoryIds);
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }
    // Load territories for selector
    listTerritories(token, { lite: true, type: "territory" })
      .then(setTerritories)
      .catch(() => {});
  }, [token, id, isEdit]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !name.trim()) return;
    setSaving(true);
    setError(null);

    const data = {
      name: name.trim(),
      address: address.trim() || null,
      latitude,
      longitude,
      dayOfWeek,
      time,
      maxParticipants,
      notes: notes.trim() || null,
      territoryIds: selectedTerritoryIds,
    };

    try {
      if (isEdit && id) {
        await updateMeetingPoint(id, data, token);
      } else {
        await createMeetingPoint(data, token);
      }
      navigate("/field-service/meeting-points");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function toggleTerritory(tid: string) {
    setSelectedTerritoryIds((prev) =>
      prev.includes(tid) ? prev.filter((t) => t !== tid) : [...prev, tid],
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate("/field-service/meeting-points")}
          className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
        >
          <ArrowLeft size={18} />
        </button>
        <MapPin size={22} className="text-[var(--amber)]" />
        <h1 className="text-xl font-semibold">
          {isEdit ? "Treffpunkt bearbeiten" : "Neuer Treffpunkt"}
        </h1>
      </div>

      {error && (
        <div className="p-3 mb-4 bg-red-500/10 border border-red-500/30 rounded-[var(--radius-sm)] text-red-400 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium mb-1.5">Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z.B. Königreichssaal Samstag"
            required
            className="w-full px-3 py-2 bg-[var(--glass)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm focus:outline-none focus:border-[var(--amber)]"
          />
        </div>

        {/* Address */}
        <div>
          <label className="block text-sm font-medium mb-1.5">Adresse</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Stra��e, PLZ Ort"
            className="w-full px-3 py-2 bg-[var(--glass)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm focus:outline-none focus:border-[var(--amber)]"
          />
        </div>

        {/* Coordinates */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Breitengrad</label>
            <input
              type="number"
              step="any"
              value={latitude ?? ""}
              onChange={(e) => setLatitude(e.target.value ? Number(e.target.value) : null)}
              placeholder="47.7532"
              className="w-full px-3 py-2 bg-[var(--glass)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm focus:outline-none focus:border-[var(--amber)]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Längengrad</label>
            <input
              type="number"
              step="any"
              value={longitude ?? ""}
              onChange={(e) => setLongitude(e.target.value ? Number(e.target.value) : null)}
              placeholder="11.3775"
              className="w-full px-3 py-2 bg-[var(--glass)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm focus:outline-none focus:border-[var(--amber)]"
            />
          </div>
        </div>

        {/* Day + Time */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Wochentag *</label>
            <select
              value={dayOfWeek}
              onChange={(e) => setDayOfWeek(Number(e.target.value))}
              className="w-full px-3 py-2 bg-[var(--glass)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm focus:outline-none focus:border-[var(--amber)]"
            >
              {DAY_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Uhrzeit *</label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              required
              className="w-full px-3 py-2 bg-[var(--glass)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm focus:outline-none focus:border-[var(--amber)]"
            />
          </div>
        </div>

        {/* Max participants */}
        <div>
          <label className="block text-sm font-medium mb-1.5">Max. Teilnehmer (optional)</label>
          <input
            type="number"
            min="1"
            value={maxParticipants ?? ""}
            onChange={(e) => setMaxParticipants(e.target.value ? Number(e.target.value) : null)}
            placeholder="Unbegrenzt"
            className="w-full px-3 py-2 bg-[var(--glass)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm focus:outline-none focus:border-[var(--amber)]"
          />
        </div>

        {/* Territory selector */}
        <div>
          <label className="block text-sm font-medium mb-1.5">
            Gebiete ({selectedTerritoryIds.length} ausgewählt)
          </label>
          <div className="max-h-40 overflow-y-auto bg-[var(--glass)] border border-[var(--border)] rounded-[var(--radius-sm)] p-2">
            {territories.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] p-2">Keine Gebiete verfügbar</p>
            ) : (
              territories.map((t) => (
                <label
                  key={t.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--glass-2)] cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedTerritoryIds.includes(t.id)}
                    onChange={() => toggleTerritory(t.id)}
                    className="rounded"
                  />
                  <span className="font-mono text-xs text-[var(--amber)]">{t.number}</span>
                  <span className="text-[var(--text-muted)]">{t.name}</span>
                </label>
              ))
            )}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium mb-1.5">Notizen</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Interne Notizen..."
            className="w-full px-3 py-2 bg-[var(--glass)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm focus:outline-none focus:border-[var(--amber)] resize-none"
          />
        </div>

        {/* Submit */}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-[var(--amber)] text-black rounded-[var(--radius-sm)] font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
          >
            <Save size={16} />
            {saving ? "Speichern..." : isEdit ? "Aktualisieren" : "Erstellen"}
          </button>
          <button
            type="button"
            onClick={() => navigate("/field-service/meeting-points")}
            className="px-5 py-2.5 border border-[var(--border)] rounded-[var(--radius-sm)] text-sm hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            Abbrechen
          </button>
        </div>
      </form>
    </div>
  );
}
