import { useState, useEffect } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { ArrowLeft, Users, UserPlus, X, Shield, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "@/auth/useAuth";
import { usePermissions } from "@/auth/PermissionProvider";
import { getApiUrl } from "@/lib/config";

interface Publisher {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
}

interface ServiceGroup {
  id: string;
  name: string;
  overseerId: string | null;
  assistantId: string | null;
  overseerPub: Publisher | null;
  assistantPub: Publisher | null;
  sortOrder: number;
  members: Publisher[];
  _count: { members: number; cleaningSchedules: number };
}

interface UnassignedPublisher {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  serviceGroupId: string | null;
}

export function ServiceGroups() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const intl = useIntl();
  const apiUrl = getApiUrl();
  const headers = { Authorization: `Bearer ${user?.access_token}`, "Content-Type": "application/json" };
  const canEdit = can("app:settings.edit");

  const [groups, setGroups] = useState<ServiceGroup[]>([]);
  const [allPublishers, setAllPublishers] = useState<UnassignedPublisher[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingTo, setAddingTo] = useState<string | null>(null); // groupId being edited

  const fetchAll = async () => {
    try {
      const [gRes, pRes] = await Promise.all([
        fetch(`${apiUrl}/service-groups`, { headers }),
        fetch(`${apiUrl}/publishers`, { headers }),
      ]);
      if (gRes.ok) setGroups(await gRes.json() as ServiceGroup[]);
      if (pRes.ok) setAllPublishers(await pRes.json() as UnassignedPublisher[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, [user?.access_token]);

  const seedGroups = async () => {
    await fetch(`${apiUrl}/service-groups/seed`, { headers });
    fetchAll();
  };

  const addMember = async (groupId: string, publisherId: string) => {
    await fetch(`${apiUrl}/service-groups/${groupId}/members`, {
      method: "POST", headers, body: JSON.stringify({ publisherId }),
    });
    setAddingTo(null);
    fetchAll();
  };

  const removeMember = async (groupId: string, publisherId: string) => {
    await fetch(`${apiUrl}/service-groups/${groupId}/members/${publisherId}`, {
      method: "DELETE", headers,
    });
    fetchAll();
  };

  const updateGroupRole = async (groupId: string, field: "overseerId" | "assistantId", publisherId: string | null) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    await fetch(`${apiUrl}/service-groups/${groupId}`, {
      method: "PUT", headers,
      body: JSON.stringify({ name: group.name, [field]: publisherId || null }),
    });
    fetchAll();
  };

  // Publishers not assigned to any group
  const assignedIds = new Set(groups.flatMap((g) => g.members.map((m) => m.id)));
  const unassigned = allPublishers.filter((p) => !assignedIds.has(p.id));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/publishers")}
          className="p-2 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-semibold text-[var(--text)]">
          <FormattedMessage id="serviceGroups.title" />
        </h1>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
          <Users size={40} className="text-[var(--text-muted)] mb-3" strokeWidth={1.2} />
          <p className="text-sm text-[var(--text-muted)] mb-4">
            <FormattedMessage id="serviceGroups.empty" />
          </p>
          {canEdit && (
            <button onClick={seedGroups} className="px-4 py-2 bg-[var(--amber)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer">
              <FormattedMessage id="serviceGroups.seed" />
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((g) => (
            <div key={g.id} className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] overflow-hidden">
              {/* Group header */}
              <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-[var(--text)]">{g.name}</h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    {g._count.members} <FormattedMessage id="serviceGroups.members" />
                  </p>
                </div>
                <Users size={16} className="text-[var(--text-muted)]" />
              </div>

              {/* Overseer & Assistant */}
              <div className="px-4 py-2 border-b border-[var(--border)] space-y-1.5">
                {/* Overseer */}
                <div className="flex items-center gap-2">
                  <Shield size={13} className="text-[var(--amber)] shrink-0" />
                  <span className="text-xs text-[var(--text-muted)] shrink-0">
                    <FormattedMessage id="serviceGroups.overseer" />:
                  </span>
                  {canEdit ? (
                    <select
                      className="flex-1 min-w-0 px-1.5 py-0.5 text-xs bg-[var(--bg-2)] border border-[var(--border)] rounded text-[var(--text)]"
                      value={g.overseerId ?? ""}
                      onChange={(e) => updateGroupRole(g.id, "overseerId", e.target.value || null)}
                    >
                      <option value="">—</option>
                      {allPublishers.map((p) => (
                        <option key={p.id} value={p.id}>{p.displayName ?? `${p.firstName} ${p.lastName}`}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-[var(--text)]">
                      {g.overseerPub ? (g.overseerPub.displayName ?? `${g.overseerPub.firstName} ${g.overseerPub.lastName}`) : "—"}
                    </span>
                  )}
                </div>
                {/* Assistant */}
                <div className="flex items-center gap-2">
                  <ShieldCheck size={13} className="text-[var(--text-muted)] shrink-0" />
                  <span className="text-xs text-[var(--text-muted)] shrink-0">
                    <FormattedMessage id="serviceGroups.assistant" />:
                  </span>
                  {canEdit ? (
                    <select
                      className="flex-1 min-w-0 px-1.5 py-0.5 text-xs bg-[var(--bg-2)] border border-[var(--border)] rounded text-[var(--text)]"
                      value={g.assistantId ?? ""}
                      onChange={(e) => updateGroupRole(g.id, "assistantId", e.target.value || null)}
                    >
                      <option value="">—</option>
                      {allPublishers.map((p) => (
                        <option key={p.id} value={p.id}>{p.displayName ?? `${p.firstName} ${p.lastName}`}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-[var(--text)]">
                      {g.assistantPub ? (g.assistantPub.displayName ?? `${g.assistantPub.firstName} ${g.assistantPub.lastName}`) : "—"}
                    </span>
                  )}
                </div>
              </div>

              {/* Members */}
              <div className="divide-y divide-[var(--border)]">
                {g.members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between px-4 py-2">
                    <span className="text-sm text-[var(--text)]">
                      {m.displayName ?? `${m.firstName} ${m.lastName}`}
                    </span>
                    {canEdit && (
                      <button
                        onClick={() => removeMember(g.id, m.id)}
                        className="p-1 text-[var(--text-muted)] hover:text-[var(--red)] cursor-pointer"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
                {g.members.length === 0 && (
                  <p className="px-4 py-3 text-xs text-[var(--text-muted)]">
                    <FormattedMessage id="serviceGroups.noMembers" />
                  </p>
                )}
              </div>

              {/* Add member */}
              {canEdit && (
                <div className="px-4 py-2 border-t border-[var(--border)]">
                  {addingTo === g.id ? (
                    <select
                      autoFocus
                      className="w-full px-2 py-1 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded text-[var(--text)]"
                      defaultValue=""
                      onChange={(e) => { if (e.target.value) addMember(g.id, e.target.value); }}
                      onBlur={() => setAddingTo(null)}
                    >
                      <option value="" disabled>{intl.formatMessage({ id: "serviceGroups.selectPublisher" })}</option>
                      {unassigned.map((p) => (
                        <option key={p.id} value={p.id}>{p.displayName ?? `${p.firstName} ${p.lastName}`}</option>
                      ))}
                    </select>
                  ) : (
                    <button
                      onClick={() => setAddingTo(g.id)}
                      className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--amber)] cursor-pointer"
                    >
                      <UserPlus size={12} />
                      <FormattedMessage id="serviceGroups.addMember" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Unassigned publishers */}
      {unassigned.length > 0 && (
        <div className="p-4 border border-[var(--border)] border-dashed rounded-[var(--radius)] bg-[var(--bg-1)]">
          <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">
            <FormattedMessage id="serviceGroups.unassigned" /> ({unassigned.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {unassigned.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-[var(--text-muted)] bg-[var(--glass)] rounded">
                {p.displayName ?? `${p.firstName} ${p.lastName}`}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
