import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import { FormattedMessage } from "react-intl";
import { ArrowLeft, Shield, UserCheck, UserX, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/auth/useAuth";

interface Publisher {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  gender: string | null;
  congregationRole: string;
  congregationFlags: string[];
  status: string;
  privacyAccepted: boolean;
  createdAt: string;
  approvedAt: string | null;
  appRoles: { id: string; roleId: string; validFrom: string | null; validTo: string | null; role: { name: string; scope: string } }[];
}

interface AppRole {
  id: string;
  name: string;
  scope: string;
  isSystem: boolean;
}

export function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [publisher, setPublisher] = useState<Publisher | null>(null);
  const [allRoles, setAllRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const apiUrl = import.meta.env.VITE_API_URL ?? "";
  const headers = { Authorization: `Bearer ${user?.access_token}`, "Content-Type": "application/json" };

  useEffect(() => {
    const fetch_ = async () => {
      try {
        const [pubRes, rolesRes] = await Promise.all([
          fetch(`${apiUrl}/publishers/${id}`, { headers }),
          fetch(`${apiUrl}/roles`, { headers }),
        ]);
        if (pubRes.ok) setPublisher(await pubRes.json() as Publisher);
        if (rolesRes.ok) setAllRoles(await rolesRes.json() as AppRole[]);
      } finally {
        setLoading(false);
      }
    };
    fetch_();
  }, [id]);

  const doAction = async (action: string) => {
    const res = await fetch(`${apiUrl}/users/${id}/${action}`, { method: "POST", headers });
    if (res.ok) {
      setPublisher(await res.json() as Publisher);
    }
  };

  const assignRole = async (roleId: string) => {
    if (!publisher) return;
    const res = await fetch(`${apiUrl}/roles/${roleId}/members`, {
      method: "POST",
      headers,
      body: JSON.stringify({ publisherId: publisher.id }),
    });
    if (res.ok) {
      // Refresh
      const pubRes = await fetch(`${apiUrl}/publishers/${id}`, { headers });
      if (pubRes.ok) setPublisher(await pubRes.json() as Publisher);
    }
  };

  const removeRole = async (roleId: string) => {
    if (!publisher) return;
    await fetch(`${apiUrl}/roles/${roleId}/members/${publisher.id}`, { method: "DELETE", headers });
    const pubRes = await fetch(`${apiUrl}/publishers/${id}`, { headers });
    if (pubRes.ok) setPublisher(await pubRes.json() as Publisher);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!publisher) {
    return <p className="text-[var(--text-muted)]">Publisher not found</p>;
  }

  const assignedRoleIds = new Set(publisher.appRoles.map((ar) => ar.roleId));
  const availableRoles = allRoles.filter((r) => !assignedRoleIds.has(r.id));

  return (
    <div className="space-y-6 max-w-2xl">
      <button onClick={() => navigate("/users")} className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer">
        <ArrowLeft size={16} />
        <FormattedMessage id="common.back" />
      </button>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text)]">
            {publisher.displayName ?? `${publisher.firstName} ${publisher.lastName}`}
          </h1>
          <p className="text-sm text-[var(--text-muted)]">
            {publisher.congregationRole.replace("_", " ")}
            {publisher.congregationFlags.length > 0 && ` · ${publisher.congregationFlags.join(", ")}`}
          </p>
        </div>
        <div className="flex gap-2">
          {(publisher.status === "pending_approval" || publisher.status === "invited") && (
            <>
              <button onClick={() => doAction("approve")} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[var(--green)] text-white rounded-[var(--radius-sm)] hover:opacity-90 cursor-pointer">
                <UserCheck size={14} />
                <FormattedMessage id="users.approve" />
              </button>
              <button onClick={() => doAction("reject")} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[var(--red)] text-white rounded-[var(--radius-sm)] hover:opacity-90 cursor-pointer">
                <UserX size={14} />
                <FormattedMessage id="users.reject" />
              </button>
            </>
          )}
          {publisher.status === "active" && (
            <button onClick={() => doAction("deactivate")} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--red)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer">
              <UserX size={14} />
              <FormattedMessage id="users.deactivate" />
            </button>
          )}
          {publisher.status === "inactive" && (
            <button onClick={() => doAction("reactivate")} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--green)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer">
              <UserCheck size={14} />
              <FormattedMessage id="users.reactivate" />
            </button>
          )}
        </div>
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-2 gap-4 p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
        <div>
          <p className="text-xs text-[var(--text-muted)]"><FormattedMessage id="users.email" /></p>
          <p className="text-sm text-[var(--text)]">{publisher.email ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-muted)]"><FormattedMessage id="users.status" /></p>
          <p className="text-sm text-[var(--text)]">{publisher.status.replace("_", " ")}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-muted)]"><FormattedMessage id="users.gender" /></p>
          <p className="text-sm text-[var(--text)]">{publisher.gender ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-muted)]"><FormattedMessage id="users.privacy" /></p>
          <p className="text-sm text-[var(--text)]">{publisher.privacyAccepted ? "Accepted" : "Not accepted"}</p>
        </div>
      </div>

      {/* App Roles */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--text)]">
            <FormattedMessage id="users.appRoles" />
          </h2>
        </div>

        <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] divide-y divide-[var(--border)]">
          {publisher.appRoles.length === 0 ? (
            <p className="px-4 py-3 text-sm text-[var(--text-muted)]">No roles assigned</p>
          ) : (
            publisher.appRoles.map((ar) => (
              <div key={ar.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <Shield size={14} className="text-[var(--amber)]" />
                  <span className="text-sm text-[var(--text)]">{ar.role.name}</span>
                  <span className="text-[10px] text-[var(--text-muted)]">{ar.role.scope}</span>
                  {ar.validFrom && (
                    <span className="text-[10px] text-[var(--text-muted)]">
                      from {new Date(ar.validFrom).toLocaleDateString()}
                    </span>
                  )}
                  {ar.validTo && (
                    <span className="text-[10px] text-[var(--text-muted)]">
                      to {new Date(ar.validTo).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <button onClick={() => removeRole(ar.roleId)} className="p-1 text-[var(--text-muted)] hover:text-[var(--red)] cursor-pointer">
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>

        {availableRoles.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              id="add-role"
              className="flex-1 px-3 py-1.5 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) assignRole(e.target.value);
                e.target.value = "";
              }}
            >
              <option value="" disabled>Add role...</option>
              {availableRoles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <Plus size={16} className="text-[var(--text-muted)]" />
          </div>
        )}
      </div>
    </div>
  );
}
