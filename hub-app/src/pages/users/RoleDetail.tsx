import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import { FormattedMessage } from "react-intl";
import { ArrowLeft, Shield, Lock, Users, Trash2 } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";

interface AppRoleDetail {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  scope: string;
  isSystem: boolean;
  members: {
    id: string;
    publisherId: string;
    validFrom: string | null;
    validTo: string | null;
    publisher: { firstName: string; lastName: string; displayName: string | null };
  }[];
}

export function RoleDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState<AppRoleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const apiUrl = getApiUrl();
  const headers = { Authorization: `Bearer ${user?.access_token}`, "Content-Type": "application/json" };

  const fetchRole = async () => {
    try {
      const res = await fetch(`${apiUrl}/roles`, { headers });
      if (res.ok) {
        const roles = await res.json() as AppRoleDetail[];
        const found = roles.find((r) => r.id === id);
        if (found) setRole(found);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRole(); }, [id]);

  const removeMember = async (publisherId: string) => {
    await fetch(`${apiUrl}/roles/${id}/members/${publisherId}`, { method: "DELETE", headers });
    fetchRole();
  };

  const deleteRole = async () => {
    if (!role || role.isSystem) return;
    const res = await fetch(`${apiUrl}/roles/${id}`, { method: "DELETE", headers });
    if (res.ok) navigate("/users/roles");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!role) return <p className="text-[var(--text-muted)]">Role not found</p>;

  // Group permissions by category
  const permGroups: Record<string, string[]> = {};
  for (const p of role.permissions) {
    const cat = p.split(":")[0] ?? "other";
    if (!permGroups[cat]) permGroups[cat] = [];
    permGroups[cat].push(p);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <button onClick={() => navigate("/users/roles")} className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer">
        <ArrowLeft size={16} />
        <FormattedMessage id="common.back" />
      </button>

      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Shield size={24} className="text-[var(--amber)]" />
          <div>
            <h1 className="text-xl font-semibold text-[var(--text)] flex items-center gap-2">
              {role.name}
              {role.isSystem && <Lock size={14} className="text-[var(--text-muted)]" />}
            </h1>
            <p className="text-sm text-[var(--text-muted)]">{role.description}</p>
          </div>
        </div>
        {!role.isSystem && (
          <button onClick={deleteRole} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--red)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer">
            <Trash2 size={14} />
            <FormattedMessage id="common.delete" />
          </button>
        )}
      </div>

      {/* Scope */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--text-muted)]"><FormattedMessage id="roles.scope" />:</span>
        <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-medium text-[var(--text-muted)] bg-[var(--glass)]">
          {role.scope}
        </span>
      </div>

      {/* Permissions */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-[var(--text)]">
          <FormattedMessage id="roles.permissions" />
        </h2>
        <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-4 space-y-3">
          {Object.entries(permGroups).map(([cat, perms]) => (
            <div key={cat}>
              <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase mb-1">{cat}</p>
              <div className="flex flex-wrap gap-1">
                {perms.map((p) => (
                  <span key={p} className="inline-flex px-2 py-0.5 rounded text-[10px] font-mono text-[var(--text)] bg-[var(--glass)]">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Members */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-[var(--text)] flex items-center gap-2">
          <Users size={14} />
          <FormattedMessage id="roles.members" />
          {role.members && <span className="text-xs text-[var(--text-muted)]">({role.members.length})</span>}
        </h2>
        <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] divide-y divide-[var(--border)]">
          {(!role.members || role.members.length === 0) ? (
            <p className="px-4 py-3 text-sm text-[var(--text-muted)]">No members assigned</p>
          ) : (
            role.members.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <span className="text-sm text-[var(--text)]">
                    {m.publisher.displayName ?? `${m.publisher.firstName} ${m.publisher.lastName}`}
                  </span>
                  {(m.validFrom || m.validTo) && (
                    <span className="text-[10px] text-[var(--text-muted)] ml-2">
                      {m.validFrom && `from ${new Date(m.validFrom).toLocaleDateString()}`}
                      {m.validTo && ` to ${new Date(m.validTo).toLocaleDateString()}`}
                    </span>
                  )}
                </div>
                <button onClick={() => removeMember(m.publisherId)} className="p-1 text-[var(--text-muted)] hover:text-[var(--red)] cursor-pointer">
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
