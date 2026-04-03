import { useState, useEffect, useCallback } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Save, Shield, UserCheck, UserX, Plus, Trash2, Copy, Mail, RotateCw, AlertTriangle, Lock, Smartphone, Ban, KeyRound, X } from "lucide-react";
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
  role: string;
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

interface PublisherDevice {
  id: string;
  deviceUuid: string;
  displayName: string;
  platform: string;
  status: "active" | "revoked";
  revokedAt: string | null;
  revokeReason: string | null;
  registeredAt: string;
  lastSyncAt: string | null;
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

/** Duty roles shown in Duties tab (toggle switches) */
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
  "Predigtdienst Treffpunkt Leiter",
  // Cleaning & Garden
  "Grundreinigung",
  "Sichtreinigung",
  "Rasen",
  "Winterdienst",
];

/** Midweek meeting roles — each individually toggleable */
const MIDWEEK_ROLES = [
  { name: "LM Overseer", labelKey: "program.role.lmOverseer" },
  { name: "Vorsitzender Woche", labelKey: "program.role.chairman" },
  { name: "Eingangsgebet", labelKey: "program.role.openingPrayer" },
  { name: "Schlussgebet", labelKey: "program.role.closingPrayer" },
  { name: "Schätze", labelKey: "program.role.gems" },
  { name: "Bibellesung", labelKey: "program.role.bibleReading" },
  { name: "Erstes Gespräch", labelKey: "program.role.initialCall" },
  { name: "Assistent Midweek", labelKey: "program.role.initialCallAssistant" },
  { name: "Rückbesuch", labelKey: "program.role.returnVisit" },
  { name: "Bibelstudium", labelKey: "program.role.bibleStudy" },
  { name: "Vortrag Woche", labelKey: "program.role.talk" },
  { name: "VBS Leiter", labelKey: "program.role.cbsConductor" },
  { name: "VBS Leser", labelKey: "program.role.cbsReader" },
];

/** Weekend meeting roles — each individually toggleable */
const WEEKEND_ROLES = [
  { name: "WT Conductor", labelKey: "program.role.wtConductor" },
  { name: "Vorsitzender Wochenende", labelKey: "program.role.chairmanWeekend" },
  { name: "Öffentlicher Vortrag", labelKey: "program.role.publicTalk" },
  { name: "Gastredner", labelKey: "program.role.gastredner" },
  { name: "WT Leser", labelKey: "program.role.wtReader" },
  { name: "Vortragsplaner", labelKey: "program.role.vortragsplaner" },
  { name: "Assistent Weekend", labelKey: "program.role.assistentWeekend" },
];

const TABS = ["personal", "congregation", "duties", "program", "roles", "danger"] as const;
type Tab = typeof TABS[number];

/** Program roles that female publishers CAN be assigned to */
const FEMALE_ALLOWED_ROLES = new Set([
  "Erstes Gespräch",
  "Assistent Midweek",
  "Rückbesuch",
  "Bibelstudium",
]);

/** Duty roles that female publishers CAN be assigned to */
const FEMALE_ALLOWED_DUTIES = new Set([
  "Grundreinigung",
  "Sichtreinigung",
  "Rasen",
  "Winterdienst",
]);

/** Roles restricted to elders only */
const ELDER_ONLY_ROLES = new Set([
  "LM Overseer",
  "VBS Leiter",
  "WT Conductor",
]);

