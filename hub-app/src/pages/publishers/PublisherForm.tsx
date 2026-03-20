import { useState, useEffect, useCallback } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Save } from "lucide-react";
import { useAuth } from "@/auth/useAuth";

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
  "Mikrofon",
  "Zoom Ordner",
  "Video PC",
  "Audio Anlage",
  "Sound",
  "Technik Responsible",
  "Ordnungsdienst",
  "Cleaning Responsible",
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

  const apiUrl = import.meta.env.VITE_API_URL ?? "";
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
        const res = await fetch(`${apiUrl}/roles/${role.id}/members/${id}`, {
          method: "DELETE",
          headers,
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

  // ─── Save ───────────────────────────────────────────────────────
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        firstName,
        lastName,
        congregationRole,
        congregationFlags,
        status,
      };
      if (displayName) body.displayName = displayName;
      if (email) body.email = email;
      if (phone) body.phone = phone;
      if (gender) body.gender = gender;
      if (dateOfBirth) body.dateOfBirth = dateOfBirth;
      if (address) body.address = address;
      if (notes) body.notes = notes;

      const url = isEdit ? `${apiUrl}/publishers/${id}` : `${apiUrl}/publishers`;
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, { method, headers, body: JSON.stringify(body) });

      if (res.ok) {
        const saved = (await res.json()) as Publisher;
        if (!isEdit) {
          navigate(`/publishers/${saved.id}`);
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
