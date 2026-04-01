import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Loader2 } from "lucide-react";
import type { TerritorySuggestion } from "@/lib/territory-api";

interface CreateTerritoryModalProps {
  suggestion: TerritorySuggestion;
  onSubmit: (number: string, name: string) => void;
  onCancel: () => void;
  submitting?: boolean;
}

export function CreateTerritoryModal({
  suggestion,
  onSubmit,
  onCancel,
  submitting,
}: CreateTerritoryModalProps) {
  const intl = useIntl();
  const [number, setNumber] = useState(suggestion.suggestedNumber);
  const [name, setName] = useState(suggestion.city ?? "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[var(--bg-2)] border border-[var(--border)] rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <h3 className="text-lg font-semibold mb-4">
          <FormattedMessage id="territories.new.title" defaultMessage="New Territory" />
        </h3>

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">
              <FormattedMessage id="territories.new.number" defaultMessage="Number" />
            </label>
            <input
              type="text"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder={intl.formatMessage({ id: "territories.new.numberPlaceholder", defaultMessage: "e.g. 101" })}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-1)] border border-[var(--border)] text-sm"
              autoFocus
            />
            {suggestion.existingInGroup.length > 0 && (
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                {suggestion.suggestedPrefix}xx — {suggestion.city ?? "?"} ({suggestion.existingInGroup.join(", ")} exist)
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">
              <FormattedMessage id="territories.new.name" defaultMessage="Name" />
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={intl.formatMessage({ id: "territories.new.namePlaceholder", defaultMessage: "e.g. Penzberg Ost" })}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-1)] border border-[var(--border)] text-sm"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-5 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-3)] transition-colors"
          >
            <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
          </button>
          <button
            onClick={() => number.trim() && name.trim() && onSubmit(number.trim(), name.trim())}
            disabled={!number.trim() || !name.trim() || submitting}
            className="px-5 py-2 text-sm rounded-lg bg-[var(--amber)] text-black font-semibold hover:bg-[var(--amber-light)] transition-colors disabled:opacity-40 flex items-center gap-2"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            <FormattedMessage id="territories.new.create" defaultMessage="Create" />
          </button>
        </div>
      </div>
    </div>
  );
}
