/**
 * InviteWizard — Full-screen invite signup wizard for unauthenticated users.
 *
 * Flow:
 *  1. Reads ?code= from URL → auto-validates via POST /onboarding/redeem
 *  2. Falls back to manual CodeValidation on error
 *  3. Steps: user_info → security → privacy → complete
 *  4. Token stored in React state (never persisted to localStorage)
 *  5. On 401: re-calls /onboarding/redeem with original code to resume
 */
import { useState, useEffect, type ReactNode } from "react";
import { useIntl, FormattedMessage } from "react-intl";
import { getApiUrl } from "../../lib/config";
import { CodeValidation } from "./CodeValidation";
import { UserInfoStep } from "./UserInfoStep";
import { SecurityStep } from "./SecurityStep";
import { PrivacyStep } from "./PrivacyStep";
import { CompletionStep } from "./CompletionStep";

type WizardPhase = "validating" | "code_entry" | "user_info" | "security" | "privacy" | "complete";

interface PublisherData {
  email: string;
  firstName?: string;
  lastName?: string;
  onboardingStep?: string;
}

const STEP_LABELS = [
  { id: "user_info", labelId: "invite.step.userInfo" },
  { id: "security", labelId: "invite.step.security" },
  { id: "privacy", labelId: "invite.step.privacy" },
] as const;

function phaseToStepIndex(phase: WizardPhase): number {
  if (phase === "user_info") return 0;
  if (phase === "security") return 1;
  if (phase === "privacy") return 2;
  return -1;
}

function onboardingStepToPhase(step: string): WizardPhase {
  if (step === "code_redeemed") return "user_info";
  if (step === "user_info") return "security";
  if (step === "security") return "privacy";
  if (step === "complete") return "complete";
  return "user_info";
}

export function InviteWizard(): ReactNode {
  const intl = useIntl();
  const searchParams = new URLSearchParams(window.location.search);
  const urlCode = searchParams.get("code") || "";

  const [phase, setPhase] = useState<WizardPhase>(urlCode ? "validating" : "code_entry");
  const [token, setToken] = useState<string>("");
  const [originalCode, setOriginalCode] = useState<string>(urlCode);
  const [publisher, setPublisher] = useState<PublisherData | null>(null);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);

  // Validate code against API, return token + publisher or throw
  const redeemCode = async (code: string): Promise<void> => {
    const res = await fetch(`${getApiUrl()}/onboarding/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.toUpperCase().trim() }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const serverCode = data.code as string | undefined;

      if (serverCode === "INVALID_CODE") throw new Error(intl.formatMessage({ id: "invite.error.invalid" }));
      if (serverCode === "CODE_EXPIRED" || res.status === 410) throw new Error(intl.formatMessage({ id: "invite.error.expired" }));
      if (serverCode === "RATE_LIMITED" || res.status === 429) throw new Error(intl.formatMessage({ id: "invite.error.rate_limited" }));
      if (serverCode === "ALREADY_COMPLETE") throw new Error(intl.formatMessage({ id: "invite.error.already_complete" }));
      throw new Error(data.error || intl.formatMessage({ id: "invite.error.generic" }));
    }

    const data = await res.json();
    setToken(data.token);
    setPublisher(data.publisher);

    const targetPhase = onboardingStepToPhase(data.publisher.onboardingStep || "code_redeemed");
    setPhase(targetPhase);
  };

  // Auto-validate URL code on mount
  useEffect(() => {
    if (!urlCode) return;
    setOriginalCode(urlCode);
    redeemCode(urlCode).catch((err) => {
      setValidateError((err as Error).message);
      setPhase("code_entry");
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Manual code entry handler
  const handleCodeSubmit = async (code: string) => {
    setCodeLoading(true);
    setValidateError(null);
    setOriginalCode(code);
    try {
      await redeemCode(code);
    } catch (err) {
      setValidateError((err as Error).message);
    } finally {
      setCodeLoading(false);
    }
  };

  // Session expired: re-redeem with original code
  const handleSessionExpired = async () => {
    setValidateError(intl.formatMessage({ id: "invite.error.session_expired" }));
    if (!originalCode) { setPhase("code_entry"); return; }
    try {
      await redeemCode(originalCode);
    } catch {
      setPhase("code_entry");
    }
  };

  const stepIndex = phaseToStepIndex(phase);

  return (
    <div className="min-h-dvh bg-[var(--bg)] flex flex-col items-center justify-center px-4 py-8">
      {/* Header */}
      <div className="w-full max-w-md mb-6 text-center">
        <h1 className="text-2xl font-bold text-[var(--amber)] mb-1">Hubport</h1>
        {phase !== "complete" && phase !== "validating" && phase !== "code_entry" && (
          <p className="text-[var(--text-muted)] text-sm">
            <FormattedMessage id="invite.security.subtitle" />
          </p>
        )}
      </div>

      {/* Step indicator (only during wizard steps) */}
      {stepIndex >= 0 && (
        <div className="flex gap-4 mb-6">
          {STEP_LABELS.map((s, i) => (
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
                  i < stepIndex
                    ? "border-[var(--green)] bg-[var(--green)]/10"
                    : "border-current"
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
      )}

      {/* Validating */}
      {phase === "validating" && (
        <div className="text-[var(--text-muted)] text-sm">
          <FormattedMessage id="invite.loading" />
        </div>
      )}

      {/* Code Entry */}
      {phase === "code_entry" && (
        <CodeValidation
          onSubmit={handleCodeSubmit}
          loading={codeLoading}
          error={validateError}
        />
      )}

      {/* Wizard card */}
      {(phase === "user_info" || phase === "security" || phase === "privacy" || phase === "complete") && (
        <div className="w-full max-w-md bg-[var(--card,var(--bg-2))] border border-[var(--border)] rounded-[var(--radius)] p-6">
          {phase === "user_info" && publisher && (
            <UserInfoStep
              token={token}
              email={publisher.email || ""}
              initialFirstName={publisher.firstName}
              initialLastName={publisher.lastName}
              onComplete={(newToken) => {
                setToken(newToken);
                setPhase("security");
              }}
              onSessionExpired={handleSessionExpired}
            />
          )}

          {phase === "security" && (
            <SecurityStep
              token={token}
              onComplete={(newToken) => {
                setToken(newToken);
                setPhase("privacy");
              }}
              onSessionExpired={handleSessionExpired}
            />
          )}

          {phase === "privacy" && (
            <PrivacyStep
              token={token}
              onComplete={() => setPhase("complete")}
              onSessionExpired={handleSessionExpired}
            />
          )}

          {phase === "complete" && <CompletionStep />}
        </div>
      )}
    </div>
  );
}
