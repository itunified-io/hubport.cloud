import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { FormattedMessage } from "react-intl";
import { Shield, Plus, Lock, ChevronRight, Users } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";

interface AppRole {
  id: string;
  name: string;
  description: string | null;
  scope: string;
  isSystem: boolean;
  _count: { members: number };
}

export function RoleList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRoles = async () => {
      try {
        const apiUrl = getApiUrl();
        const res = await fetch(`${apiUrl}/roles`, {
          headers: { Authorization: `Bearer ${user?.access_token}` },
        });
        if (res.ok) setRoles(await res.json() as AppRole[]);
      } finally {
        setLoading(false);
      }
    };
    fetchRoles();
  }, [user?.access_token]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--text)]">
          <FormattedMessage id="roles.title" />
        </h1>
        <button
          onClick={() => {/* TODO: create role modal */}}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--amber)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer"
        >
          <Plus size={16} />
          <FormattedMessage id="roles.create" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                <th className="px-4 py-3 font-medium"><FormattedMessage id="roles.name" /></th>
                <th className="px-4 py-3 font-medium hidden sm:table-cell"><FormattedMessage id="roles.description" /></th>
                <th className="px-4 py-3 font-medium"><FormattedMessage id="roles.scope" /></th>
                <th className="px-4 py-3 font-medium"><FormattedMessage id="roles.members" /></th>
                <th className="px-4 py-3 font-medium w-8" />
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr
                  key={role.id}
                  onClick={() => navigate(`/users/roles/${role.id}`)}
                  className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--glass)] transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Shield size={14} className="text-[var(--amber)]" />
                      <span className="text-[var(--text)]">{role.name}</span>
                      {role.isSystem && <Lock size={10} className="text-[var(--text-muted)]" />}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)] hidden sm:table-cell">
                    {role.description ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-medium text-[var(--text-muted)] bg-[var(--glass)]">
                      {role.scope}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 text-[var(--text-muted)]">
                      <Users size={12} />
                      <span className="text-xs">{role._count.members}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <ChevronRight size={14} className="text-[var(--text-muted)]" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
