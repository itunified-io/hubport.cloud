import { FormattedMessage } from "react-intl";

export function LoadingSpinner() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--glass-2)] border-t-[var(--amber)]" />
      <span className="text-sm text-[var(--text-muted)]">
        <FormattedMessage id="common.loading" />
      </span>
    </div>
  );
}