/** Filter program roles based on publisher gender and congregation role */
function filterProgramRoles(
  roles: { name: string; labelKey: string }[],
  gender: string | null,
  congregationRole: string,
): { name: string; labelKey: string }[] {
  return roles.filter((r) => {
    if (gender === "female") return FEMALE_ALLOWED_ROLES.has(r.name);
    if (congregationRole !== "elder" && ELDER_ONLY_ROLES.has(r.name)) return false;
    return true;
  });
}

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

  // ─── Tab state ──────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>("personal");
  const [programSubTab, setProgramSubTab] = useState<"midweek" | "weekend">("midweek");

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
  const [systemRole, setSystemRole] = useState("publisher");

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
  const [autoMappedRoles, setAutoMappedRoles] = useState<Array<{ roleName: string; fromFlag: string }>>([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  // ─── Resend invite state ────────────────────────────────────────
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  // ─── Reset password state ────────────────────────────────────────
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetPasswordResult, setResetPasswordResult] = useState<{
    method: string;
    temporaryPassword?: string;
    message?: string;
  } | null>(null);
  const [resetPasswordError, setResetPasswordError] = useState<string | null>(null);
  const canResetPassword = can("app:publishers.reset_password");

  // ─── Delete state ──────────────────────────────────────────────
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ─── Device state ─────────────────────────────────────────────
  const [devices, setDevices] = useState<PublisherDevice[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);

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
          setSystemRole(p.role ?? "publisher");
          setAssignedRoleIds(new Set(p.appRoles.map((ar) => ar.roleId)));

          // Fetch auto-mapped roles for the roles tab split view
          fetch(`${apiUrl}/publishers/${id}/roles`, { headers })
            .then((r) => r.json())
            .then((data: any) => setAutoMappedRoles(data.autoMapped || []))
            .catch(console.error);
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
    const res = await fetch(`${apiUrl}/users/${id}/${action}`, {
      method: "POST", headers, body: JSON.stringify({}),
    });
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

  // ─── Resend invite ────────────────────────────────────────────
  const [resendError, setResendError] = useState<string | null>(null);
  const resendInvite = async () => {
    if (!id || !email) return;
    setResending(true);
    setResendSuccess(false);
    setResendError(null);
    try {
      const res = await fetch(`${apiUrl}/users/${id}/resend-invite`, {
        method: "POST", headers, body: JSON.stringify({}),
      });
      if (res.ok) {
        setResendSuccess(true);
      } else {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setResendError(data.error || `Fehler: ${res.status}`);
      }
    } catch (err) {
      setResendError("Netzwerkfehler — bitte erneut versuchen");
    } finally {
      setResending(false);
    }
  };

  // ─── Reset password ────────────────────────────────────────────
  const resetPublisherPassword = async () => {
    if (!id) return;
    setResettingPassword(true);
    setResetPasswordError(null);
    setResetPasswordResult(null);
    try {
      const res = await fetch(`${apiUrl}/publishers/${id}/reset-password`, {
        method: "POST", headers, body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = await res.json() as { method: string; temporaryPassword?: string; message?: string };
        setResetPasswordResult(data);
      } else {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setResetPasswordError(data.error || `Error: ${res.status}`);
      }
    } catch {
      setResetPasswordError("Network error");
    } finally {
      setResettingPassword(false);
    }
  };

  // ─── Delete publisher ─────────────────────────────────────────
  const deletePublisher = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      const { "Content-Type": _, ...deleteHeaders } = headers;
      const res = await fetch(`${apiUrl}/publishers/${id}`, { method: "DELETE", headers: deleteHeaders });
      if (res.ok || res.status === 204) {
        navigate("/publishers");
      } else {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setFormError(data.error || `Delete failed: ${res.status}`);
      }
    } catch {
      setFormError("Network error");
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  // ─── Load devices (lazy, on danger tab) ────────────────────────
  const loadDevices = useCallback(async () => {
    if (!id || devicesLoaded) return;
    try {
      const res = await fetch(`${apiUrl}/admin/devices/publisher/${id}`, { headers });
      if (res.ok) setDevices(await res.json() as PublisherDevice[]);
    } finally {
      setDevicesLoaded(true);
    }
  }, [id, devicesLoaded, apiUrl]);

  useEffect(() => {
    if (activeTab === "danger" && !devicesLoaded) loadDevices();
  }, [activeTab, devicesLoaded, loadDevices]);

  const revokeDevice = async (deviceId: string) => {
    setRevokingDeviceId(deviceId);
    try {
      const res = await fetch(`${apiUrl}/admin/devices/${deviceId}`, {
        method: "DELETE", headers, body: JSON.stringify({ reason: "Admin wipe from publisher detail" }),
      });
      if (res.ok) {
        setDevices((prev) => prev.map((d) => d.id === deviceId ? { ...d, status: "revoked" as const, revokedAt: new Date().toISOString() } : d));
      }
    } finally {
      setRevokingDeviceId(null);
    }
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
          firstName, lastName, congregationRole, congregationFlags, status, role: systemRole,
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

      {/* ── Compact Status + Info Bar (edit mode only) ──────────────── */}
      {isEdit && (
        <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-3 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
          <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${
              publisherStatus === "active" ? "text-[var(--green)] bg-[#22c55e14]" :
              publisherStatus === "invited" || publisherStatus === "pending_approval" ? "text-[var(--amber)] bg-[#d9770614]" :
              publisherStatus === "rejected" ? "text-[var(--red)] bg-[#ef444414]" :
              "text-[var(--text-muted)] bg-[var(--glass)]"
            }`}>
              {publisherStatus === "active" && <UserCheck size={10} />}
              {(publisherStatus === "invited" || publisherStatus === "pending_approval") && <Mail size={10} />}
              {(publisherStatus === "rejected" || publisherStatus === "inactive") && <UserX size={10} />}
              {publisherStatus.replace("_", " ")}
            </span>
            {gender && <span>{gender}</span>}
            {email && <span className="hidden sm:inline truncate max-w-[200px]">{email}</span>}
            {privacyAccepted && <span>Privacy ✓</span>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {canManageUsers && (publisherStatus === "pending_approval" || publisherStatus === "invited") && (
              <>
                <button type="button" onClick={() => doStatusAction("approve")} className="flex items-center gap-1 px-2.5 py-1 text-xs bg-[var(--green)] text-white rounded-[var(--radius-sm)] hover:opacity-90 cursor-pointer">
                  <UserCheck size={12} />
                  <FormattedMessage id="publishers.approve" />
                </button>
                <button type="button" onClick={() => doStatusAction("reject")} className="flex items-center gap-1 px-2.5 py-1 text-xs bg-[var(--red)] text-white rounded-[var(--radius-sm)] hover:opacity-90 cursor-pointer">
                  <UserX size={12} />
                  <FormattedMessage id="publishers.reject" />
                </button>
                {email && (
                  <button
                    type="button"
                    onClick={resendInvite}
                    disabled={resending}
                    className={`flex items-center gap-1 px-2.5 py-1 text-xs border rounded-[var(--radius-sm)] cursor-pointer disabled:opacity-50 transition-colors ${
                      resendSuccess
                        ? "text-[var(--green)] border-[var(--green)]/30 bg-[var(--green)]/5"
                        : "text-[var(--amber)] border-[var(--amber)]/30 hover:bg-[var(--glass)]"
                    }`}
                  >
                    <RotateCw size={12} className={resending ? "animate-spin" : ""} />
                    {resendSuccess
                      ? <FormattedMessage id="publishers.resendInvite.success" />
                      : <FormattedMessage id="publishers.resendInvite" />
                    }
                  </button>
                )}
              </>
            )}
            {canResetPassword && publisherStatus === "active" && (
              <button
                type="button"
                onClick={resetPublisherPassword}
                disabled={resettingPassword}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--amber)] border border-[var(--amber)]/30 rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer disabled:opacity-50 transition-colors"
              >
                <KeyRound size={14} className={resettingPassword ? "animate-spin" : ""} />
                <FormattedMessage id="publishers.resetPassword" />
              </button>
            )}
            {canManageUsers && publisherStatus === "active" && (
              <button type="button" onClick={() => doStatusAction("deactivate")} className="flex items-center gap-1 px-2.5 py-1 text-xs text-[var(--red)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer">
                <UserX size={12} />
                <FormattedMessage id="publishers.deactivate" />
              </button>
            )}
            {canManageUsers && publisherStatus === "inactive" && (
              <button type="button" onClick={() => doStatusAction("reactivate")} className="flex items-center gap-1 px-2.5 py-1 text-xs text-[var(--green)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer">
                <UserCheck size={12} />
                <FormattedMessage id="publishers.reactivate" />
              </button>
            )}
            </div>
          </div>
          {resendError && (
            <div className="w-full text-xs text-[var(--red)]">{resendError}</div>
          )}
          {resetPasswordError && (
            <div className="text-xs text-[var(--red)] px-1">{resetPasswordError}</div>
          )}
          {resetPasswordResult?.method === "email" && (
            <div className="text-xs text-[var(--green)] px-1">
              <FormattedMessage id="publishers.resetPassword.emailSent" />
            </div>
          )}
        </div>
      )}

      {/* ── Temporary Password Dialog ─────────────────────────────── */}
      {resetPasswordResult?.method === "temporary" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius)] p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--amber)]">
                <FormattedMessage id="publishers.resetPassword.tempTitle" />
              </h3>
              <button
                type="button"
                onClick={() => setResetPasswordResult(null)}
                className="p-1 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-3 bg-[var(--bg-2)] border border-[var(--border-2)] rounded-[var(--radius-sm)]">
              <code className="text-sm font-mono text-[var(--text)] select-all">
                {resetPasswordResult.temporaryPassword}
              </code>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              <FormattedMessage id="publishers.resetPassword.tempHint" />
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (resetPasswordResult.temporaryPassword) {
                    navigator.clipboard.writeText(resetPasswordResult.temporaryPassword);
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer"
              >
                <Copy size={14} />
                <FormattedMessage id="common.copy" />
              </button>
              <button
                type="button"
                onClick={() => setResetPasswordResult(null)}
                className="px-3 py-1.5 text-sm text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer"
              >
                <FormattedMessage id="common.close" />
              </button>
            </div>
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

      {/* ── Tab Bar (edit mode: 4 tabs, create mode: form inline) ── */}
      {isEdit && (
        <div className="flex overflow-x-auto border-b border-[var(--border)] -mx-1 scrollbar-hide">
          {TABS.map((tab) => {
            if ((tab === "duties" || tab === "roles" || tab === "danger") && !isEdit) return null;
            if ((tab === "roles" || tab === "danger") && !canManageUsers) return null;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`shrink-0 px-3 py-2 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  activeTab === tab
                    ? "text-[var(--amber)] border-b-2 border-[var(--amber)] -mb-px"
                    : "text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                <FormattedMessage id={`publishers.tab.${tab}`} />
              </button>
            );
          })}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* ── Tab: Personal (or create mode: all inline) ────────────── */}
        {(!isEdit || activeTab === "personal") && (
          <>
            {/* Personal Information */}
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

            {/* Contact */}
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

            {/* Notes */}
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
          </>
        )}

        {/* ── Tab: Congregation ──────────────────────────────────── */}
        {(!isEdit || activeTab === "congregation") && (
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
              {isEdit && (
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
              )}
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
        )}

        {/* ── Tab: Duties (technical + cleaning only) ──────────── */}
        {isEdit && activeTab === "duties" && (
          <div className={sectionCls}>
            <SectionHeader id="publishers.duties" />
            <div className="divide-y divide-[var(--border)]">
              {DUTY_ROLE_NAMES
                .filter((name) => gender !== "female" || FEMALE_ALLOWED_DUTIES.has(name))
                .map((name) => {
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

        {/* ── Tab: Program (dedicated meeting roles) ─────────── */}
        {isEdit && activeTab === "program" && (
          <>
            {/* Sub-tab bar */}
            <div className="flex gap-1 mb-4">
              {(["midweek", "weekend"] as const).map((sub) => (
                <button
                  key={sub}
                  type="button"
                  onClick={() => setProgramSubTab(sub)}
                  className={`px-4 py-2 text-xs font-semibold rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
                    programSubTab === sub
                      ? "bg-[var(--amber)] text-black"
                      : "bg-[var(--glass-1)] text-[var(--text-muted)] hover:bg-[var(--glass-2)]"
                  }`}
                >
                  <FormattedMessage id={`program.${sub}.title`} />
                </button>
              ))}
            </div>

            {/* Sub-tab content */}
            <div className={sectionCls}>
              <div className="divide-y divide-[var(--border)]">
                {filterProgramRoles(
                  programSubTab === "midweek" ? MIDWEEK_ROLES : WEEKEND_ROLES,
                  gender || null,
                  congregationRole,
                ).map(({ name, labelKey }) => {
                  const role = roleByName(name);
                  if (!role) return null;
                  return (
                    <Toggle
                      key={name}
                      label={intl.formatMessage({ id: labelKey })}
                      scope={role.scope}
                      checked={isRoleAssigned(name)}
                      onChange={(v) => toggleRole(name, v)}
                    />
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* ── Tab: Roles ─────────────────────────────────────────── */}
        {isEdit && activeTab === "roles" && canManageUsers && (
          <>
          {/* System Role */}
          <div className={sectionCls}>
            <SectionHeader id="publishers.systemRole" />
            <p className="text-xs text-[var(--text-muted)]">
              <FormattedMessage id="publishers.systemRole.hint" />
            </p>
            <select
              value={systemRole}
              onChange={(e) => setSystemRole(e.target.value)}
              className={selectCls}
            >
              <option value="publisher">{intl.formatMessage({ id: "publishers.systemRole.publisher" })}</option>
              <option value="elder">{intl.formatMessage({ id: "publishers.systemRole.elder" })}</option>
              <option value="admin">{intl.formatMessage({ id: "publishers.systemRole.admin" })}</option>
            </select>
          </div>

          {/* Auto-Mapped Roles (from congregation flags) */}
          {autoMappedRoles.length > 0 && (
            <div className={sectionCls}>
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
                <FormattedMessage id="publishers.roles.autoMapped" defaultMessage="Auto-Mapped (from congregation flags)" />
              </div>
              <div className="space-y-1">
                {autoMappedRoles.map((r) => (
                  <div key={r.fromFlag} className="flex items-center gap-2 px-4 py-2.5 bg-green-500/5 border border-green-500/10 rounded-lg">
                    <Lock size={12} className="text-green-500" />
                    <span className="text-sm">{r.roleName}</span>
                    <span className="text-[10px] text-[var(--text-muted)]">
                      (<FormattedMessage id="publishers.roles.fromFlag" defaultMessage="from flag" />)
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">
                <FormattedMessage
                  id="publishers.roles.autoMappedHint"
                  defaultMessage="These roles are set by congregation record flags and cannot be removed here."
                />
              </p>
            </div>
          )}

          {/* Manual App Roles */}
          <div className={sectionCls}>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
              <FormattedMessage id="publishers.roles.manual" defaultMessage="Manual Roles" />
            </div>
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
          </>
        )}

        {/* ── Tab: Danger Zone ─────────────────────────────────────── */}
        {isEdit && activeTab === "danger" && canManageUsers && (
          <div className="space-y-4">
            {/* Registered Devices */}
            <div className={sectionCls}>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--amber)] uppercase tracking-wide">
                <Smartphone size={16} />
                <FormattedMessage id="publishers.devices" />
              </h2>
              {!devicesLoaded ? (
                <div className="flex items-center justify-center py-4">
                  <div className="w-5 h-5 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : devices.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">
                  <FormattedMessage id="publishers.devices.none" />
                </p>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {devices.map((d) => (
                    <div key={d.id} className={`flex items-center justify-between py-3 ${d.status === "revoked" ? "opacity-50" : ""}`}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--text)] truncate">{d.displayName}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {d.platform} · {d.status === "revoked" ? (
                            <span className="text-[var(--red)]"><FormattedMessage id="publishers.devices.revoked" /></span>
                          ) : (
                            <span className="text-[var(--green)]"><FormattedMessage id="publishers.devices.active" /></span>
                          )}
                          {d.lastSyncAt && ` · ${new Date(d.lastSyncAt).toLocaleDateString()}`}
                        </p>
                      </div>
                      {d.status === "active" && (
                        <button
                          type="button"
                          onClick={() => revokeDevice(d.id)}
                          disabled={revokingDeviceId === d.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--red)] border border-[var(--red)]/30 rounded-[var(--radius-sm)] hover:bg-[var(--red)]/10 cursor-pointer transition-colors disabled:opacity-50"
                        >
                          <Ban size={12} />
                          {revokingDeviceId === d.id ? "..." : <FormattedMessage id="publishers.devices.wipe" />}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Deactivate & Delete */}
            <div className="border border-[var(--red)]/30 rounded-[var(--radius)] bg-[var(--red)]/5 p-6 space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--red)] uppercase tracking-wide">
                <AlertTriangle size={16} />
                <FormattedMessage id="publishers.dangerZone" />
              </h2>
              {!showDeleteConfirm ? (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--red)] border border-[var(--red)]/30 rounded-[var(--radius-sm)] hover:bg-[var(--red)]/10 cursor-pointer transition-colors"
                >
                  <Trash2 size={14} />
                  <FormattedMessage id="publishers.delete" />
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-[var(--text-muted)]">
                    <FormattedMessage id="publishers.delete.confirm" />
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={deletePublisher}
                      disabled={deleting}
                      className="flex items-center gap-2 px-4 py-2 text-sm bg-[var(--red)] text-white rounded-[var(--radius-sm)] hover:opacity-90 cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                      {deleting ? "..." : <FormattedMessage id="publishers.delete" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      className="px-4 py-2 text-sm text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer"
                    >
                      <FormattedMessage id="common.cancel" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Actions ─────────────────────────────────────────────── */}
        {activeTab !== "danger" && (
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
        )}
      </form>
    </div>
  );
}
