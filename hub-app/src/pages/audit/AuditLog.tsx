import { useState, useEffect } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  ClipboardList, ChevronDown, ChevronRight, User, Search,
  UserPlus, UserCheck, UserX, Pencil, Trash2, Shield, RotateCw, ArrowRight,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";

interface AuditEntry {
  id: string;
  actorId: string;
  actorName: string | null;
  objectName: string | null;
  action: string;
  objectType: string;
  objectId: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  createdAt: string;
}

interface PublisherOption {
  id: string;
  firstName: string;
  lastName: string;
}

// ─── Action metadata ─────────────────────────────────────────────

interface ActionMeta {
  label: string;
  labelDe: string;
  color: string;
  icon: React.ElementType;
  category: "create" | "update" | "delete" | "status" | "role";
}

const ACTION_META: Record<string, ActionMeta> = {
  "publisher.create": { label: "Created publisher", labelDe: "Verkündiger erstellt", color: "text-[var(--green)]", icon: UserPlus, category: "create" },
  "publisher.update": { label: "Updated publisher", labelDe: "Verkündiger aktualisiert", color: "text-[var(--amber)]", icon: Pencil, category: "update" },
  "publisher.delete": { label: "Deleted publisher", labelDe: "Verkündiger gelöscht", color: "text-[var(--red)]", icon: Trash2, category: "delete" },
  "publisher.self.update": { label: "Updated own profile", labelDe: "Eigenes Profil aktualisiert", color: "text-[var(--amber)]", icon: Pencil, category: "update" },
  "publisher.self.gdpr_delete": { label: "GDPR deletion request", labelDe: "DSGVO-Löschantrag", color: "text-[var(--red)]", icon: Trash2, category: "delete" },
  "publisher.self.deactivate": { label: "Deactivated own account", labelDe: "Eigenes Konto deaktiviert", color: "text-[var(--red)]", icon: UserX, category: "status" },
  "user.invite": { label: "Invited user", labelDe: "Benutzer eingeladen", color: "text-[var(--blue)]", icon: UserPlus, category: "create" },
  "user.invite_email": { label: "Sent invite email", labelDe: "Einladungs-E-Mail gesendet", color: "text-[var(--blue)]", icon: UserPlus, category: "create" },
  "user.resend_invite": { label: "Resent invite", labelDe: "Einladung erneut gesendet", color: "text-[var(--blue)]", icon: RotateCw, category: "create" },
  "user.approve": { label: "Approved user", labelDe: "Benutzer genehmigt", color: "text-[var(--green)]", icon: UserCheck, category: "status" },
  "user.reject": { label: "Rejected user", labelDe: "Benutzer abgelehnt", color: "text-[var(--red)]", icon: UserX, category: "status" },
  "user.deactivate": { label: "Deactivated user", labelDe: "Benutzer deaktiviert", color: "text-[var(--red)]", icon: UserX, category: "status" },
  "user.reactivate": { label: "Reactivated user", labelDe: "Benutzer reaktiviert", color: "text-[var(--green)]", icon: UserCheck, category: "status" },
  "role.assign": { label: "Assigned role", labelDe: "Rolle zugewiesen", color: "text-[var(--blue)]", icon: Shield, category: "role" },
  "role.remove": { label: "Removed role", labelDe: "Rolle entfernt", color: "text-[var(--amber)]", icon: Shield, category: "role" },
};

const CATEGORY_FILTERS = ["all", "create", "update", "delete", "status", "role"] as const;
const TIME_FILTERS = [
  { value: 0, labelEn: "All time", labelDe: "Gesamt" },
  { value: 1, labelEn: "Today", labelDe: "Heute" },
  { value: 7, labelEn: "7 days", labelDe: "7 Tage" },
  { value: 30, labelEn: "30 days", labelDe: "30 Tage" },
  { value: 90, labelEn: "90 days", labelDe: "90 Tage" },
];

