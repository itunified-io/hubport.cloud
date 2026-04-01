import { useState } from "react";
import { FormattedMessage } from "react-intl";
import type { AutoFixResult } from "@/lib/territory-api";

interface AutoFixPreviewProps {
  result: AutoFixResult;
  onAccept: () => Promise<void> | void;
  onCancel: () => void;
}

export function AutoFixPreview({ result, onAccept, onCancel }: AutoFixPreviewProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    setSaving(true);
    setError(null);
    try {
      await onAccept();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
      <div className="bg-[var(--bg-2)] border border-[var(--border)] rounded-xl p-6 max-w-lg w-full mx-4 shadow-2xl">
        <h3 className="text-lg font-semibold mb-4">
          <FormattedMessage id="territories.autoFix.title" defaultMessage="Boundary will be adjusted" />
        </h3>

        <ul className="space-y-2 mb-6">
          {result.applied.map((fix, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-[var(--text-muted)]">
              <span className="text-amber-400 mt-0.5">•</span>
              {fix}
            </li>
          ))}
        </ul>

        {result.overlaps.length > 0 && (
          <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-xs text-red-400 font-medium mb-1">
              <FormattedMessage id="territories.autoFix.remainingOverlaps" defaultMessage="Remaining overlaps (informational):" />
            </p>
            {result.overlaps.map((o) => (
              <p key={o.territoryId} className="text-xs text-[var(--text-muted)]">
                #{o.number} {o.name} — {Math.round(o.overlapAreaM2)} m²
              </p>
            ))}
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-5 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-3)] transition-colors cursor-pointer disabled:opacity-50"
          >
            <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
          </button>
          <button
            onClick={handleAccept}
            disabled={saving}
            className="px-5 py-2 text-sm rounded-lg bg-green-600 text-white font-semibold hover:bg-green-500 transition-colors cursor-pointer disabled:opacity-50"
          >
            {saving ? "Saving..." : <FormattedMessage id="territories.autoFix.accept" defaultMessage="Accept & Save" />}
          </button>
        </div>
      </div>
    </div>
  );
}
