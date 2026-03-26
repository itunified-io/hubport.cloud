/**
 * SecuritySection — self-service security management for the profile page.
 * ADR-0077: Password change, passkey management, TOTP management, active sessions.
 */
import { useState, useEffect } from "react";
import { useIntl, FormattedMessage } from "react-intl";
import {
  Key,
  Fingerprint,
  Smartphone,
  Monitor,
  Trash2,
  Clock,
  Globe,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";

// ─── Types ───────────────────────────────────────────────────────────
interface Passkey {
  id: string;
  label: string;
  createdAt: string;
}

interface Session {
  id: string;
  ipAddress: string;
  start: number;
  lastAccess: number;
  current: boolean;
}

// ─── PasswordChange ──────────────────────────────────────────────────
function PasswordChange({
  token,
  apiUrl,
}: {
  token: string;
  apiUrl: string;
}) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const checks = {
    minLength: newPassword.length >= 12,
    hasUpper: /[A-Z]/.test(newPassword),
    hasLower: /[a-z]/.test(newPassword),
    hasDigit: /\d/.test(newPassword),
    hasSpecial: /[^A-Za-z0-9]/.test(newPassword),
    match: newPassword === confirmPassword && confirmPassword.length > 0,
  };
  const valid = Object.values(checks).every(Boolean);

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/security/password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Password change failed");
      }
      setSuccess(true);
      setOpen(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key size={16} className="text-[var(--text-muted)]" />
          <h3 className="text-sm font-medium text-[var(--text)]">
            <FormattedMessage id="security.profile.password.title" />
          </h3>
        </div>
        {!open && (
          <button
            onClick={() => {
              setOpen(true);
              setSuccess(false);
            }}
            className="text-xs text-[var(--amber)] hover:text-[var(--amber-light)] cursor-pointer"
          >
            <FormattedMessage id="security.profile.password.change" />
          </button>
        )}
      </div>

      {success && (
        <p className="text-xs text-[var(--green)]">Password changed successfully.</p>
      )}

      {open && (
        <div className="space-y-3 pl-6">
          {error && (
            <p className="text-xs text-[var(--red)]">{error}</p>
          )}
          <input
            type="password"
            name="current-password"
            autoComplete="current-password"
            placeholder={intl.formatMessage({ id: "security.wizard.password.current" })}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full px-3 py-1.5 text-sm bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
          />
          <input
            type="password"
            name="new-password"
            autoComplete="new-password"
            placeholder={intl.formatMessage({ id: "security.wizard.password.new" })}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full px-3 py-1.5 text-sm bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
          />
          <input
            type="password"
            name="confirm-password"
            autoComplete="new-password"
            placeholder={intl.formatMessage({ id: "security.wizard.password.confirm" })}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full px-3 py-1.5 text-sm bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
          />

          <div className="text-xs space-y-0.5 text-[var(--text-muted)]">
            {(
              [
                ["minLength", "security.policy.minLength"],
                ["hasUpper", "security.policy.uppercase"],
                ["hasLower", "security.policy.lowercase"],
                ["hasDigit", "security.policy.digit"],
                ["hasSpecial", "security.policy.special"],
                ["match", "security.policy.match"],
              ] as const
            ).map(([key, msgId]) => (
              <div key={key}>
                <span className={checks[key] ? "text-[var(--green)]" : ""}>
                  {checks[key] ? "✓" : "✗"}
                </span>{" "}
                <FormattedMessage id={msgId} />
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={!valid || loading}
              className="px-3 py-1.5 text-xs font-semibold bg-[var(--amber)] text-black rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              {loading ? "..." : intl.formatMessage({ id: "security.wizard.password.submit" })}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
            >
              <FormattedMessage id="common.cancel" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PasskeyManager ──────────────────────────────────────────────────
function PasskeyManager({
  token,
  apiUrl,
  hasTotpConfigured,
}: {
  token: string;
  apiUrl: string;
  hasTotpConfigured: boolean;
}) {
  const intl = useIntl();
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchPasskeys = async () => {
    try {
      const res = await fetch(`${apiUrl}/security/passkeys`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setPasskeys(await res.json());
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    fetchPasskeys();
  }, [token]);

  const handleRemove = async (id: string) => {
    if (passkeys.length === 1 && !hasTotpConfigured) {
      setError(intl.formatMessage({ id: "security.profile.passkeys.removeBlocked" }));
      return;
    }
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/security/passkeys/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Remove failed");
      }
      await fetchPasskeys();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Fingerprint size={16} className="text-[var(--text-muted)]" />
          <h3 className="text-sm font-medium text-[var(--text)]">
            <FormattedMessage id="security.profile.passkeys.title" />
          </h3>
        </div>
      </div>

      {error && <p className="text-xs text-[var(--red)]">{error}</p>}

      {passkeys.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] pl-6">
          <FormattedMessage id="security.profile.passkeys.empty" />
        </p>
      ) : (
        <div className="space-y-2 pl-6">
          {passkeys.map((pk) => (
            <div
              key={pk.id}
              className="flex items-center justify-between py-1.5 px-3 bg-[var(--bg-2)] rounded-[var(--radius-sm)]"
            >
              <div>
                <p className="text-sm text-[var(--text)]">{pk.label}</p>
                <p className="text-[10px] text-[var(--text-muted)]">
                  {new Date(pk.createdAt).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => handleRemove(pk.id)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--red)] cursor-pointer"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-[var(--text-muted)] pl-6">
        <FormattedMessage id="security.profile.passkeys.addHint" />
      </p>
    </div>
  );
}

// ─── TotpManager ─────────────────────────────────────────────────────
function TotpManager({
  token,
  apiUrl,
  totpConfigured,
  onToggle,
  hasPasskeys,
}: {
  token: string;
  apiUrl: string;
  totpConfigured: boolean;
  onToggle: () => void;
  hasPasskeys: boolean;
}) {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRemove = async () => {
    if (!hasPasskeys) {
      setError(intl.formatMessage({ id: "security.profile.totp.removeBlocked" }));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/security/totp`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Remove failed");
      }
      onToggle();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Smartphone size={16} className="text-[var(--text-muted)]" />
          <h3 className="text-sm font-medium text-[var(--text)]">
            <FormattedMessage id="security.profile.totp.title" />
          </h3>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              totpConfigured
                ? "bg-[var(--green)]/10 text-[var(--green)]"
                : "bg-[var(--border)] text-[var(--text-muted)]"
            }`}
          >
            {totpConfigured ? (
              <FormattedMessage id="security.profile.totp.configured" />
            ) : (
              <FormattedMessage id="security.profile.totp.notConfigured" />
            )}
          </span>
        </div>
        {totpConfigured && (
          <button
            onClick={handleRemove}
            disabled={loading}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--red)] cursor-pointer"
          >
            <FormattedMessage id="security.profile.totp.remove" />
          </button>
        )}
      </div>

      {error && <p className="text-xs text-[var(--red)]">{error}</p>}

      {!totpConfigured && (
        <p className="text-xs text-[var(--text-muted)] pl-6">
          <FormattedMessage id="security.profile.totp.setupHint" />
        </p>
      )}
    </div>
  );
}

// ─── SessionList ─────────────────────────────────────────────────────
function SessionList({
  token,
  apiUrl,
}: {
  token: string;
  apiUrl: string;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = async () => {
    try {
      const res = await fetch(`${apiUrl}/security/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setSessions(await res.json());
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    fetchSessions();
  }, [token]);

  const handleRevoke = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/security/sessions/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to revoke session");
      await fetchSessions();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Monitor size={16} className="text-[var(--text-muted)]" />
        <h3 className="text-sm font-medium text-[var(--text)]">
          <FormattedMessage id="security.profile.sessions.title" />
        </h3>
      </div>

      {error && <p className="text-xs text-[var(--red)]">{error}</p>}

      {sessions.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] pl-6">No active sessions.</p>
      ) : (
        <div className="space-y-2 pl-6">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between py-1.5 px-3 bg-[var(--bg-2)] rounded-[var(--radius-sm)]"
            >
              <div className="flex items-center gap-3">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Globe size={10} className="text-[var(--text-muted)]" />
                    <span className="text-xs text-[var(--text)]">{s.ipAddress}</span>
                    {s.current && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--green)]/10 text-[var(--green)]">
                        <FormattedMessage id="security.profile.sessions.current" />
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Clock size={10} className="text-[var(--text-muted)]" />
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {new Date(s.lastAccess * 1000).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
              {!s.current && (
                <button
                  onClick={() => handleRevoke(s.id)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--red)] cursor-pointer"
                >
                  <FormattedMessage id="security.profile.sessions.revoke" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SecuritySection (Exported) ──────────────────────────────────────
export function SecuritySection() {
  const { user } = useAuth();
  const token = user?.access_token || "";
  const apiUrl = getApiUrl();
  const [totpConfigured, setTotpConfigured] = useState(false);
  const [passkeysExist, setPasskeysExist] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${apiUrl}/security/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTotpConfigured(data.totpConfigured);
        setPasskeysExist(data.passkeyRegistered);
      }
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (token) fetchStatus();
  }, [token]);

  return (
    <div className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] space-y-6">
      <h2 className="text-sm font-medium text-[var(--text)]">
        <FormattedMessage id="security.profile.title" />
      </h2>

      <PasswordChange token={token} apiUrl={apiUrl} />

      <div className="border-t border-[var(--border)]" />

      <PasskeyManager
        token={token}
        apiUrl={apiUrl}
        hasTotpConfigured={totpConfigured}
      />

      <div className="border-t border-[var(--border)]" />

      <TotpManager
        token={token}
        apiUrl={apiUrl}
        totpConfigured={totpConfigured}
        onToggle={fetchStatus}
        hasPasskeys={passkeysExist}
      />

      <div className="border-t border-[var(--border)]" />

      <SessionList token={token} apiUrl={apiUrl} />
    </div>
  );
}
