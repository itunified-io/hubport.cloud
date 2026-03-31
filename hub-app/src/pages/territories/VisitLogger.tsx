/**
 * Quick-entry visit logger for an address.
 * Outcome picker (6 options with icons), notes, date picker.
 */
import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  UserCheck, Home, Ban, Truck, Mail, Phone,
  CalendarDays, MessageSquare, Send,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { logVisit, type VisitOutcome, type AddressVisit } from "@/lib/territory-api";

const OUTCOME_OPTIONS: { value: VisitOutcome; icon: React.ElementType; color: string }[] = [
  { value: "contacted", icon: UserCheck, color: "text-[var(--green)] border-[var(--green)] bg-[#22c55e14]" },
  { value: "not_at_home", icon: Home, color: "text-[var(--amber)] border-[var(--amber)] bg-[#d9770614]" },
  { value: "do_not_call", icon: Ban, color: "text-[var(--red)] border-[var(--red)] bg-[#ef444414]" },
  { value: "moved", icon: Truck, color: "text-[var(--text-muted)] border-[var(--border-2)] bg-[var(--glass)]" },
  { value: "letter_sent", icon: Mail, color: "text-[var(--blue)] border-[var(--blue)] bg-[#3b82f614]" },
  { value: "phone_attempted", icon: Phone, color: "text-[var(--blue)] border-[var(--blue)] bg-[#3b82f614]" },
];

interface VisitLoggerProps {
  territoryId: string;
  addressId: string;
  onLogged?: (visit: AddressVisit) => void;
  onCancel?: () => void;
}

export function VisitLogger({
  territoryId,
  addressId,
  onLogged,
  onCancel,
}: VisitLoggerProps) {
  const { user } = useAuth();
  const intl = useIntl();
  const token = user?.access_token ?? "";

  const [outcome, setOutcome] = useState<VisitOutcome | null>(null);
  const [notes, setNotes] = useState("");
  const [visitDate, setVisitDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outcome) return;

    setSaving(true);
    setError(null);

    try {
      const visit = await logVisit(
        territoryId,
        addressId,
        {
          outcome,
          notes: notes.trim() || undefined,
          visitDate: new Date(visitDate).toISOString(),
        },
        token,
      );
      onLogged?.(visit);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({ id: "common.error", defaultMessage: "An error occurred" }),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 space-y-4 bg-[var(--bg-1)] rounded-[var(--radius)] border border-[var(--border)]">
      <h3 className="text-sm font-semibold text-[var(--text)]">
        <FormattedMessage id="territories.logVisit" defaultMessage="Log Visit" />
      </h3>

      {/* Outcome picker */}
      <div className="grid grid-cols-3 gap-2">
        {OUTCOME_OPTIONS.map(({ value, icon: Icon, color }) => (
          <button
            key={value}
            type="button"
            onClick={() => setOutcome(value)}
            className={`flex flex-col items-center gap-1.5 p-3 rounded-[var(--radius-sm)] border transition-all cursor-pointer ${
              outcome === value
                ? color
                : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--border-2)] hover:bg-[var(--glass)]"
            }`}
          >
            <Icon size={20} />
            <span className="text-[10px] font-medium leading-tight text-center">
              {value.replace(/_/g, " ")}
            </span>
          </button>
        ))}
      </div>

      {/* Date */}
      <div>
        <label className="flex items-center gap-1 text-xs font-medium text-[var(--text-muted)] mb-1">
          <CalendarDays size={12} />
          <FormattedMessage id="territories.visitDate" defaultMessage="Date" />
        </label>
        <input
          type="date"
          value={visitDate}
          onChange={(e) => setVisitDate(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
        />
      </div>

      {/* Notes */}
      <div>
        <label className="flex items-center gap-1 text-xs font-medium text-[var(--text-muted)] mb-1">
          <MessageSquare size={12} />
          <FormattedMessage id="territories.visitNotes" defaultMessage="Notes (optional)" />
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)] resize-none"
          placeholder={intl.formatMessage({
            id: "territories.visitNotesPlaceholder",
            defaultMessage: "Brief notes about the visit...",
          })}
        />
      </div>

      {error && (
        <div className="px-3 py-2 rounded-[var(--radius-sm)] bg-[#ef444414] text-xs text-[var(--red)]">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2 text-sm text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
          </button>
        )}
        <button
          type="submit"
          disabled={saving || !outcome}
          className="flex-1 py-2 text-sm font-semibold text-black bg-[var(--amber)] rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {saving ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" />
          ) : (
            <Send size={14} />
          )}
          <FormattedMessage id="territories.logVisitSubmit" defaultMessage="Log" />
        </button>
      </div>
    </form>
  );
}
