import { useState, useEffect, useCallback } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { usePermissions } from "@/auth/PermissionProvider";

interface PublisherData {
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  phone: string;
  gender: string;
  dateOfBirth: string;
  address: string;
  congregationRole: string;
  congregationFlags: string[];
  status: string;
  notes: string;
}

const EMPTY: PublisherData = {
  firstName: "",
  lastName: "",
  displayName: "",
  email: "",
  phone: "",
  gender: "",
  dateOfBirth: "",
  address: "",
  congregationRole: "publisher",
  congregationFlags: [],
  status: "active",
  notes: "",
};

const CONGREGATION_ROLES = ["publisher", "ministerial_servant", "elder"] as const;

const ELDER_FLAGS = [
  "coordinator",
  "secretary",
  "service_overseer",
  "life_and_ministry_overseer",
  "watchtower_conductor",
  "circuit_overseer",
] as const;

const MS_FLAGS = [
  "accounts_servant",
  "literature_servant",
  "territory_servant",
] as const;

const GENERAL_FLAGS = [
  "regular_pioneer",
  "auxiliary_pioneer",
  "unbaptized_publisher",
  "student",
] as const;

const STATUSES = [
  "active",
  "inactive",
  "invited",
  "pending_approval",
  "rejected",
] as const;

import { API_BASE } from "@/lib/config";

const inputClass =
  "w-full px-3 py-2 bg-[var(--bg-2)] border border-[var(--border-2)] rounded-[var(--radius-sm)] text-[var(--text)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)] transition-colors";

