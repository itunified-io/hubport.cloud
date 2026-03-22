/**
 * SecurityStep — Step 2 of invite wizard.
 * Sub-steps: password → passkey → TOTP.
 * Uses onboarding token (in memory), mirrors SecurityWizard patterns.
 */
import { useState, type ReactNode } from "react";
import { useIntl, FormattedMessage } from "react-intl";
import { startRegistration } from "@simplewebauthn/browser";
import { getApiUrl } from "../../lib/config";

type SubStep = "password" | "passkey" | "totp";

interface Props {
  token: string;
  onComplete: (newToken: string) => void;
  onSessionExpired: () => void;
}

function Check({ ok }: { ok: boolean }) {
  return (
    <span className={ok ? "text-[var(--green)]" : "text-[var(--text-muted)]"}>
      {ok ? "✓" : "✗"}
    </span>
  );
}

export function SecurityStep({ token, onComplete, onSessionExpired }: Props): ReactNode {
  const intl = useIntl();
  const apiUrl = getApiUrl();

  const [subStep, setSubStep] = useState<SubStep>("password");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ─── Password State ──────────────────────────────────────────────
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const passwordChecks = {
    minLength: newPassword.length >= 12,
    hasUpper: /[A-Z]/.test(newPassword),
    hasLower: /[a-z]/.test(newPassword),
    hasDigit: /\d/.test(newPassword),
    hasSpecial: /[^A-Za-z0-9]/.test(newPassword),
    match: newPassword === confirmPassword && confirmPassword.length > 0,
  };
  const passwordValid = Object.values(passwordChecks).every(Boolean);

  const handlePasswordSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/security/password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ newPassword }),
      });
      if (res.status === 401) { onSessionExpired(); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || intl.formatMessage({ id: "invite.error.generic" }));
      }
      setSubStep("passkey");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Passkey State ───────────────────────────────────────────────
  const handlePasskeyRegister = async () => {
    setLoading(true);
    setError(null);
    try {
      const challengeRes = await fetch(`${apiUrl}/security/passkeys/challenge`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (challengeRes.status === 401) { onSessionExpired(); return; }
      if (!challengeRes.ok) throw new Error("Failed to get challenge");
      const options = await challengeRes.json();

      const credential = await startRegistration({ optionsJSON: options });

      const registerRes = await fetch(`${apiUrl}/security/passkeys/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ credential, label: "My Passkey" }),
      });
      if (registerRes.status === 401) { onSessionExpired(); return; }
      if (!registerRes.ok) {
        const data = await registerRes.json().catch(() => ({}));
        throw new Error(data.error || intl.formatMessage({ id: "invite.error.generic" }));
      }
      setSubStep("totp");
    } catch (err) {
      if ((err as Error).name === "NotAllowedError") {
        setError(intl.formatMessage({ id: "invite.security.passkey.cancelled" }));
      } else {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  };

  // ─── TOTP State ──────────────────────────────────────────────────
  const [totpData, setTotpData] = useState<{ secret: string; qrCode: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");

  const handleTotpSetup = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/security/totp/setup`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) { onSessionExpired(); return; }
      if (!res.ok) throw new Error(intl.formatMessage({ id: "invite.error.generic" }));
      const data = await res.json();
      setTotpData(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleTotpVerify = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/security/totp/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: totpCode }),
      });
      if (res.status === 401) { onSessionExpired(); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || intl.formatMessage({ id: "invite.error.generic" }));
      }

      // Advance onboarding step
      const advanceRes = await fetch(`${apiUrl}/onboarding/complete-security`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (advanceRes.status === 401) { onSessionExpired(); return; }
      if (!advanceRes.ok) {
        const data = await advanceRes.json().catch(() => ({}));
        throw new Error(data.error || intl.formatMessage({ id: "invite.error.generic" }));
      }
      const data = await advanceRes.json();
      onComplete(data.token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "w-full px-3 py-2 bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)] transition-colors";

  return (
    <>
      <h2 className="text-lg font-bold text-[var(--text)] mb-1">
        <FormattedMessage id="invite.security.title" />
      </h2>
      <p className="text-[var(--text-muted)] text-sm mb-4">
        <FormattedMessage id="invite.security.subtitle" />
      </p>

      {error && (
        <div className="mb-4 p-3 bg-[var(--red)]/10 border border-[var(--red)]/30 rounded-[var(--radius)] text-[var(--red)] text-sm">
          {error}
        </div>
      )}

      {/* ─── Password Sub-step ─── */}
      {subStep === "password" && (
        <div className="space-y-4">
          <h3 className="font-semibold text-[var(--text)]">
            <FormattedMessage id="invite.security.password.title" />
          </h3>
          <input
            type="password"
            autoComplete="new-password"
            placeholder={intl.formatMessage({ id: "invite.security.password.new" })}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={inputClass}
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder={intl.formatMessage({ id: "invite.security.password.confirm" })}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={inputClass}
          />

          <div className="text-sm space-y-1">
            <div><Check ok={passwordChecks.minLength} /> <FormattedMessage id="security.policy.minLength" /></div>
            <div><Check ok={passwordChecks.hasUpper} /> <FormattedMessage id="security.policy.uppercase" /></div>
            <div><Check ok={passwordChecks.hasLower} /> <FormattedMessage id="security.policy.lowercase" /></div>
            <div><Check ok={passwordChecks.hasDigit} /> <FormattedMessage id="security.policy.digit" /></div>
            <div><Check ok={passwordChecks.hasSpecial} /> <FormattedMessage id="security.policy.special" /></div>
            <div><Check ok={passwordChecks.match} /> <FormattedMessage id="security.policy.match" /></div>
          </div>

          <button
            onClick={handlePasswordSubmit}
            disabled={!passwordValid || loading}
            className="w-full py-2 bg-[var(--amber)] hover:bg-[var(--amber-light)] disabled:bg-[var(--border)] disabled:text-[var(--text-muted)] text-black font-semibold rounded-[var(--radius)] transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {loading ? "..." : intl.formatMessage({ id: "invite.security.password.submit" })}
          </button>
        </div>
      )}

      {/* ─── Passkey Sub-step ─── */}
      {subStep === "passkey" && (
        <div className="space-y-4">
          <h3 className="font-semibold text-[var(--text)]">
            <FormattedMessage id="invite.security.passkey.title" />
          </h3>
          <p className="text-[var(--text-muted)] text-sm">
            <FormattedMessage id="invite.security.passkey.description" />
          </p>
          <button
            onClick={handlePasskeyRegister}
            disabled={loading}
            className="w-full py-2 bg-[var(--amber)] hover:bg-[var(--amber-light)] disabled:bg-[var(--border)] text-black font-semibold rounded-[var(--radius)] transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {loading ? "..." : intl.formatMessage({ id: "invite.security.passkey.register" })}
          </button>
          <button
            onClick={() => { setError(null); setSubStep("totp"); }}
            disabled={loading}
            className="w-full py-2 border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] rounded-[var(--radius)] transition-colors cursor-pointer text-sm disabled:opacity-50"
          >
            <FormattedMessage id="invite.security.passkey.skip" />
          </button>
        </div>
      )}

      {/* ─── TOTP Sub-step ─── */}
      {subStep === "totp" && (
        <div className="space-y-4">
          <h3 className="font-semibold text-[var(--text)]">
            <FormattedMessage id="invite.security.totp.title" />
          </h3>
          <p className="text-[var(--text-muted)] text-sm">
            <FormattedMessage id="invite.security.totp.description" />
          </p>

          {!totpData ? (
            <button
              onClick={handleTotpSetup}
              disabled={loading}
              className="w-full py-2 bg-[var(--amber)] hover:bg-[var(--amber-light)] disabled:bg-[var(--border)] text-black font-semibold rounded-[var(--radius)] transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              {loading
                ? intl.formatMessage({ id: "invite.security.totp.loading" })
                : intl.formatMessage({ id: "invite.security.totp.generate" })}
            </button>
          ) : (
            <>
              <div className="flex justify-center">
                <img
                  src={totpData.qrCode}
                  alt="TOTP QR Code"
                  className="w-48 h-48 rounded-[var(--radius)]"
                />
              </div>
              <div className="text-center">
                <p className="text-xs text-[var(--text-muted)] mb-1">
                  <FormattedMessage id="invite.security.totp.manual" />
                </p>
                <code className="text-xs text-[var(--text)] bg-[var(--bg-2)] px-2 py-1 rounded break-all">
                  {totpData.secret}
                </code>
              </div>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                className={`${inputClass} text-center text-2xl tracking-widest`}
              />
              <button
                onClick={handleTotpVerify}
                disabled={totpCode.length !== 6 || loading}
                className="w-full py-2 bg-[var(--amber)] hover:bg-[var(--amber-light)] disabled:bg-[var(--border)] disabled:text-[var(--text-muted)] text-black font-semibold rounded-[var(--radius)] transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                {loading ? "..." : intl.formatMessage({ id: "invite.security.totp.verify" })}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
