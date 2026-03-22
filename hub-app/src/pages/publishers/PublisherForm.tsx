import { useState, useEffect, useCallback } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Save, Shield, UserCheck, UserX, Plus, Trash2, Copy, Mail } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { usePermissions } from "@/auth/PermissionProvider";
import { getApiUrl } from "@/lib/config";

// ─── Types ──────────────────────────────────────────────────────────

interface Publisher {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  address: string | null;
  congregationRole: string;
  congregationFlags: string[];
  status: string;
  notes: string | null;
  privacyAccepted: boolean;
  createdAt: string;
  approvedAt: string | null;
  appRoles: AppRoleMember[];
}

interface AppRoleMember {
  id: string;
  roleId: string;
  role: AppRole;
}

interface AppRole {
  id: string;
  name: string;
  scope: string;
  description: string | null;
}

// ─── Constants ──────────────────────────────────────────────────────

const COMMON_FLAGS = [
  "regular_pioneer",
  "auxiliary_pioneer",
  "unbaptized_publisher",
  "student",
  "anointed",
  "special_needs",
];

const ELDER_FLAGS = [
  "coordinator",
  "secretary",
  "service_overseer",
  "life_and_ministry_overseer",
  "watchtower_conductor",
  "circuit_overseer",
];

const MS_FLAGS = [
  "accounts_servant",
  "literature_servant",
  "territory_servant",
];

/** Duty roles shown in Duties section (toggle switches) */
const DUTY_ROLE_NAMES = [
  // Technical
  "Mikrofon",
  "Zoom Ordner",
  "Video PC",
  "Audio Anlage",
  "Sound",
  "Technik Responsible",
  // Service
  "Ordnungsdienst",
  "Cleaning Responsible",
  // Cleaning & Garden
  "Grundreinigung",
  "Sichtreinigung",
  "Rasen",
  "Winterdienst",
  // Planning
  "Vortragsplaner",
];

// ─── Helpers ────────────────────────────────────────────────────────

const inputCls =
  "w-full px-3 py-2 bg-[var(--bg-2)] border border-[var(--border-2)] rounded-[var(--radius-sm)] text-[var(--text)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)] transition-colors";

const selectCls = inputCls;

const sectionCls =
  "space-y-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-6";

function SectionHeader({ id }: { id: string }) {
  return (
    <h2 className="text-sm font-semibold text-[var(--amber)] uppercase tracking-wide">
      <FormattedMessage id={id} />
    </h2>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  scope,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  scope?: string;
}) {
  return (
    <label className="flex items-center justify-between py-2 cursor-pointer group">
      <span className="flex items-center gap-2 text-sm text-[var(--text)]">
        {label}
        {scope && scope !== "all" && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--glass)] text-[var(--text-muted)]">
            {scope}
          </span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
          checked ? "bg-[var(--amber)]" : "bg-[var(--border-2)]"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4.5" : "translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}

// ─── Component ──────────────────────────────────────────────────────

