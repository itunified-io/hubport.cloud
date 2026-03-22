/**
 * UserInfoStep — Step 1 of invite wizard.
 * Collects firstName / lastName; email is read-only from publisher data.
 */
import { useState, type ReactNode } from "react";
import { useIntl, FormattedMessage } from "react-intl";
import { getApiUrl } from "../../lib/config";

interface Props {
  token: string;
  email: string;
  initialFirstName?: string;
  initialLastName?: string;
  onComplete: (newToken: string) => void;
  onSessionExpired: () => void;
}

export function UserInfoStep({
  token,
  email,
  initialFirstName = "",
  initialLastName = "",
  onComplete,
  onSessionExpired,
}: Props): ReactNode {
  const intl = useIntl();
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!firstName.trim() || !lastName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getApiUrl()}/onboarding/user-info`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim() }),
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || intl.formatMessage({ id: "invite.error.generic" }));
      }
      const data = await res.json();
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
        <FormattedMessage id="invite.userInfo.title" />
      </h2>
      <p className="text-[var(--text-muted)] text-sm mb-4">
        <FormattedMessage id="invite.userInfo.subtitle" />
      </p>

      {error && (
        <div className="mb-4 p-3 bg-[var(--red)]/10 border border-[var(--red)]/30 rounded-[var(--radius)] text-[var(--red)] text-sm">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-[var(--text-muted)] mb-1">
            <FormattedMessage id="invite.userInfo.firstName" />
          </label>
          <input
            type="text"
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className={inputClass}
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-sm text-[var(--text-muted)] mb-1">
            <FormattedMessage id="invite.userInfo.lastName" />
          </label>
          <input
            type="text"
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className={inputClass}
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-sm text-[var(--text-muted)] mb-1">
            <FormattedMessage id="invite.userInfo.email" />
          </label>
          <input
            type="email"
            value={email}
            readOnly
            className={`${inputClass} opacity-60 cursor-not-allowed`}
            tabIndex={-1}
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={!firstName.trim() || !lastName.trim() || loading}
          className="w-full py-2 bg-[var(--amber)] hover:bg-[var(--amber-light)] disabled:bg-[var(--border)] disabled:text-[var(--text-muted)] text-black font-semibold rounded-[var(--radius)] transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          {loading ? "..." : intl.formatMessage({ id: "invite.userInfo.submit" })}
        </button>
      </div>
    </>
  );
}
