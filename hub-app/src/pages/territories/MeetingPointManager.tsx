import { useState } from "react";
import {
  MapPin,
  Plus,
  Trash2,
  Edit,
  User,
  Users,
  Save,
  X,
  Search,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { usePermissions } from "@/auth/PermissionProvider";
import { getApiUrl } from "@/lib/config";

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
  fieldGroups: unknown[];
}

interface MeetingPointManagerProps {
  campaignId: string;
  campaignStatus: string;
  meetingPoints: MeetingPoint[];
  onRefresh: () => void;
}

interface FormData {
  name: string;
  conductorId: string;
  assistantIds: string[];
  territoryIds: string[];
  address: string;
  dayOfWeek: string;
  time: string;
}

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const EMPTY_FORM: FormData = {
  name: "",
  conductorId: "",
  assistantIds: [],
  territoryIds: [],
  address: "",
  dayOfWeek: "",
  time: "",
};

interface Publisher {
  id: string;
  name: string;
}

export function MeetingPointManager({
  campaignId,
  campaignStatus,
  meetingPoints,
  onRefresh,
}: MeetingPointManagerProps) {
  const { user } = useAuth();
  const { can } = usePermissions();
  const apiUrl = getApiUrl();
  const headers: HeadersInit = { Authorization: `Bearer ${user?.access_token}`, "Content-Type": "application/json" };
  const canManage = can("app:campaigns.manage");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [publisherSearch, setPublisherSearch] = useState("");
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [publishersLoaded, setPublishersLoaded] = useState(false);

  const fetchPublishers = async () => {
    if (publishersLoaded) return;
    try {
      const res = await fetch(`${apiUrl}/territories/board/publishers`, {
        headers: { Authorization: `Bearer ${user?.access_token}` },
      });
      if (res.ok) {
        setPublishers((await res.json()) as Publisher[]);
        setPublishersLoaded(true);
      }
    } catch {
      // silently fail
    }
  };

  const handleAdd = async () => {
    if (!form.conductorId) return;
    setSaving(true);
    try {
      await fetch(`${apiUrl}/campaigns/${campaignId}/meeting-points`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          conductorId: form.conductorId,
          assistantIds: form.assistantIds,
          territoryIds: form.territoryIds,
          name: form.name || undefined,
          address: form.address || undefined,
          dayOfWeek: form.dayOfWeek || undefined,
          time: form.time || undefined,
        }),
      });
      setShowAdd(false);
      setForm(EMPTY_FORM);
      onRefresh();
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (mpId: string) => {
    setSaving(true);
    try {
      await fetch(`${apiUrl}/meeting-points/${mpId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          conductorId: form.conductorId || undefined,
          assistantIds: form.assistantIds.length > 0 ? form.assistantIds : undefined,
          name: form.name || undefined,
          address: form.address || undefined,
          dayOfWeek: form.dayOfWeek || undefined,
          time: form.time || undefined,
        }),
      });
      setEditingId(null);
      setForm(EMPTY_FORM);
      onRefresh();
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (mpId: string) => {
    try {
      await fetch(`${apiUrl}/meeting-points/${mpId}`, {
        method: "DELETE",
        headers,
      });
      onRefresh();
    } catch {
      // silently fail
    }
  };

  const startEdit = (mp: MeetingPoint) => {
    setEditingId(mp.id);
    setForm({
      name: mp.name ?? "",
      conductorId: mp.conductorId,
      assistantIds: mp.assistantIds,
      territoryIds: mp.territoryIds,
      address: mp.address ?? "",
      dayOfWeek: mp.dayOfWeek ?? "",
      time: mp.time ?? "",
    });
    fetchPublishers();
  };

  const filteredPublishers = publishers.filter((p) =>
    p.name.toLowerCase().includes(publisherSearch.toLowerCase()),
  );

  const toggleAssistant = (pubId: string) => {
    setForm((prev) => ({
      ...prev,
      assistantIds: prev.assistantIds.includes(pubId)
        ? prev.assistantIds.filter((x) => x !== pubId)
        : [...prev.assistantIds, pubId],
    }));
  };

  const isEditable = campaignStatus === "draft" && canManage;

  return (
    <div className="space-y-4">
      {/* Add button */}
      {isEditable && !showAdd && (
        <button
          onClick={() => { setShowAdd(true); fetchPublishers(); }}
          className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--amber)] border border-dashed border-[var(--amber)] rounded-[var(--radius-sm)] hover:bg-[#d9770614] transition-colors cursor-pointer"
        >
          <Plus size={14} /> Add Meeting Point
        </button>
      )}

      {/* Add form */}
      {showAdd && (
        <MeetingPointFormCard
          form={form}
          setForm={setForm}
          publishers={filteredPublishers}
          publisherSearch={publisherSearch}
          setPublisherSearch={setPublisherSearch}
          toggleAssistant={toggleAssistant}
          onSave={handleAdd}
          onCancel={() => { setShowAdd(false); setForm(EMPTY_FORM); }}
          saving={saving}
          isNew
        />
      )}

      {/* Meeting point cards */}
      {meetingPoints.map((mp) => (
        <div key={mp.id}>
          {editingId === mp.id ? (
            <MeetingPointFormCard
              form={form}
              setForm={setForm}
              publishers={filteredPublishers}
              publisherSearch={publisherSearch}
              setPublisherSearch={setPublisherSearch}
              toggleAssistant={toggleAssistant}
              onSave={() => handleUpdate(mp.id)}
              onCancel={() => { setEditingId(null); setForm(EMPTY_FORM); }}
              saving={saving}
              isNew={false}
            />
          ) : (
            <div className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin size={16} className="text-[var(--amber)]" />
                  <span className="text-sm font-semibold text-[var(--text)]">
                    {mp.name ?? "Unnamed Meeting Point"}
                  </span>
                </div>
                {isEditable && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => startEdit(mp)}
                      className="p-1.5 rounded text-[var(--text-muted)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
                    >
                      <Edit size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(mp.id)}
                      className="p-1.5 rounded text-[var(--red)] hover:bg-[#ef444414] transition-colors cursor-pointer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
                {mp.address && <p className="flex items-center gap-1"><MapPin size={10} /> {mp.address}</p>}
                {mp.dayOfWeek && mp.time && <p>{mp.dayOfWeek} at {mp.time}</p>}
                <p className="flex items-center gap-1">
                  <User size={10} /> Conductor: {mp.conductorId.slice(0, 8)}...
                </p>
                {mp.assistantIds.length > 0 && (
                  <p className="flex items-center gap-1">
                    <Users size={10} /> {mp.assistantIds.length} assistant(s)
                  </p>
                )}
                <p>{mp.territoryIds.length} territories assigned</p>
              </div>
            </div>
          )}
        </div>
      ))}

      {meetingPoints.length === 0 && !showAdd && (
        <div className="py-8 text-center border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
          <MapPin size={24} className="text-[var(--text-muted)] mx-auto mb-2" strokeWidth={1.2} />
          <p className="text-sm text-[var(--text-muted)]">No meeting points yet.</p>
        </div>
      )}
    </div>
  );
}

// ─── Form Card ─────────────────────────────────────────────────────────

interface MeetingPointFormCardProps {
  form: FormData;
  setForm: (fn: (prev: FormData) => FormData) => void;
  publishers: Publisher[];
  publisherSearch: string;
  setPublisherSearch: (v: string) => void;
  toggleAssistant: (pubId: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  isNew: boolean;
}

function MeetingPointFormCard({
  form,
  setForm,
  publishers,
  publisherSearch,
  setPublisherSearch,
  toggleAssistant,
  onSave,
  onCancel,
  saving,
  isNew,
}: MeetingPointFormCardProps) {
  return (
    <div className="p-4 border border-[var(--amber)] rounded-[var(--radius)] bg-[var(--bg-1)] space-y-4">
      <h3 className="text-sm font-semibold text-[var(--text)]">
        {isNew ? "New Meeting Point" : "Edit Meeting Point"}
      </h3>

      {/* Name */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-[var(--text-muted)]">Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="e.g. Town Square"
          className="w-full px-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
        />
      </div>

      {/* Address */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-[var(--text-muted)]">Address</label>
        <input
          type="text"
          value={form.address}
          onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
          placeholder="Street address"
          className="w-full px-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
        />
      </div>

      {/* Day + Time */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-[var(--text-muted)]">Day</label>
          <select
            value={form.dayOfWeek}
            onChange={(e) => setForm((prev) => ({ ...prev, dayOfWeek: e.target.value }))}
            className="w-full px-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
          >
            <option value="">Select...</option>
            {DAYS_OF_WEEK.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-[var(--text-muted)]">Time</label>
          <input
            type="time"
            value={form.time}
            onChange={(e) => setForm((prev) => ({ ...prev, time: e.target.value }))}
            className="w-full px-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
          />
        </div>
      </div>

      {/* Conductor */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-[var(--text-muted)]">Conductor</label>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={publisherSearch}
            onChange={(e) => setPublisherSearch(e.target.value)}
            placeholder="Search publishers..."
            className="w-full pl-8 pr-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
          />
        </div>
        <div className="max-h-32 overflow-y-auto space-y-1 border border-[var(--border)] rounded-[var(--radius-sm)] p-1">
          {publishers.map((p) => (
            <button
              key={p.id}
              onClick={() => setForm((prev) => ({ ...prev, conductorId: p.id }))}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors cursor-pointer ${
                form.conductorId === p.id
                  ? "bg-[var(--glass-2)] text-[var(--amber)]"
                  : "text-[var(--text)] hover:bg-[var(--glass)]"
              }`}
            >
              <User size={12} />
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Assistants (multi-select) */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-[var(--text-muted)]">
          Assistants ({form.assistantIds.length} selected)
        </label>
        <div className="max-h-24 overflow-y-auto space-y-1 border border-[var(--border)] rounded-[var(--radius-sm)] p-1">
          {publishers.filter((p) => p.id !== form.conductorId).map((p) => {
            const isSelected = form.assistantIds.includes(p.id);
            return (
              <button
                key={p.id}
                onClick={() => toggleAssistant(p.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors cursor-pointer ${
                  isSelected
                    ? "bg-[#3b82f614] text-[var(--blue)]"
                    : "text-[var(--text)] hover:bg-[var(--glass)]"
                }`}
              >
                <Users size={12} />
                {p.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          className="flex items-center gap-1 px-3 py-1.5 text-xs text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
        >
          <X size={12} /> Cancel
        </button>
        <button
          onClick={onSave}
          disabled={saving || !form.conductorId}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-[var(--amber)] text-black rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Save size={12} /> {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