export function PublisherForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const intl = useIntl();
  const { user } = useAuth();
  const isEdit = Boolean(id);

  const apiUrl = getApiUrl();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${user?.access_token}`,
    "Content-Type": "application/json",
  };

  // ─── Form state ─────────────────────────────────────────────────
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [address, setAddress] = useState("");
  const [congregationRole, setCongregationRole] = useState("publisher");
  const [congregationFlags, setCongregationFlags] = useState<string[]>([]);
  const [status, setStatus] = useState("active");
  const [notes, setNotes] = useState("");

  // ─── Status / lifecycle state ───────────────────────────────────
  const [publisherStatus, setPublisherStatus] = useState("active");
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [_createdAt, setCreatedAt] = useState<string | null>(null);
  const [_approvedAt, setApprovedAt] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { can } = usePermissions();
  const canManageUsers = can("app:roles.edit");

  // ─── Role state ─────────────────────────────────────────────────
  const [assignedRoleIds, setAssignedRoleIds] = useState<Set<string>>(new Set());
  const [allRoles, setAllRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  // ─── Load data ──────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const requests: Promise<Response>[] = [
          fetch(`${apiUrl}/roles`, { headers }),
        ];
        if (isEdit) requests.push(fetch(`${apiUrl}/publishers/${id}`, { headers }));

        const responses = await Promise.all(requests);
        const rolesRes = responses[0]!;
        const pubRes = responses[1];

        if (rolesRes.ok) setAllRoles(await rolesRes.json() as AppRole[]);

        if (pubRes && pubRes.ok) {
          const p = (await pubRes.json()) as Publisher;
          setFirstName(p.firstName);
          setLastName(p.lastName);
          setDisplayName(p.displayName ?? "");
          setEmail(p.email ?? "");
          setPhone(p.phone ?? "");
          setGender(p.gender ?? "");
          setDateOfBirth(p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : "");
          setAddress(p.address ?? "");
          setCongregationRole(p.congregationRole);
          setCongregationFlags(p.congregationFlags);
          setStatus(p.status);
          setPublisherStatus(p.status);
          setPrivacyAccepted(p.privacyAccepted ?? false);
          setCreatedAt(p.createdAt ?? null);
          setApprovedAt(p.approvedAt ?? null);
          setNotes(p.notes ?? "");
          setAssignedRoleIds(new Set(p.appRoles.map((ar) => ar.roleId)));
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  // ─── Role helpers ───────────────────────────────────────────────
  const roleByName = useCallback(
    (name: string) => allRoles.find((r) => r.name === name),
    [allRoles],
  );

  const isRoleAssigned = useCallback(
    (name: string) => {
      const role = roleByName(name);
      return role ? assignedRoleIds.has(role.id) : false;
    },
    [roleByName, assignedRoleIds],
  );

  const toggleRole = useCallback(
    async (name: string, assign: boolean) => {
      const role = roleByName(name);
      if (!role || !id) return;

      if (assign) {
        const res = await fetch(`${apiUrl}/roles/${role.id}/members`, {
          method: "POST",
          headers,
          body: JSON.stringify({ publisherId: id }),
        });
        if (res.ok) setAssignedRoleIds((prev) => new Set([...prev, role.id]));
      } else {
        const { "Content-Type": _, ...deleteHeaders } = headers;
        const res = await fetch(`${apiUrl}/roles/${role.id}/members/${id}`, {
          method: "DELETE",
          headers: deleteHeaders,
        });
        if (res.ok)
          setAssignedRoleIds((prev) => {
            const next = new Set(prev);
            next.delete(role.id);
            return next;
          });
      }
    },
    [roleByName, id, apiUrl, headers],
  );

  // ─── Flag toggle ───────────────────────────────────────────────
  const toggleFlag = (flag: string) => {
    setCongregationFlags((prev) =>
      prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag],
    );
  };

  // ─── Status actions ─────────────────────────────────────────────
  const doStatusAction = async (action: string) => {
    const res = await fetch(`${apiUrl}/users/${id}/${action}`, { method: "POST", headers });
    if (res.ok) {
      const updated = await res.json() as Publisher;
      setPublisherStatus(updated.status);
    }
  };

  // ─── Role assignment (full list) ──────────────────────────────
  const assignRoleById = async (roleId: string) => {
    if (!id) return;
    const res = await fetch(`${apiUrl}/roles/${roleId}/members`, {
      method: "POST", headers,
      body: JSON.stringify({ publisherId: id }),
    });
    if (res.ok) setAssignedRoleIds((prev) => new Set([...prev, roleId]));
  };

  const removeRoleById = async (roleId: string) => {
    if (!id) return;
    const res = await fetch(`${apiUrl}/roles/${roleId}/members/${id}`, { method: "DELETE", headers });
    if (res.ok) setAssignedRoleIds((prev) => { const n = new Set(prev); n.delete(roleId); return n; });
  };

  // ─── Send invite email ────────────────────────────────────────
  const sendInviteEmail = async () => {
    if (!inviteCode || !email || !id) return;
    await fetch(`${apiUrl}/users/invite-email`, {
      method: "POST", headers,
      body: JSON.stringify({ publisherId: id, inviteCode, email, firstName }),
    });
    setEmailSent(true);
  };

  // ─── Save ───────────────────────────────────────────────────────
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (isEdit) {
        // Update existing publisher — send all fields
        const body: Record<string, unknown> = {
          firstName, lastName, congregationRole, congregationFlags, status,
        };
        if (displayName) body.displayName = displayName;
        if (email) body.email = email;
        if (phone) body.phone = phone;
        if (gender) body.gender = gender;
        if (dateOfBirth) body.dateOfBirth = dateOfBirth;
        if (address) body.address = address;
        if (notes) body.notes = notes;
        await fetch(`${apiUrl}/publishers/${id}`, { method: "PUT", headers, body: JSON.stringify(body) });
      } else {
        // Create via invite flow — only send fields accepted by POST /users/invite
        const inviteBody: Record<string, unknown> = { firstName, lastName };
        if (email) inviteBody.email = email;
        if (gender) inviteBody.gender = gender;
        if (congregationRole !== "publisher") inviteBody.congregationRole = congregationRole;
        if (congregationFlags.length > 0) inviteBody.congregationFlags = congregationFlags;

        const res = await fetch(`${apiUrl}/users/invite`, {
          method: "POST", headers, body: JSON.stringify(inviteBody),
        });
        if (res.ok) {
          const data = await res.json() as { publisher: Publisher; inviteCode: string };
          setInviteCode(data.inviteCode);
          navigate(`/publishers/${data.publisher.id}`);
          return;
        } else {
          const err = await res.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
          setFormError(err.error || `Error: ${res.status}`);
        }
      }
    } finally {
      setSaving(false);
    }
  };

  // ─── Loading ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ─── Available flags by role ────────────────────────────────────
  const availableFlags = [
    ...COMMON_FLAGS,
    ...(congregationRole === "elder" ? ELDER_FLAGS : []),
    ...(congregationRole === "ministerial_servant" ? MS_FLAGS : []),
  ];

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/publishers")}
          className="p-2 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-semibold text-[var(--text)]">
          {isEdit ? (
            <FormattedMessage id="common.edit" />
          ) : (
            <FormattedMessage id="publishers.add" />
          )}
        </h1>
      </div>

      {/* ── Status Management Bar (edit mode only) ────────────────── */}
      {isEdit && canManageUsers && (
        <div className="flex items-center justify-between p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--text-muted)]"><FormattedMessage id="publishers.status" />:</span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
              publisherStatus === "active" ? "text-[var(--green)] bg-[#22c55e14]" :
              publisherStatus === "invited" || publisherStatus === "pending_approval" ? "text-[var(--amber)] bg-[#d9770614]" :
              publisherStatus === "rejected" ? "text-[var(--red)] bg-[#ef444414]" :
              "text-[var(--text-muted)] bg-[var(--glass)]"
            }`}>
              {publisherStatus === "active" && <UserCheck size={10} />}
              {publisherStatus === "inactive" && <UserX size={10} />}
              {publisherStatus.replace("_", " ")}
            </span>
          </div>
          <div className="flex gap-2">
            {(publisherStatus === "pending_approval" || publisherStatus === "invited") && (
              <>
                <button type="button" onClick={() => doStatusAction("approve")} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[var(--green)] text-white rounded-[var(--radius-sm)] hover:opacity-90 cursor-pointer">
                  <UserCheck size={14} />
                  <FormattedMessage id="publishers.approve" />
                </button>
                <button type="button" onClick={() => doStatusAction("reject")} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[var(--red)] text-white rounded-[var(--radius-sm)] hover:opacity-90 cursor-pointer">
                  <UserX size={14} />
                  <FormattedMessage id="publishers.reject" />
                </button>
              </>
            )}
            {publisherStatus === "active" && (
              <button type="button" onClick={() => doStatusAction("deactivate")} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--red)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer">
                <UserX size={14} />
                <FormattedMessage id="publishers.deactivate" />
              </button>
            )}
            {publisherStatus === "inactive" && (
              <button type="button" onClick={() => doStatusAction("reactivate")} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--green)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer">
                <UserCheck size={14} />
                <FormattedMessage id="publishers.reactivate" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Info Card (edit mode only) ───────────────────────────── */}
      {isEdit && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
          <div>
            <p className="text-xs text-[var(--text-muted)]"><FormattedMessage id="publishers.email" /></p>
            <p className="text-sm text-[var(--text)]">{email || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]"><FormattedMessage id="publishers.status" /></p>
            <p className="text-sm text-[var(--text)]">{publisherStatus.replace("_", " ")}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]"><FormattedMessage id="publishers.gender" /></p>
            <p className="text-sm text-[var(--text)]">{gender || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">Privacy</p>
            <p className="text-sm text-[var(--text)]">{privacyAccepted ? "✓" : "—"}</p>
          </div>
        </div>
      )}

      {/* ── Error Banner ────────────────────────────────────────── */}
      {formError && (
        <div className="flex items-center justify-between p-4 bg-[var(--red)]/10 border border-[var(--red)]/30 rounded-[var(--radius)] text-[var(--red)] text-sm">
          <span>{formError}</span>
          <button onClick={() => setFormError(null)} className="ml-4 text-[var(--red)] hover:opacity-70 cursor-pointer font-bold">✕</button>
        </div>
      )}

      {/* ── Invite Code Modal ────────────────────────────────────── */}
      {inviteCode && (
        <div className="p-4 border border-[var(--amber)] border-opacity-30 rounded-[var(--radius)] bg-[#d9770608] space-y-3">
          <h3 className="text-sm font-medium text-[var(--amber)]">
            <FormattedMessage id="publishers.invite.success" values={{ code: inviteCode }} />
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            <FormattedMessage id="publishers.invite.hint" />
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(inviteCode)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer"
            >
              <Copy size={14} />
              Copy
            </button>
            {email && !emailSent && (
              <button
                type="button"
                onClick={sendInviteEmail}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--amber)] border border-[var(--amber)] border-opacity-30 rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer"
              >
                <Mail size={14} />
                <FormattedMessage id="publishers.invite.sendEmail" />
              </button>
            )}
            {emailSent && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--green)]">
                <UserCheck size={14} />
                <FormattedMessage id="publishers.invite.emailSent" />
              </span>
            )}
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* ── Section 1: Personal Information ─────────────────────── */}
        <div className={sectionCls}>
          <SectionHeader id="publishers.personalInfo" />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[var(--text-muted)]">
                <FormattedMessage id="publishers.firstName" /> *
              </label>
              <input
                type="text"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[var(--text-muted)]">
                <FormattedMessage id="publishers.lastName" /> *
              </label>
              <input
                type="text"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-[var(--text-muted)]">
              <FormattedMessage id="publishers.displayName" />
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={intl.formatMessage({ id: "publishers.displayName.hint" })}
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[var(--text-muted)]">
                <FormattedMessage id="publishers.gender" />
              </label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className={selectCls}
              >
                <option value="">—</option>
                <option value="male">{intl.formatMessage({ id: "publishers.gender.male" })}</option>
                <option value="female">{intl.formatMessage({ id: "publishers.gender.female" })}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[var(--text-muted)]">
                <FormattedMessage id="publishers.dateOfBirth" />
              </label>
              <input
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
        </div>

        {/* ── Section 2: Contact ──────────────────────────────────── */}
        <div className={sectionCls}>
          <SectionHeader id="publishers.contact" />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[var(--text-muted)]">
                <FormattedMessage id="publishers.email" />
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[var(--text-muted)]">
                <FormattedMessage id="publishers.phone" />
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-[var(--text-muted)]">
              <FormattedMessage id="publishers.address" />
            </label>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={2}
              className={inputCls + " resize-none"}
            />
          </div>
        </div>

        {/* ── Section 3: Congregation ─────────────────────────────── */}
        <div className={sectionCls}>
          <SectionHeader id="publishers.congregation" />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[var(--text-muted)]">
                <FormattedMessage id="publishers.congregationRole" />
              </label>
              <select
                value={congregationRole}
                onChange={(e) => {
                  setCongregationRole(e.target.value);
                  // Clear role-specific flags when role changes
                  setCongregationFlags((prev) =>
                    prev.filter((f) => COMMON_FLAGS.includes(f)),
                  );
                }}
                className={selectCls}
              >
                <option value="publisher">{intl.formatMessage({ id: "publishers.role.publisher" })}</option>
                <option value="ministerial_servant">{intl.formatMessage({ id: "publishers.role.ministerialServant" })}</option>
                <option value="elder">{intl.formatMessage({ id: "publishers.role.elder" })}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[var(--text-muted)]">
                <FormattedMessage id="publishers.status" />
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className={selectCls}
              >
                <option value="active">{intl.formatMessage({ id: "publishers.status.active" })}</option>
                <option value="inactive">{intl.formatMessage({ id: "publishers.status.inactive" })}</option>
              </select>
            </div>
          </div>

          {/* Congregation Flags */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-[var(--text-muted)]">
              <FormattedMessage id="publishers.congregationFlags" />
            </label>
            <div className="flex flex-wrap gap-2">
              {availableFlags.map((flag) => (
                <button
                  key={flag}
                  type="button"
                  onClick={() => toggleFlag(flag)}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
                    congregationFlags.includes(flag)
                      ? "bg-[var(--amber)] text-black border-[var(--amber)] font-semibold"
                      : "bg-transparent text-[var(--text-muted)] border-[var(--border-2)] hover:border-[var(--amber)] hover:text-[var(--text)]"
                  }`}
                >
                  {intl.formatMessage({ id: `publishers.flag.${flag}` })}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Section 4: Duties ───────────────────────────────────── */}
        {isEdit && (
          <div className={sectionCls}>
            <SectionHeader id="publishers.duties" />
            <div className="divide-y divide-[var(--border)]">
              {DUTY_ROLE_NAMES.map((name) => {
                const role = roleByName(name);
                if (!role) return null;
                return (
                  <Toggle
                    key={name}
                    label={name}
                    scope={role.scope}
                    checked={isRoleAssigned(name)}
                    onChange={(v) => toggleRole(name, v)}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* ── Section 5: Program (Midweek / Weekend) ──────────────── */}
        {isEdit && (
          <div className={sectionCls}>
            <SectionHeader id="publishers.program" />

            {/* Midweek */}
            <div className="space-y-1">
              <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
                <FormattedMessage id="publishers.program.midweek" />
              </h3>
              <div className="divide-y divide-[var(--border)]">
                {(["Program", "LM Overseer"] as const).map((name) => {
                  const role = roleByName(name);
                  if (!role) return null;
                  return (
                    <Toggle
                      key={name}
                      label={name}
                      scope={role.scope}
                      checked={isRoleAssigned(name)}
                      onChange={(v) => toggleRole(name, v)}
                    />
                  );
                })}
              </div>
            </div>

            {/* Weekend */}
            <div className="space-y-1 pt-4">
              <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
                <FormattedMessage id="publishers.program.weekend" />
              </h3>
              <div className="divide-y divide-[var(--border)]">
                {(["Program", "WT Conductor", "Vortragsplaner"] as const).map((name) => {
                  const role = roleByName(name);
                  if (!role) return null;
                  // Don't duplicate Program if already shown
                  if (name === "Program" && isRoleAssigned("Program")) {
                    return (
                      <div key={`${name}-weekend`} className="flex items-center justify-between py-2">
                        <span className="flex items-center gap-2 text-sm text-[var(--text)]">
                          {name}
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--glass)] text-[var(--text-muted)]">
                            <FormattedMessage id="publishers.program.assignedAbove" />
                          </span>
                        </span>
                        <span className="h-5 w-9 inline-flex items-center justify-center">
                          <span className="text-[10px] text-[var(--amber)]">✓</span>
                        </span>
                      </div>
                    );
                  }
                  if (name === "Program") {
                    return (
                      <Toggle
                        key={`${name}-weekend`}
                        label={name}
                        scope={role.scope}
                        checked={isRoleAssigned(name)}
                        onChange={(v) => toggleRole(name, v)}
                      />
                    );
                  }
                  return (
                    <Toggle
                      key={name}
                      label={name}
                      scope={role.scope}
                      checked={isRoleAssigned(name)}
                      onChange={(v) => toggleRole(name, v)}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Section 6: Notes ────────────────────────────────────── */}
        <div className={sectionCls}>
          <SectionHeader id="publishers.notes" />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className={inputCls + " resize-none"}
            placeholder={intl.formatMessage({ id: "publishers.notes.placeholder" })}
          />
        </div>

        {/* ── Section 7: All Roles (full assignment list) ──────────── */}
        {isEdit && canManageUsers && (
          <div className={sectionCls}>
            <SectionHeader id="publishers.allRoles" />
            <div className="border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--bg)] divide-y divide-[var(--border)]">
              {allRoles.filter((r) => assignedRoleIds.has(r.id)).length === 0 ? (
                <p className="px-4 py-3 text-sm text-[var(--text-muted)]">
                  <FormattedMessage id="publishers.allRoles.empty" />
                </p>
              ) : (
                allRoles
                  .filter((r) => assignedRoleIds.has(r.id))
                  .map((r) => (
                    <div key={r.id} className="flex items-center justify-between px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Shield size={14} className="text-[var(--amber)]" />
                        <span className="text-sm text-[var(--text)]">{r.name}</span>
                        {r.scope !== "all" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--glass)] text-[var(--text-muted)]">
                            {r.scope}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeRoleById(r.id)}
                        className="p-1 text-[var(--text-muted)] hover:text-[var(--red)] cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
              )}
            </div>
            {/* Add role dropdown */}
            {allRoles.filter((r) => !assignedRoleIds.has(r.id)).length > 0 && (
              <div className="flex items-center gap-2 mt-2">
                <select
                  className={`flex-1 ${selectCls}`}
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) assignRoleById(e.target.value);
                    e.target.value = "";
                  }}
                >
                  <option value="" disabled>{intl.formatMessage({ id: "publishers.allRoles.add" })}</option>
                  {allRoles.filter((r) => !assignedRoleIds.has(r.id)).map((r) => (
                    <option key={r.id} value={r.id}>{r.name} ({r.scope})</option>
                  ))}
                </select>
                <Plus size={16} className="text-[var(--text-muted)]" />
              </div>
            )}
          </div>
        )}

        {/* ── Actions ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--amber)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer disabled:opacity-50"
          >
            <Save size={16} />
            <FormattedMessage id="common.save" />
          </button>
          <button
            type="button"
            onClick={() => navigate("/publishers")}
            className="px-4 py-2 border border-[var(--border-2)] text-[var(--text-muted)] text-sm font-medium rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            <FormattedMessage id="common.cancel" />
          </button>
        </div>
      </form>
    </div>
  );
}
