import { useState, useEffect, useCallback } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useNavigate } from "react-router";
import {
  Plus,
  Users,
  Shield,
  Wrench,
  User,
  Wifi,
  WifiOff,
  Send,
  Check,
  X,
  Search,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { usePermissions } from "@/auth/PermissionProvider";

interface Publisher {
  id: string;
  firstName: string;
  lastName: string;
  displayName?: string;
  email?: string;
  phone?: string;
  congregationRole: string;
  congregationFlags: string[];
  status: string;
  hasAccount?: boolean;
  keycloakSub?: string;
  appRoles?: Array<{ roleId: string; roleName: string; scope: string }>;
}

import { API_BASE } from "@/lib/config";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  inactive: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  invited: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  pending_approval: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
};

const ROLE_CONFIG: Record<string, { icon: typeof Shield; color: string; labelId: string }> = {
  elder: { icon: Shield, color: "text-amber-400", labelId: "publishers.role.elder" },
  ministerial_servant: { icon: Wrench, color: "text-blue-400", labelId: "publishers.role.ms" },
  publisher: { icon: User, color: "text-zinc-400", labelId: "publishers.role.publisher" },
};

export function PublisherList() {
  const navigate = useNavigate();
  const intl = useIntl();
  const { user } = useAuth();
  const { can } = usePermissions();
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [invitingId, setInvitingId] = useState<string | null>(null);

  const canEdit = can("app:publishers.edit");
  const canInvite = can("app:publishers.invite");

  const fetchPublishers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/publishers`, {
        headers: { Authorization: `Bearer ${user?.access_token}` },
      });
      if (res.ok) {
        setPublishers(await res.json());
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [user?.access_token]);

  useEffect(() => {
    fetchPublishers();
  }, [fetchPublishers]);

  const handleInvite = async (publisher: Publisher) => {
    if (invitingId) return;
    setInvitingId(publisher.id);
    try {
      const res = await fetch(`${API_BASE}/publishers/${publisher.id}/invite`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${user?.access_token}`,
          "Content-Type": "application/json",
        },
      });
      if (res.ok) {
        const data = await res.json();
        // Show invite code in a simple alert for now
        window.alert(
          `${intl.formatMessage({ id: "publishers.invite_code" })}: ${data.inviteCode}\n\n${intl.formatMessage({ id: "publishers.invite_expires" })}: ${new Date(data.expiresAt).toLocaleDateString()}`,
        );
        fetchPublishers();
      }
    } catch {
      // silently fail
    } finally {
      setInvitingId(null);
    }
  };

  const handleApprove = async (id: string) => {
    const res = await fetch(`${API_BASE}/publishers/${id}/approve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user?.access_token}` },
    });
    if (res.ok) fetchPublishers();
  };

  const handleReject = async (id: string) => {
    const res = await fetch(`${API_BASE}/publishers/${id}/reject`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user?.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    if (res.ok) fetchPublishers();
  };

  // Filter publishers
  const filtered = publishers.filter((p) => {
    const name = `${p.firstName} ${p.lastName}`.toLowerCase();
    if (search && !name.includes(search.toLowerCase())) return false;
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (roleFilter !== "all" && p.congregationRole !== roleFilter) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-[var(--amber)]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--text)]">
          <FormattedMessage id="publishers.title" />
        </h1>
        {canEdit && (
          <button
            onClick={() => navigate("/publishers/new")}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--amber)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer"
          >
            <Plus size={16} />
            <FormattedMessage id="publishers.add" />
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={intl.formatMessage({ id: "publishers.search" })}
            className="w-full pl-8 pr-3 py-2 bg-[var(--bg-2)] border border-[var(--border-2)] rounded-[var(--radius-sm)] text-[var(--text)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)] transition-colors"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-[var(--bg-2)] border border-[var(--border-2)] rounded-[var(--radius-sm)] text-[var(--text)] text-sm focus:outline-none focus:border-[var(--amber)] transition-colors"
        >
          <option value="all">{intl.formatMessage({ id: "publishers.filter.all_status" })}</option>
          <option value="active">{intl.formatMessage({ id: "publishers.status.active" })}</option>
          <option value="inactive">{intl.formatMessage({ id: "publishers.status.inactive" })}</option>
          <option value="invited">{intl.formatMessage({ id: "publishers.status.invited" })}</option>
          <option value="pending_approval">{intl.formatMessage({ id: "publishers.status.pending" })}</option>
        </select>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-3 py-2 bg-[var(--bg-2)] border border-[var(--border-2)] rounded-[var(--radius-sm)] text-[var(--text)] text-sm focus:outline-none focus:border-[var(--amber)] transition-colors"
        >
          <option value="all">{intl.formatMessage({ id: "publishers.filter.all_roles" })}</option>
          <option value="elder">{intl.formatMessage({ id: "publishers.role.elder" })}</option>
          <option value="ministerial_servant">{intl.formatMessage({ id: "publishers.role.ms" })}</option>
          <option value="publisher">{intl.formatMessage({ id: "publishers.role.publisher" })}</option>
        </select>
      </div>

      {/* Publisher list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
          <Users size={40} className="text-[var(--text-muted)] mb-3" strokeWidth={1.2} />
          <p className="text-sm text-[var(--text-muted)]">
            <FormattedMessage id="publishers.empty" />
          </p>
        </div>
      ) : (
        <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] divide-y divide-[var(--border)]">
          {filtered.map((p) => {
            const roleConfig = (ROLE_CONFIG[p.congregationRole] ?? ROLE_CONFIG.publisher) as { icon: typeof Shield; color: string; labelId: string };
            const RoleIcon = roleConfig.icon;
            const isOnline = !!(p.hasAccount || p.keycloakSub);
            const statusClass = STATUS_COLORS[p.status] ?? STATUS_COLORS.inactive;

            return (
              <div
                key={p.id}
                className="flex items-center gap-4 px-4 py-3 hover:bg-[var(--glass)] transition-colors cursor-pointer"
                onClick={() => navigate(`/publishers/${p.id}`)}
              >
                {/* Role icon */}
                <div className={`flex-shrink-0 ${roleConfig.color}`}>
                  <RoleIcon size={20} strokeWidth={1.8} />
                </div>

                {/* Name + flags */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--text)] truncate">
                      {p.displayName ?? `${p.firstName} ${p.lastName}`}
                    </span>
                    {/* Online indicator */}
                    {isOnline ? (
                      <Wifi size={12} className="text-emerald-400 flex-shrink-0" />
                    ) : (
                      <WifiOff size={12} className="text-zinc-600 flex-shrink-0" />
                    )}
                  </div>
                  {/* Congregation flags */}
                  {p.congregationFlags?.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {p.congregationFlags.map((flag) => (
                        <span
                          key={flag}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--glass)] text-[var(--text-muted)]"
                        >
                          {intl.formatMessage({
                            id: `publishers.flag.${flag}`,
                            defaultMessage: flag.replace(/_/g, " "),
                          })}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* App roles */}
                {p.appRoles && p.appRoles.length > 0 && (
                  <div className="hidden md:flex items-center gap-1">
                    {p.appRoles.slice(0, 2).map((r) => (
                      <span
                        key={r.roleId}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--amber)]/10 text-[var(--amber)] border border-[var(--amber)]/20"
                      >
                        {r.roleName}
                      </span>
                    ))}
                    {p.appRoles.length > 2 && (
                      <span className="text-[10px] text-[var(--text-muted)]">
                        +{p.appRoles.length - 2}
                      </span>
                    )}
                  </div>
                )}

                {/* Status badge */}
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full border ${statusClass} flex-shrink-0`}
                >
                  {intl.formatMessage({
                    id: `publishers.status.${p.status}`,
                    defaultMessage: p.status,
                  })}
                </span>

                {/* Actions */}
                <div
                  className="flex items-center gap-1 flex-shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  {canInvite && !isOnline && p.status === "active" && (
                    <button
                      onClick={() => handleInvite(p)}
                      disabled={invitingId === p.id}
                      className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--amber)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
                      title={intl.formatMessage({ id: "publishers.invite" })}
                    >
                      <Send size={14} />
                    </button>
                  )}
                  {canEdit &&
                    (p.status === "pending_approval" || p.status === "invited") && (
                      <>
                        <button
                          onClick={() => handleApprove(p.id)}
                          className="p-1.5 rounded text-emerald-400 hover:bg-emerald-500/10 transition-colors cursor-pointer"
                          title={intl.formatMessage({ id: "publishers.approve" })}
                        >
                          <Check size={14} />
                        </button>
                        <button
                          onClick={() => handleReject(p.id)}
                          className="p-1.5 rounded text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                          title={intl.formatMessage({ id: "publishers.reject" })}
                        >
                          <X size={14} />
                        </button>
                      </>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Count */}
      <p className="text-xs text-[var(--text-muted)]">
        {filtered.length} / {publishers.length}{" "}
        <FormattedMessage id="publishers.title" />
      </p>
    </div>
  );
}
