/**
 * SecurityWizard — full-screen 3-step setup wizard.
 * ADR-0077: Step 1: Password → Step 2: Passkey → Step 3: TOTP
 *
 * Blocks all navigation. Only "Log out" available.
 */
import { useState, type ReactNode } from "react";
import { useAuth } from "@/auth/useAuth";
import { useIntl, FormattedMessage } from "react-intl";
import { getApiUrl } from "@/lib/config";
import { startRegistration } from "@simplewebauthn/browser";

interface SecurityStatus {
  passwordChanged: boolean;
  passkeyRegistered: boolean;
  totpConfigured: boolean;
  setupComplete: boolean;
}

interface Props {
  status: SecurityStatus;
  onComplete: () => void;
}

type WizardStep = "password" | "passkey" | "totp";

function Check({ ok }: { ok: boolean }) {
  return (
    <span className={ok ? "text-[var(--green)]" : "text-[var(--text-muted)]"}>
      {ok ? "✓" : "✗"}
    </span>
  );
}

export function SecurityWizard({ status, onComplete }: Props): ReactNode {
  const { user, signOut } = useAuth();
  const intl = useIntl();
  const token = user?.access_token || "";
  const apiUrl = getApiUrl();

  const getInitialStep = (): WizardStep => {
    if (!status.passwordChanged) return "password";
    if (!status.passkeyRegistered && !status.totpConfigured) return "passkey";
    return "passkey"; // shouldn't happen if setupComplete is false
  };

  const [step, setStep] = useState<WizardStep>(getInitialStep);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ─── Password State ─────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState("");
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
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Password change failed");
      }
      setStep("passkey");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Passkey State ──────────────────────────────────────────────
  const handlePasskeyRegister = async () => {
    setLoading(true);
    setError(null);
    try {
      const challengeRes = await fetch(
        `${apiUrl}/security/passkeys/challenge`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!challengeRes.ok) throw new Error("Failed to get challenge");
      const options = await challengeRes.json();

      // Browser WebAuthn ceremony
      const credential = await startRegistration({ optionsJSON: options });

      const registerRes = await fetch(
        `${apiUrl}/security/passkeys/register`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ credential, label: "My Passkey" }),
        },
      );
      if (!registerRes.ok) {
        const data = await registerRes.json();
        throw new Error(data.error || "Passkey registration failed");
      }
      onComplete();
    } catch (err) {
      if ((err as Error).name === "NotAllowedError") {
        setError(
          intl.formatMessage({ id: "security.wizard.passkey.cancelled" }),
        );
      } else {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  };

  // ─── TOTP State ─────────────────────────────────────────────────
  const [totpData, setTotpData] = useState<{
    secret: string;
    qrCode: string;
  } | null>(null);
  const [totpCode, setTotpCode] = useState("");

  const handleTotpSetup = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/security/totp/setup`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to get TOTP setup");
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
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "TOTP verification failed");
      }
      onComplete();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Step Indicators ────────────────────────────────────────────
  const steps: { id: WizardStep; labelId: string }[] = [
    { id: "password", labelId: "security.wizard.step.password" },
    { id: "passkey", labelId: "security.wizard.step.passkey" },
    { id: "totp", labelId: "security.wizard.step.totp" },
  ];

  const stepIndex = steps.findIndex((s) => s.id === step);

  return (
    <div className="min-h-dvh bg-[var(--bg)] flex flex-col items-center justify-center px-4">
      {/* Header */}
      <div className="w-full max-w-md mb-8">
        <h1 className="text-2xl font-bold text-[var(--text)] text-center mb-2">
          <FormattedMessage id="security.wizard.title" />
        </h1>
        <p className="text-[var(--text-muted)] text-center text-sm">
          <FormattedMessage id="security.wizard.subtitle" />
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex gap-4 mb-8">
        {steps.map((s, i) => (
          <div
            key={s.id}
            className={`flex items-center gap-2 text-sm ${
              i === stepIndex
                ? "text-[var(--amber)] font-semibold"
                : i < stepIndex
                  ? "text-[var(--green)]"
                  : "text-[var(--text-muted)]"
            }`}
          >
            <span
              className={`w-6 h-6 rounded-full border flex items-center justify-center text-xs ${
                i < stepIndex ? "border-[var(--green)] bg-[var(--green)]/10" : "border-current"
              }`}
            >
              {i < stepIndex ? "✓" : i + 1}
            </span>
            <span className="hidden sm:inline">
              <FormattedMessage id={s.labelId} />
            </span>
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="w-full max-w-md mb-4 p-3 bg-[var(--red)]/10 border border-[var(--red)]/30 rounded-[var(--radius)] text-[var(--red)] text-sm">
          {error}
        </div>
      )}

      {/* Card */}
      <div className="w-full max-w-md bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] p-6">
        {/* ─── Password Step ─── */}
        {step === "password" && (
          <>
            <h2 className="text-lg font-bold text-[var(--text)] mb-4">
              <FormattedMessage id="security.wizard.password.title" />
            </h2>
            <div className="space-y-4">
              <input
                type="password"
                placeholder={intl.formatMessage({
                  id: "security.wizard.password.current",
                })}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius)] text-[var(--text)]"
              />
              <input
                type="password"
                placeholder={intl.formatMessage({
                  id: "security.wizard.password.new",
                })}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius)] text-[var(--text)]"
              />
              <input
                type="password"
                placeholder={intl.formatMessage({
                  id: "security.wizard.password.confirm",
                })}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius)] text-[var(--text)]"
              />

              <div className="text-sm space-y-1">
                <div>
                  <Check ok={passwordChecks.minLength} />{" "}
                  <FormattedMessage id="security.policy.minLength" />
                </div>
                <div>
                  <Check ok={passwordChecks.hasUpper} />{" "}
                  <FormattedMessage id="security.policy.uppercase" />
                </div>
                <div>
                  <Check ok={passwordChecks.hasLower} />{" "}
                  <FormattedMessage id="security.policy.lowercase" />
                </div>
                <div>
                  <Check ok={passwordChecks.hasDigit} />{" "}
                  <FormattedMessage id="security.policy.digit" />
                </div>
                <div>
                  <Check ok={passwordChecks.hasSpecial} />{" "}
                  <FormattedMessage id="security.policy.special" />
                </div>
                <div>
                  <Check ok={passwordChecks.match} />{" "}
                  <FormattedMessage id="security.policy.match" />
                </div>
              </div>

              <button
                onClick={handlePasswordSubmit}
                disabled={!passwordValid || loading}
                className="w-full py-2 bg-[var(--amber)] hover:bg-[var(--amber-light)] disabled:bg-[var(--border)] disabled:text-[var(--text-muted)] text-black font-semibold rounded-[var(--radius)] transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                {loading
                  ? "..."
                  : intl.formatMessage({
                      id: "security.wizard.password.submit",
                    })}
              </button>
            </div>
          </>
        )}

        {/* ─── Passkey Step ─── */}
        {step === "passkey" && (
          <>
            <h2 className="text-lg font-bold text-[var(--text)] mb-2">
              <FormattedMessage id="security.wizard.passkey.title" />
            </h2>
            <p className="text-[var(--text-muted)] text-sm mb-6">
              <FormattedMessage id="security.wizard.passkey.description" />
            </p>
            <div className="space-y-3">
              <button
                onClick={handlePasskeyRegister}
                disabled={loading}
                className="w-full py-2 bg-[var(--amber)] hover:bg-[var(--amber-light)] disabled:bg-[var(--border)] text-black font-semibold rounded-[var(--radius)] transition-colors cursor-pointer"
              >
                {loading
                  ? "..."
                  : intl.formatMessage({
                      id: "security.wizard.passkey.register",
                    })}
              </button>
              <button
                onClick={() => setStep("totp")}
                className="w-full py-2 text-[var(--text-muted)] hover:text-[var(--text)] text-sm cursor-pointer"
              >
                <FormattedMessage id="security.wizard.passkey.skip" />
              </button>
            </div>
          </>
        )}

        {/* ─── TOTP Step ─── */}
        {step === "totp" && (
          <>
            <h2 className="text-lg font-bold text-[var(--text)] mb-2">
              <FormattedMessage id="security.wizard.totp.title" />
            </h2>
            <p className="text-[var(--text-muted)] text-sm mb-4">
              <FormattedMessage id="security.wizard.totp.description" />
            </p>

            {!totpData ? (
              <button
                onClick={handleTotpSetup}
                disabled={loading}
                className="w-full py-2 bg-[var(--amber)] hover:bg-[var(--amber-light)] disabled:bg-[var(--border)] text-black font-semibold rounded-[var(--radius)] transition-colors cursor-pointer"
              >
                {loading
                  ? "..."
                  : intl.formatMessage({
                      id: "security.wizard.totp.generate",
                    })}
              </button>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-center">
                  <img
                    src={totpData.qrCode}
                    alt="TOTP QR Code"
                    className="w-48 h-48 rounded-[var(--radius)]"
                  />
                </div>
                <div className="text-center">
                  <p className="text-xs text-[var(--text-muted)] mb-1">
                    <FormattedMessage id="security.wizard.totp.manual" />
                  </p>
                  <code className="text-xs text-[var(--text)] bg-[var(--input)] px-2 py-1 rounded break-all">
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
                  onChange={(e) =>
                    setTotpCode(e.target.value.replace(/\D/g, ""))
                  }
                  className="w-full px-3 py-2 bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius)] text-[var(--text)] text-center text-2xl tracking-widest"
                />
                <button
                  onClick={handleTotpVerify}
                  disabled={totpCode.length !== 6 || loading}
                  className="w-full py-2 bg-[var(--amber)] hover:bg-[var(--amber-light)] disabled:bg-[var(--border)] disabled:text-[var(--text-muted)] text-black font-semibold rounded-[var(--radius)] transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  {loading
                    ? "..."
                    : intl.formatMessage({
                        id: "security.wizard.totp.verify",
                      })}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Logout */}
      <button
        onClick={() => signOut()}
        className="mt-6 text-[var(--text-muted)] hover:text-[var(--text)] text-sm cursor-pointer"
      >
        <FormattedMessage id="security.wizard.logout" />
      </button>
    </div>
  );
}
