import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

interface NewTerritoryModalProps {
  onSubmit: (number: string, name: string) => void;
  onCancel: () => void;
}

export function NewTerritoryModal({ onSubmit, onCancel }: NewTerritoryModalProps) {
  const intl = useIntl();
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");

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
            className="px-5 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-3)] transition-colors"
          >
            <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
          </button>
          <button
            onClick={() => number.trim() && name.trim() && onSubmit(number.trim(), name.trim())}
            disabled={!number.trim() || !name.trim()}
            className="px-5 py-2 text-sm rounded-lg bg-[var(--amber)] text-black font-semibold hover:bg-[var(--amber-light)] transition-colors disabled:opacity-40"
          >
            <FormattedMessage id="territories.new.create" defaultMessage="Create & Draw" />
          </button>
        </div>
      </div>
    </div>
  );
}
