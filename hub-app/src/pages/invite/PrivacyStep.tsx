/**
 * PrivacyStep — Step 3 of invite wizard.
 * Three visibility dropdowns + terms acceptance checkbox.
 * Calls POST /onboarding/accept-privacy.
 */
import { useState, type ReactNode } from "react";
import { useIntl, FormattedMessage } from "react-intl";
import { getApiUrl } from "../../lib/config";

type Visibility = "everyone" | "elders_only" | "nobody";

interface Props {
  token: string;
  onComplete: () => void;
  onSessionExpired: () => void;
}

const TERMS_VERSION = "2026-03-22";

export function PrivacyStep({ token, onComplete, onSessionExpired }: Props): ReactNode {
  const intl = useIntl();
  const [contactVisibility, setContactVisibility] = useState<Visibility>("everyone");
  const [addressVisibility, setAddressVisibility] = useState<Visibility>("elders_only");
  const [notesVisibility, setNotesVisibility] = useState<Visibility>("elders_only");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!termsAccepted) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getApiUrl()}/onboarding/accept-privacy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          contactVisibility,
          addressVisibility,
          notesVisibility,
          termsAccepted,
          termsVersion: TERMS_VERSION,
        }),
      });
      if (res.status === 401) { onSessionExpired(); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || intl.formatMessage({ id: "invite.error.generic" }));
      }
      onComplete();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const selectClass =
    "w-full px-3 py-2 bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)] transition-colors";

  const visibilityOptions: { value: Visibility; labelId: string }[] = [
    { value: "everyone", labelId: "invite.privacy.visibility.everyone" },
    { value: "elders_only", labelId: "invite.privacy.visibility.elders_only" },
    { value: "nobody", labelId: "invite.privacy.visibility.nobody" },
  ];

  return (
    <>
      <h2 className="text-lg font-bold text-[var(--text)] mb-1">
        <FormattedMessage id="invite.privacy.title" />
      </h2>
      <p className="text-[var(--text-muted)] text-sm mb-4">
        <FormattedMessage id="invite.privacy.subtitle" />
      </p>

      {error && (
        <div className="mb-4 p-3 bg-[var(--red)]/10 border border-[var(--red)]/30 rounded-[var(--radius)] text-[var(--red)] text-sm">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-[var(--text-muted)] mb-1">
            <FormattedMessage id="invite.privacy.contactVisibility" />
          </label>
          <select
            value={contactVisibility}
            onChange={(e) => setContactVisibility(e.target.value as Visibility)}
            className={selectClass}
            disabled={loading}
          >
            {visibilityOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {intl.formatMessage({ id: opt.labelId })}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-[var(--text-muted)] mb-1">
            <FormattedMessage id="invite.privacy.addressVisibility" />
          </label>
          <select
            value={addressVisibility}
            onChange={(e) => setAddressVisibility(e.target.value as Visibility)}
            className={selectClass}
            disabled={loading}
          >
            {visibilityOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {intl.formatMessage({ id: opt.labelId })}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-[var(--text-muted)] mb-1">
            <FormattedMessage id="invite.privacy.notesVisibility" />
          </label>
          <select
            value={notesVisibility}
            onChange={(e) => setNotesVisibility(e.target.value as Visibility)}
            className={selectClass}
            disabled={loading}
          >
            {visibilityOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {intl.formatMessage({ id: opt.labelId })}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={termsAccepted}
            onChange={(e) => setTermsAccepted(e.target.checked)}
            disabled={loading}
            className="mt-1 accent-[var(--amber)]"
          />
          <span className="text-sm text-[var(--text-muted)]">
            <FormattedMessage id="invite.privacy.terms" />
          </span>
        </label>

        <button
          onClick={handleSubmit}
          disabled={!termsAccepted || loading}
          className="w-full py-2 bg-[var(--amber)] hover:bg-[var(--amber-light)] disabled:bg-[var(--border)] disabled:text-[var(--text-muted)] text-black font-semibold rounded-[var(--radius)] transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          {loading ? "..." : intl.formatMessage({ id: "invite.privacy.submit" })}
        </button>
      </div>
    </>
  );
}
