/**
 * FieldGroupManager — Conductor view for organizing signed-up publishers
 * into field groups with territory assignment.
 */

import { useState } from "react";
import { Plus, Users, Map, Trash2, GripVertical } from "lucide-react";
import {
  createFieldGroup,
  updateFieldGroup,
  type ServiceMeetingSignup,
  type ServiceMeetingFieldGroup,
} from "@/lib/field-service-api";

interface FieldGroupManagerProps {
  meetingId: string;
  token: string;
  signups: ServiceMeetingSignup[];
  fieldGroups: ServiceMeetingFieldGroup[];
  meetingStatus: string;
  onRefresh: () => void;
}

interface DraftGroup {
  name: string;
  leaderId: string;
  memberIds: string[];
  territoryIds: string[];
}

export function FieldGroupManager({
  meetingId,
  token,
  signups,
  fieldGroups,
  meetingStatus,
  onRefresh,
}: FieldGroupManagerProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState<DraftGroup>({
    name: "",
    leaderId: "",
    memberIds: [],
    territoryIds: [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  // Active signups (not cancelled)
  const activeSignups = signups.filter((s) => !s.cancelledAt);

  // Publishers already assigned to a group
  const assignedPublisherIds = new Set(
    fieldGroups.flatMap((g) => [g.leaderId, ...g.memberIds]),
  );

  // Unassigned publishers
  const unassigned = activeSignups.filter(
    (s) => !assignedPublisherIds.has(s.publisherId),
  );

  async function handleCreateGroup() {
    if (!draft.leaderId) {
      setError("Bitte einen Gruppenleiter wählen.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createFieldGroup(
        meetingId,
        {
          name: draft.name || undefined,
          leaderId: draft.leaderId,
          memberIds: draft.memberIds,
          territoryIds: draft.territoryIds,
        },
        token,
      );
      setDraft({ name: "", leaderId: "", memberIds: [], territoryIds: [] });
      setShowCreate(false);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create group");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateGroup(groupId: string, memberIds: string[]) {
    setSaving(true);
    try {
      await updateFieldGroup(groupId, { memberIds }, token);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update group");
    } finally {
      setSaving(false);
    }
  }

  function toggleMember(publisherId: string) {
    setDraft((prev) => ({
      ...prev,
      memberIds: prev.memberIds.includes(publisherId)
        ? prev.memberIds.filter((id) => id !== publisherId)
        : [...prev.memberIds, publisherId],
    }));
  }

  function addTerritoryId() {
    const id = prompt("Gebiets-ID eingeben:");
    if (id?.trim()) {
      setDraft((prev) => ({
        ...prev,
        territoryIds: [...prev.territoryIds, id.trim()],
      }));
    }
  }

  const isEditable = meetingStatus !== "completed" && meetingStatus !== "cancelled";

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-2 text-xs bg-red-500/10 border border-red-500/30 rounded-[var(--radius-sm)] text-red-400">
          {error}
        </div>
      )}

      {/* Unassigned publishers */}
      {unassigned.length > 0 && (
        <div className="p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-[var(--radius-sm)]">
          <p className="text-xs text-yellow-400 mb-2 font-medium">
            Nicht zugewiesen ({unassigned.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {unassigned.map((s) => (
              <span
                key={s.id}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--glass)] rounded-full text-[var(--text)]"
              >
                <GripVertical size={10} className="text-[var(--text-muted)]" />
                {s.publisherName ?? s.publisherId.slice(0, 8)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Existing groups */}
      {fieldGroups.map((g) => (
        <div
          key={g.id}
          className="p-3 bg-[var(--glass-2)] border border-[var(--border)] rounded-[var(--radius-sm)]"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Users size={14} className="text-[var(--amber)]" />
              <span className="text-sm font-medium">{g.name ?? `Gruppe ${fieldGroups.indexOf(g) + 1}`}</span>
            </div>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                g.status === "in_field"
                  ? "bg-green-500/20 text-green-400"
                  : g.status === "completed"
                  ? "bg-[var(--glass)] text-[var(--text-muted)]"
                  : "bg-blue-500/20 text-blue-400"
              }`}
            >
              {g.status === "in_field" ? "Im Dienst" : g.status === "completed" ? "Zurück" : "Geplant"}
            </span>
          </div>

          {/* Leader */}
          <div className="text-xs text-[var(--text-muted)] mb-1">
            Leiter: <span className="text-[var(--text)]">{g.leaderName ?? g.leaderId.slice(0, 8)}</span>
          </div>

          {/* Members */}
          <div className="flex flex-wrap gap-1 mb-2">
            {g.memberIds.map((mid) => (
              <span
                key={mid}
                className="px-2 py-0.5 text-[10px] bg-[var(--glass)] rounded-full text-[var(--text)]"
              >
                {mid.slice(0, 8)}
              </span>
            ))}
            {g.memberIds.length === 0 && (
              <span className="text-[10px] text-[var(--text-muted)]">Keine Mitglieder</span>
            )}
          </div>

          {/* Territories */}
          {g.territoryIds.length > 0 && (
            <div className="flex items-center gap-1 mb-2">
              <Map size={10} className="text-[var(--text-muted)]" />
              <span className="text-[10px] text-[var(--text-muted)]">
                {g.territoryIds.length} Gebiet{g.territoryIds.length !== 1 ? "e" : ""}
              </span>
            </div>
          )}

          {/* Add unassigned to this group */}
          {isEditable && g.status === "planned" && unassigned.length > 0 && editingGroupId === g.id && (
            <div className="mt-2 p-2 bg-[var(--glass)] rounded border border-[var(--border)]">
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Verkündiger hinzufügen:</p>
              <div className="flex flex-wrap gap-1">
                {unassigned.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleUpdateGroup(g.id, [...g.memberIds, s.publisherId])}
                    className="px-2 py-0.5 text-[10px] bg-[var(--amber)]/10 text-[var(--amber)] rounded-full hover:bg-[var(--amber)]/20 transition-colors cursor-pointer"
                    disabled={saving}
                  >
                    + {s.publisherName ?? s.publisherId.slice(0, 8)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isEditable && g.status === "planned" && unassigned.length > 0 && editingGroupId !== g.id && (
            <button
              onClick={() => setEditingGroupId(g.id)}
              className="text-[10px] text-[var(--amber)] hover:underline cursor-pointer"
            >
              + Mitglieder hinzufügen
            </button>
          )}
        </div>
      ))}

      {/* Create group form */}
      {isEditable && showCreate && (
        <div className="p-4 bg-[var(--glass)] border border-[var(--amber)]/30 rounded-[var(--radius)]">
          <h3 className="text-sm font-medium mb-3">Neue Gruppe erstellen</h3>

          {/* Group name */}
          <input
            type="text"
            placeholder={`Gruppe ${fieldGroups.length + 1}`}
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            className="w-full mb-3 px-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
          />

          {/* Leader selection */}
          <label className="block text-xs text-[var(--text-muted)] mb-1">Gruppenleiter</label>
          <select
            value={draft.leaderId}
            onChange={(e) => setDraft((d) => ({ ...d, leaderId: e.target.value }))}
            className="w-full mb-3 px-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
          >
            <option value="">— Leiter wählen —</option>
            {activeSignups.map((s) => (
              <option key={s.publisherId} value={s.publisherId}>
                {s.publisherName ?? s.publisherId}
              </option>
            ))}
          </select>

          {/* Member selection */}
          <label className="block text-xs text-[var(--text-muted)] mb-1">Mitglieder</label>
          <div className="mb-3 space-y-1 max-h-40 overflow-y-auto">
            {activeSignups
              .filter((s) => s.publisherId !== draft.leaderId)
              .map((s) => (
                <label
                  key={s.publisherId}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--glass-2)] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={draft.memberIds.includes(s.publisherId)}
                    onChange={() => toggleMember(s.publisherId)}
                    className="accent-[var(--amber)]"
                  />
                  <span className="text-sm">{s.publisherName ?? s.publisherId}</span>
                </label>
              ))}
          </div>

          {/* Territories */}
          <label className="block text-xs text-[var(--text-muted)] mb-1">Gebiete</label>
          <div className="flex flex-wrap gap-1 mb-2">
            {draft.territoryIds.map((tid, i) => (
              <span
                key={tid}
                className="flex items-center gap-1 px-2 py-0.5 text-xs bg-[var(--glass)] rounded-full"
              >
                {tid}
                <button
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      territoryIds: d.territoryIds.filter((_, j) => j !== i),
                    }))
                  }
                  className="text-[var(--text-muted)] hover:text-[var(--red)] cursor-pointer"
                >
                  <Trash2 size={10} />
                </button>
              </span>
            ))}
          </div>
          <button
            onClick={addTerritoryId}
            className="text-xs text-[var(--amber)] hover:underline cursor-pointer mb-3"
          >
            + Gebiet hinzufügen
          </button>

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t border-[var(--border)]">
            <button
              onClick={handleCreateGroup}
              disabled={saving || !draft.leaderId}
              className="flex-1 py-2 text-sm font-semibold bg-[var(--amber)] text-black rounded-[var(--radius-sm)] hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
            >
              {saving ? "..." : "Gruppe erstellen"}
            </button>
            <button
              onClick={() => {
                setShowCreate(false);
                setDraft({ name: "", leaderId: "", memberIds: [], territoryIds: [] });
              }}
              className="px-4 py-2 text-sm text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* Create button */}
      {isEditable && !showCreate && (
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 w-full justify-center py-2.5 text-sm border border-dashed border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--amber)] hover:border-[var(--amber)] transition-colors cursor-pointer"
        >
          <Plus size={14} /> Neue Gruppe
        </button>
      )}
    </div>
  );
}
