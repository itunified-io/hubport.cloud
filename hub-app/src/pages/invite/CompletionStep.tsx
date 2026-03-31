/**
 * CompletionStep — Final step of invite wizard.
 * Shows temp password for initial login. Keycloak will enforce
 * password change, TOTP setup, and passkey registration.
 */
import { useState, type ReactNode } from "react";
import { FormattedMessage } from "react-intl";
import { Eye, EyeOff, Copy, Check } from "lucide-react";

interface Props {
  email: string;
  tempPassword: string;
}

export function CompletionStep({ email, tempPassword }: Props): ReactNode {
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(tempPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLogin = () => {
    window.location.href = "/";
  };

  return (
    <div className="space-y-5">
      <div className="text-center">
        <div className="text-4xl mb-3">🔐</div>
        <h2 className="text-xl font-bold text-[var(--text)]">
          <FormattedMessage id="invite.complete.title" />
        </h2>
      </div>

      <div className="p-4 rounded-[var(--radius)] bg-[var(--bg)]/50 border border-[var(--amber)]/30 space-y-3">
        <p className="text-sm text-[var(--text-muted)]">
          <FormattedMessage id="invite.complete.credentialsIntro" />
        </p>

        {/* Email */}
        <div>
          <label className="text-xs text-[var(--text-muted)] uppercase tracking-wide">
            <FormattedMessage id="invite.complete.email" />
          </label>
          <div className="mt-0.5 px-3 py-2 rounded bg-[var(--bg-2)] border border-[var(--border)] text-sm text-[var(--text)] font-mono">
            {email}
          </div>
        </div>

        {/* Temp password */}
        <div>
          <label className="text-xs text-[var(--text-muted)] uppercase tracking-wide">
            <FormattedMessage id="invite.complete.tempPassword" />
          </label>
          <div className="mt-0.5 flex items-center gap-2">
            <div className="flex-1 px-3 py-2 rounded bg-[var(--bg-2)] border border-[var(--border)] text-sm font-mono text-[var(--text)]">
              {showPassword ? tempPassword : "••••••••••••••••"}
            </div>
            <button
              onClick={() => setShowPassword(!showPassword)}
              className="p-2 text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <button
              onClick={handleCopy}
              className="p-2 text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
            >
              {copied ? <Check size={16} className="text-[var(--green)]" /> : <Copy size={16} />}
            </button>
          </div>
        </div>
      </div>

      <div className="p-3 rounded-[var(--radius)] bg-[var(--amber)]/10 border border-[var(--amber)]/20">
        <p className="text-xs text-[var(--amber)]">
          <FormattedMessage id="invite.complete.securityNote" />
        </p>
      </div>

      <button
        onClick={handleLogin}
        className="w-full px-6 py-3 bg-[var(--amber)] hover:bg-[var(--amber-light)] text-black font-semibold rounded-[var(--radius)] transition-colors cursor-pointer"
      >
        <FormattedMessage id="invite.complete.login" />
      </button>
    </div>
  );
}
