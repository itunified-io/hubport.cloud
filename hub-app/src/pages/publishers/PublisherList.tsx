import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { Users, UserPlus, Shield, ChevronRight, UserCheck, UserX, Clock, Ban, Crown, Filter } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";

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
  isOwner: boolean;
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

function systemRoleBadge(role: string, isOwner: boolean) {
  const colors: Record<string, string> = {
    admin: "text-[var(--red)] bg-[#ef444414]",
    elder: "text-[var(--amber)] bg-[#d9770614]",
    publisher: "text-[var(--text-muted)] bg-[var(--glass)]",
    viewer: "text-[var(--text-muted)] bg-[var(--glass)]",
  };
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${colors[role] ?? colors.publisher}`}>
        {role}
      </span>
      {isOwner && (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold text-[var(--amber)] bg-[#d9770614]">
          <Crown size={9} />
          owner
        </span>
      )}
    </span>
  );
}

const ROLE_FILTER_OPTIONS = ["all", "elder", "ministerial_servant", "publisher"] as const;

export function PublisherList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const intl = useIntl();
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState<typeof ROLE_FILTER_OPTIONS[number]>("all");

  useEffect(() => {
    const fetchPublishers = async () => {
      try {
        const apiUrl = getApiUrl();
        const res = await fetch(`${apiUrl}/publishers`, {
          headers: { Authorization: `Bearer ${user?.access_token}` },
        });
        if (res.ok) {
          setPublishers(await res.json() as Publisher[]);
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    };
    fetchPublishers();
  }, [user?.access_token]);

  const filtered = publishers.filter((p) => {
    if (roleFilter !== "all" && p.congregationRole !== roleFilter) return false;
    if (!filter) return true;
    const name = (p.displayName ?? `${p.firstName} ${p.lastName}`).toLowerCase();
    const q = filter.toLowerCase();
    return name.includes(q) || p.email?.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--text)]">
          <FormattedMessage id="publishers.title" />
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => navigate("/publishers/service-groups")}
            className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            <Users size={14} />
            <FormattedMessage id="serviceGroups.title" />
          </button>
          <button
            onClick={() => navigate("/publishers/new")}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--amber)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer"
          >
            <UserPlus size={16} />
            <FormattedMessage id="publishers.invite" />
          </button>
        </div>
      </div>

      {/* Search + role filter */}
      {publishers.length > 0 && (
        <div className="space-y-3">
          <input
            type="text"
            placeholder={intl.formatMessage({ id: "publishers.search" })}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full px-3 py-2 bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
          />
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-[var(--text-muted)]" />
            {ROLE_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt}
                onClick={() => setRoleFilter(opt)}
                className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors cursor-pointer ${
                  roleFilter === opt
                    ? "bg-[var(--amber)] text-black border-[var(--amber)] font-semibold"
                    : "text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--amber)] hover:text-[var(--text)]"
                }`}
              >
                {opt === "all"
                  ? intl.formatMessage({ id: "publishers.filter.all" })
                  : opt === "ministerial_servant"
                    ? intl.formatMessage({ id: "publishers.role.ministerialServant" })
                    : intl.formatMessage({ id: `publishers.role.${opt}` })}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
          <Users size={40} className="text-[var(--text-muted)] mb-3" strokeWidth={1.2} />
          <p className="text-sm text-[var(--text-muted)]">
            <FormattedMessage id="publishers.empty" />
          </p>
        </div>
      ) : (
        <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                <th className="px-4 py-3 font-medium">
                  <FormattedMessage id="publishers.name" />
                </th>
                <th className="px-4 py-3 font-medium hidden sm:table-cell">
                  <FormattedMessage id="publishers.email" />
                </th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">
                  <FormattedMessage id="publishers.congregationRole" />
                </th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">
                  {intl.formatMessage({ id: "publishers.systemRole" })}
                </th>
                <th className="px-4 py-3 font-medium">
                  <FormattedMessage id="publishers.status" />
                </th>
                <th className="px-4 py-3 font-medium w-8" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => navigate(`/publishers/${p.id}`)}
                  className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--glass)] transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3 text-[var(--text)]">
                    {p.displayName ?? `${p.firstName} ${p.lastName}`}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)] hidden sm:table-cell">
                    {p.email ?? "—"}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {congregationRoleBadge(p.congregationRole)}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {systemRoleBadge(p.role, p.isOwner)}
                  </td>
                  <td className="px-4 py-3">{statusPill(p.status)}</td>
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
