/**
 * CompletionStep — Final step of invite wizard.
 * Shows success message, auto-redirects to / after 3 seconds.
 */
import { useEffect, type ReactNode } from "react";
import { FormattedMessage } from "react-intl";

export function CompletionStep(): ReactNode {
  useEffect(() => {
    const timer = setTimeout(() => {
      window.location.href = "/";
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="text-center space-y-4">
      <div className="text-5xl">✅</div>
      <h2 className="text-xl font-bold text-[var(--text)]">
        <FormattedMessage id="invite.complete.title" />
      </h2>
      <p className="text-[var(--text-muted)] text-sm">
        <FormattedMessage id="invite.complete.message" />
      </p>
      <button
        onClick={() => { window.location.href = "/"; }}
        className="px-6 py-2 bg-[var(--amber)] hover:bg-[var(--amber-light)] text-black font-semibold rounded-[var(--radius)] transition-colors cursor-pointer"
      >
        <FormattedMessage id="invite.complete.redirect" />
      </button>
    </div>
  );
}
