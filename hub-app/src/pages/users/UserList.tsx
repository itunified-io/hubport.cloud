import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { Users, Plus, Shield, ChevronRight, UserCheck, UserX, Clock, Ban } from "lucide-react";
import { useAuth } from "@/auth/useAuth";

interface Publisher {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  email: string | null;
  congregationRole: string;
  congregationFlags: string[];
  status: string;
  role: string;
  createdAt: string;
  appRoles: { role: { name: string; scope: string } }[];
}

function statusPill(status: string) {
  const styles: Record<string, string> = {
    invited: "text-[var(--amber)] bg-[#d9770614]",
    pending_approval: "text-[var(--blue)] bg-[#3b82f614]",
    active: "text-[var(--green)] bg-[#22c55e14]",
    inactive: "text-[var(--text-muted)] bg-[var(--glass)]",
    rejected: "text-[var(--red)] bg-[#ef444414]",
  };
  const icons: Record<string, React.ElementType> = {
    invited: Clock,
    pending_approval: Clock,
    active: UserCheck,
    inactive: UserX,
    rejected: Ban,
  };
  const Icon = icons[status] ?? UserCheck;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${styles[status] ?? styles.active}`}>
      <Icon size={10} />
      {status.replace("_", " ")}
    </span>
  );
}

function congregationRoleBadge(role: string) {
  const colors: Record<string, string> = {
    elder: "text-[var(--amber)] bg-[#d9770614]",
    ministerial_servant: "text-[var(--blue)] bg-[#3b82f614]",
    publisher: "text-[var(--text-muted)] bg-[var(--glass)]",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${colors[role] ?? colors.publisher}`}>
      <Shield size={10} />
      {role.replace("_", " ")}
    </span>
  );
}

export function UserList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const intl = useIntl();
  const [users, setUsers] = useState<Publisher[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL ?? "";
        const res = await fetch(`${apiUrl}/users`, {
          headers: { Authorization: `Bearer ${user?.access_token}` },
        });
        if (res.ok) {
          setUsers(await res.json() as Publisher[]);
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, [user?.access_token]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--text)]">
          <FormattedMessage id="users.title" />
        </h1>
        <button
          onClick={() => {/* TODO: invite modal */}}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--amber)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer"
        >
          <Plus size={16} />
          <FormattedMessage id="users.invite" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : users.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
          <Users size={40} className="text-[var(--text-muted)] mb-3" strokeWidth={1.2} />
          <p className="text-sm text-[var(--text-muted)]">
            <FormattedMessage id="users.empty" />
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            <FormattedMessage id="users.empty.hint" />
          </p>
        </div>
      ) : (
        <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                <th className="px-4 py-3 font-medium">
                  <FormattedMessage id="users.name" />
                </th>
                <th className="px-4 py-3 font-medium hidden sm:table-cell">
                  <FormattedMessage id="users.email" />
                </th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">
                  <FormattedMessage id="users.congregationRole" />
                </th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">
                  {intl.formatMessage({ id: "users.appRoles" })}
                </th>
                <th className="px-4 py-3 font-medium">
                  <FormattedMessage id="users.status" />
                </th>
                <th className="px-4 py-3 font-medium w-8" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  onClick={() => navigate(`/users/${u.id}`)}
                  className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--glass)] transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3 text-[var(--text)]">
                    {u.displayName ?? `${u.firstName} ${u.lastName}`}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)] hidden sm:table-cell">
                    {u.email ?? "—"}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {congregationRoleBadge(u.congregationRole)}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {u.appRoles.map((ar) => (
                        <span
                          key={ar.role.name}
                          className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium text-[var(--text-muted)] bg-[var(--glass)]"
                        >
                          {ar.role.name}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">{statusPill(u.status)}</td>
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
