/**
 * Chronological visit history list for an address (newest first).
 * Each entry: date, publisher, outcome icon, notes.
 */
import { useState, useEffect } from "react";
import { FormattedMessage } from "react-intl";
import {
  UserCheck, Home, Ban, Truck, Mail, Phone,
  ClipboardList,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { listVisits, type AddressVisit, type VisitOutcome } from "@/lib/territory-api";

const OUTCOME_META: Record<VisitOutcome, { icon: React.ElementType; color: string; label: string }> = {
  contacted: { icon: UserCheck, color: "text-[var(--green)]", label: "Contacted" },
  not_at_home: { icon: Home, color: "text-[var(--amber)]", label: "Not at home" },
  do_not_call: { icon: Ban, color: "text-[var(--red)]", label: "Do not call" },
  moved: { icon: Truck, color: "text-[var(--text-muted)]", label: "Moved" },
  letter_sent: { icon: Mail, color: "text-[var(--blue)]", label: "Letter sent" },
  phone_attempted: { icon: Phone, color: "text-[var(--blue)]", label: "Phone attempted" },
};

interface VisitHistoryProps {
  territoryId: string;
  addressId: string;
  refreshKey?: number;
}

export function VisitHistory({ territoryId, addressId, refreshKey }: VisitHistoryProps) {
  const { user } = useAuth();
  const token = user?.access_token ?? "";
  const [visits, setVisits] = useState<AddressVisit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || !addressId) return;
    setLoading(true);
    listVisits(territoryId, addressId, token)
      .then(setVisits)
      .catch(() => setVisits([]))
      .finally(() => setLoading(false));
  }, [token, territoryId, addressId, refreshKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--glass-2)] border-t-[var(--amber)]" />
      </div>
    );
  }

  if (visits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-[var(--text-muted)]">
        <ClipboardList size={24} strokeWidth={1.2} className="mb-2" />
        <p className="text-xs">
          <FormattedMessage id="territories.noVisits" defaultMessage="No visits recorded" />
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider px-1 mb-2">
        <FormattedMessage id="territories.visitHistory" defaultMessage="Visit History" />
        <span className="ml-1 font-normal">({visits.length})</span>
      </h3>

      <ul className="space-y-1">
        {visits.map((visit) => {
          const meta = OUTCOME_META[visit.outcome] ?? OUTCOME_META.contacted;
          const Icon = meta.icon;

          return (
            <li
              key={visit.visitId}
              className="flex items-start gap-3 px-3 py-2 rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors"
            >
              {/* Outcome icon */}
              <div className={`mt-0.5 ${meta.color}`}>
                <Icon size={16} />
              </div>

              {/* Details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--text)]">
                    {meta.label}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {new Date(visit.visitDate).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>

                {/* Publisher name */}
                {visit.memberName && (
                  <p className="text-xs text-[var(--text-muted)]">
                    {visit.memberName}
                  </p>
                )}

                {/* Notes */}
                {visit.notes && (
                  <p className="text-xs text-[var(--text-muted)] mt-0.5 italic">
                    {visit.notes}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