export function PublisherForm() {
  const navigate = useNavigate();
  const intl = useIntl();
  const { id } = useParams();
  const { user } = useAuth();
  const { can } = usePermissions();
  const isEdit = Boolean(id);

  const [data, setData] = useState<PublisherData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const canEdit = can("app:publishers.edit");

  const fetchPublisher = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/publishers/${id}`, {
        headers: { Authorization: `Bearer ${user?.access_token}` },
      });
      if (res.ok) {
        const p = await res.json();
        setData({
          firstName: p.firstName ?? "",
          lastName: p.lastName ?? "",
          displayName: p.displayName ?? "",
          email: p.email ?? "",
          phone: p.phone ?? "",
          gender: p.gender ?? "",
          dateOfBirth: p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : "",
          address: p.address ?? "",
          congregationRole: p.congregationRole ?? "publisher",
          congregationFlags: p.congregationFlags ?? [],
          status: p.status ?? "active",
          notes: p.notes ?? "",
        });
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [id, user?.access_token]);

  useEffect(() => {
    fetchPublisher();
  }, [fetchPublisher]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        firstName: data.firstName,
        lastName: data.lastName,
        displayName: data.displayName || undefined,
        email: data.email || undefined,
        phone: data.phone || undefined,
        gender: data.gender || undefined,
        dateOfBirth: data.dateOfBirth || undefined,
        address: data.address || undefined,
        congregationRole: data.congregationRole,
        congregationFlags: data.congregationFlags,
        status: data.status,
        notes: data.notes || undefined,
      };

      const url = isEdit
        ? `${API_BASE}/publishers/${id}`
        : `${API_BASE}/publishers`;
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${user?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        navigate("/publishers");
      }
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof PublisherData>(
    key: K,
    value: PublisherData[K],
  ) => setData((prev) => ({ ...prev, [key]: value }));

  const toggleFlag = (flag: string) => {
    setData((prev) => ({
      ...prev,
      congregationFlags: prev.congregationFlags.includes(flag)
        ? prev.congregationFlags.filter((f) => f !== flag)
        : [...prev.congregationFlags, flag],
    }));
  };

  // Filter available flags based on congregation role
  const availableFlags = [
    ...GENERAL_FLAGS,
    ...(data.congregationRole === "elder" ? ELDER_FLAGS : []),
    ...(data.congregationRole === "ministerial_servant" ? MS_FLAGS : []),
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-[var(--amber)]" />
      </div>
    );
  }

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

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Personal Info */}
        <fieldset className="space-y-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-6">
          <legend className="text-sm font-semibold text-[var(--text)] px-2">
            <FormattedMessage id="publishers.section.personal" />
          </legend>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* First Name */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[var(--text-muted)]">
                <FormattedMessage id="publishers.field.firstName" />{" "}
                <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                required
                value={data.firstName}
                onChange={(e) => set("firstName", e.target.value)}
                className={inputClass}
              />
            </div>

            {/* Last Name */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[var(--text-muted)]">
                <FormattedMessage id="publishers.field.lastName" />{" "}
                <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                required
                value={data.lastName}
                onChange={(e) => set("lastName", e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          {/* Display Name */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-[var(--text-muted)]">
              <FormattedMessage id="publishers.field.displayName" />
            </label>
            <input
              type="text"
              value={data.displayName}
              onChange={(e) => set("displayName", e.target.value)}
              placeholder={intl.formatMessage({
                id: "publishers.field.displayName_hint",
              })}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Gender */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[var(--text-muted)]">
                <FormattedMessage id="publishers.field.gender" />
              </label>
              <select
                value={data.gender}
                onChange={(e) => set("gender", e.target.value)}
                className={inputClass}
              >
                <option value="">—</option>
                <option value="male">
                  {intl.formatMessage({ id: "publishers.gender.male" })}
                </option>
                <option value="female">
                  {intl.formatMessage({ id: "publishers.gender.female" })}
                </option>
              </select>
            </div>

            {/* Date of Birth */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[var(--text-muted)]">
                <FormattedMessage id="publishers.field.dateOfBirth" />
              </label>
              <input
                type="date"
                value={data.dateOfBirth}
                onChange={(e) => set("dateOfBirth", e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        </fieldset>

        {/* Contact */}
        <fieldset className="space-y-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-6">
          <legend className="text-sm font-semibold text-[var(--text)] px-2">
            <FormattedMessage id="publishers.section.contact" />
          </legend>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Email */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[var(--text-muted)]">
                <FormattedMessage id="publishers.field.email" />
              </label>
              <input
                type="email"
                value={data.email}
                onChange={(e) => set("email", e.target.value)}
                className={inputClass}
              />
            </div>

            {/* Phone */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[var(--text-muted)]">
                <FormattedMessage id="publishers.field.phone" />
              </label>
              <input
                type="tel"
                value={data.phone}
                onChange={(e) => set("phone", e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          {/* Address */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-[var(--text-muted)]">
              <FormattedMessage id="publishers.field.address" />
            </label>
            <textarea
              value={data.address}
              onChange={(e) => set("address", e.target.value)}
              rows={2}
              className={inputClass}
            />
          </div>
        </fieldset>

        {/* Congregation */}
        <fieldset className="space-y-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-6">
          <legend className="text-sm font-semibold text-[var(--text)] px-2">
            <FormattedMessage id="publishers.section.congregation" />
          </legend>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Congregation Role */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[var(--text-muted)]">
                <FormattedMessage id="publishers.field.congregationRole" />
              </label>
              <select
                value={data.congregationRole}
                onChange={(e) => {
                  set("congregationRole", e.target.value);
                  // Clear role-specific flags when role changes
                  setData((prev) => ({
                    ...prev,
                    congregationRole: e.target.value,
                    congregationFlags: prev.congregationFlags.filter(
                      (f) =>
                        GENERAL_FLAGS.includes(f as (typeof GENERAL_FLAGS)[number]),
                    ),
                  }));
                }}
                className={inputClass}
              >
                {CONGREGATION_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {intl.formatMessage({ id: `publishers.role.${role}` })}
                  </option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[var(--text-muted)]">
                <FormattedMessage id="publishers.field.status" />
              </label>
              <select
                value={data.status}
                onChange={(e) => set("status", e.target.value)}
                className={inputClass}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {intl.formatMessage({ id: `publishers.status.${s}` })}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Congregation Flags */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-[var(--text-muted)]">
              <FormattedMessage id="publishers.field.flags" />
            </label>
            <div className="flex flex-wrap gap-2">
              {availableFlags.map((flag) => {
                const active = data.congregationFlags.includes(flag);
                return (
                  <button
                    key={flag}
                    type="button"
                    onClick={() => toggleFlag(flag)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
                      active
                        ? "bg-[var(--amber)]/15 text-[var(--amber)] border-[var(--amber)]/30"
                        : "bg-[var(--bg-2)] text-[var(--text-muted)] border-[var(--border-2)] hover:border-[var(--amber)]/50"
                    }`}
                  >
                    {intl.formatMessage({
                      id: `publishers.flag.${flag}`,
                      defaultMessage: flag.replace(/_/g, " "),
                    })}
                  </button>
                );
              })}
            </div>
          </div>
        </fieldset>

        {/* Notes */}
        <fieldset className="space-y-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-6">
          <legend className="text-sm font-semibold text-[var(--text)] px-2">
            <FormattedMessage id="publishers.section.notes" />
          </legend>
          <textarea
            value={data.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
            placeholder={intl.formatMessage({
              id: "publishers.field.notes_hint",
            })}
            className={inputClass}
          />
        </fieldset>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || !canEdit}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--amber)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer disabled:opacity-50"
          >
            {saving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )}
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