// ─── Field label formatting ──────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  firstName: "First Name", lastName: "Last Name", displayName: "Display Name",
  email: "Email", phone: "Phone", gender: "Gender", dateOfBirth: "Date of Birth",
  address: "Address", congregationRole: "Congregation Role", congregationFlags: "Flags",
  status: "Status", notes: "Notes", privacyAccepted: "Privacy", role: "System Role", isOwner: "Owner",
};

function formatFieldName(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (Array.isArray(val)) return val.length === 0 ? "—" : val.join(", ");
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  return s.length > 40 ? s.slice(0, 37) + "..." : s;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function computeChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): { field: string; from: unknown; to: unknown }[] {
  if (!before || !after) return [];
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of allKeys) {
    if (["id", "createdAt", "updatedAt", "keycloakSub", "appRoles", "internalEmail"].includes(key)) continue;
    const bVal = JSON.stringify(before[key]);
    const aVal = JSON.stringify(after[key]);
    if (bVal !== aVal) changes.push({ field: key, from: before[key], to: after[key] });
  }
  return changes;
}

const inputCls = "px-3 py-1.5 bg-[var(--bg-2)] border border-[var(--border-2)] rounded-[var(--radius-sm)] text-[var(--text)] text-sm focus:outline-none focus:border-[var(--amber)] transition-colors";

// ─── Component ───────────────────────────────────────────────────

export function AuditLog() {
  const { user } = useAuth();
  const intl = useIntl();
  const isDE = intl.locale.startsWith("de");
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [publishers, setPublishers] = useState<PublisherOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<typeof CATEGORY_FILTERS[number]>("all");
  const [timeFilter, setTimeFilter] = useState(0);
  const [publisherFilter, setPublisherFilter] = useState("");
  const [searchText, setSearchText] = useState("");

  const apiUrl = getApiUrl();
  const headers = { Authorization: `Bearer ${user?.access_token}` };

  // Fetch publishers for filter dropdown
  useEffect(() => {
    fetch(`${apiUrl}/audit/publishers`, { headers })
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setPublishers(data as PublisherOption[]))
      .catch(() => {});
  }, [user?.access_token]);

  // Fetch audit entries with server-side filters
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (timeFilter > 0) params.set("days", String(timeFilter));
    if (publisherFilter) params.set("publisherId", publisherFilter);
    const qs = params.toString();

    fetch(`${apiUrl}/audit${qs ? `?${qs}` : ""}`, { headers })
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setEntries(data as AuditEntry[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.access_token, timeFilter, publisherFilter]);

  // Client-side filtering (category + search)
  const filtered = entries.filter((e) => {
    if (categoryFilter !== "all") {
      const meta = ACTION_META[e.action];
      if (meta?.category !== categoryFilter) return false;
    }
    if (searchText) {
      const q = searchText.toLowerCase();
      const meta = ACTION_META[e.action];
      const label = meta ? (isDE ? meta.labelDe : meta.label) : e.action;
      const haystack = [
        label, e.actorName, e.objectName, e.objectType, e.action,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-[var(--text)]">
        <FormattedMessage id="audit.title" />
      </h1>

      {/* ── Filters ────────────────────────────────────────────── */}
      <div className="space-y-3">
        {/* Row 1: Search + publisher + time */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder={isDE ? "Suchen..." : "Search..."}
              className={`${inputCls} w-full pl-8`}
            />
          </div>
          <select
            value={publisherFilter}
            onChange={(e) => setPublisherFilter(e.target.value)}
            className={inputCls}
          >
            <option value="">{isDE ? "Alle Verkündiger" : "All publishers"}</option>
            {publishers.map((p) => (
              <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
            ))}
          </select>
          <select
            value={timeFilter}
            onChange={(e) => setTimeFilter(Number(e.target.value))}
            className={inputCls}
          >
            {TIME_FILTERS.map((t) => (
              <option key={t.value} value={t.value}>{isDE ? t.labelDe : t.labelEn}</option>
            ))}
          </select>
        </div>

        {/* Row 2: Category chips */}
        <div className="flex items-center gap-2 flex-wrap">
          {CATEGORY_FILTERS.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors cursor-pointer ${
                categoryFilter === cat
                  ? "bg-[var(--amber)] text-black border-[var(--amber)] font-semibold"
                  : "text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--amber)] hover:text-[var(--text)]"
              }`}
            >
              {cat === "all" ? (isDE ? "Alle" : "All") : cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
          <span className="text-xs text-[var(--text-muted)] ml-2">
            {filtered.length} {filtered.length === 1 ? (isDE ? "Eintrag" : "entry") : (isDE ? "Einträge" : "entries")}
          </span>
        </div>
      </div>

      {/* ── Entries ────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
          <ClipboardList size={40} className="text-[var(--text-muted)] mb-3" strokeWidth={1.2} />
          <p className="text-sm text-[var(--text-muted)]">
            <FormattedMessage id="audit.empty" />
          </p>
        </div>
      ) : (
        <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] divide-y divide-[var(--border)]">
          {filtered.map((entry) => {
            const meta = ACTION_META[entry.action];
            const label = meta ? (isDE ? meta.labelDe : meta.label) : entry.action;
            const Icon = meta?.icon ?? Pencil;
            const colorCls = meta?.color ?? "text-[var(--amber)]";
            const changes = computeChanges(entry.beforeState, entry.afterState);
            const isExpanded = expandedId === entry.id;
            const target = entry.objectName ?? (entry.objectId ? `#${entry.objectId.slice(0, 8)}` : "");

            return (
              <div key={entry.id}>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-[var(--glass)] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className={`shrink-0 ${colorCls}`}>
                      <Icon size={14} />
                    </span>
                    <span className={`text-sm font-medium truncate ${colorCls}`}>
                      {label}
                    </span>
                    {target && (
                      <span className="text-sm text-[var(--text)] truncate">
                        {target}
                      </span>
                    )}
                    <span className="hidden sm:inline-flex items-center gap-1 text-xs text-[var(--text-muted)] ml-auto shrink-0">
                      <User size={10} />
                      {entry.actorName ?? entry.actorId.slice(0, 8)}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap shrink-0" title={new Date(entry.createdAt).toLocaleString()}>
                      {relativeTime(entry.createdAt)}
                    </span>
                  </div>
                  {isExpanded ? (
                    <ChevronDown size={14} className="text-[var(--text-muted)] ml-2 shrink-0" />
                  ) : (
                    <ChevronRight size={14} className="text-[var(--text-muted)] ml-2 shrink-0" />
                  )}
                </button>
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-[var(--text-muted)]">
                      <span>
                        <FormattedMessage id="audit.actor" />:{" "}
                        <span className="text-[var(--text)] font-medium">{entry.actorName ?? "—"}</span>
                      </span>
                      <span>
                        <FormattedMessage id="audit.target" />:{" "}
                        <span className="text-[var(--text)] font-medium">{entry.objectName ?? entry.objectType}</span>
                      </span>
                      <span>{new Date(entry.createdAt).toLocaleString()}</span>
                    </div>

                    {changes.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
                          <FormattedMessage id="audit.changes" />
                        </p>
                        <div className="border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--bg-2)] divide-y divide-[var(--border)]">
                          {changes.map((c) => (
                            <div key={c.field} className="flex items-center gap-3 px-3 py-2 text-xs">
                              <span className="font-medium text-[var(--text)] w-[120px] shrink-0">{formatFieldName(c.field)}</span>
                              <span className="text-[var(--red)] line-through truncate max-w-[150px]">{formatValue(c.from)}</span>
                              <ArrowRight size={10} className="text-[var(--text-muted)] shrink-0" />
                              <span className="text-[var(--green)] truncate max-w-[150px]">{formatValue(c.to)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {changes.length === 0 && (entry.afterState || entry.beforeState) && (
                      <div>
                        <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">Details</p>
                        <pre className="text-xs text-[var(--text)] bg-[var(--bg-2)] p-3 rounded-[var(--radius-sm)] overflow-x-auto border border-[var(--border)]">
                          {JSON.stringify(entry.afterState ?? entry.beforeState, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
