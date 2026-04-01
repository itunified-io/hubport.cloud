import { useState } from "react";
import { useAuth } from "@/auth/useAuth";
import { logVisit, type VisitOutcome } from "../../lib/territory-api";

interface QuickActionBarProps {
  territoryId: string;
  addressId: string;
  onLogged?: (outcome: VisitOutcome) => void;
  compact?: boolean;
}

const OUTCOMES: {
  label: string;
  outcome: VisitOutcome;
  icon: string;
  color: string;
  bgColor: string;
}[] = [
  { label: "Contacted", outcome: "contacted", icon: "\u2713", color: "#16a34a", bgColor: "#dcfce7" },
  { label: "Not Home", outcome: "not_at_home", icon: "\ud83c\udfe0", color: "#d97706", bgColor: "#fef3c7" },
  { label: "DNC", outcome: "do_not_call", icon: "\ud83d\udeab", color: "#dc2626", bgColor: "#fee2e2" },
  { label: "Letter", outcome: "letter_sent", icon: "\u2709\ufe0f", color: "#2563eb", bgColor: "#dbeafe" },
  { label: "Moved", outcome: "moved", icon: "\u2192", color: "#6b7280", bgColor: "#f3f4f6" },
  { label: "Phone", outcome: "phone_attempted", icon: "\ud83d\udcde", color: "#2563eb", bgColor: "#dbeafe" },
];

/**
 * One-tap visit outcome buttons. Fires immediately on tap — no confirmation.
 */
export function QuickActionBar({
  territoryId,
  addressId,
  onLogged,
  compact = false,
}: QuickActionBarProps) {
  const { user } = useAuth();
  const token = user?.access_token ?? "";
  const [loading, setLoading] = useState<VisitOutcome | null>(null);

  async function handleTap(outcome: VisitOutcome) {
    if (loading || !token) return;
    setLoading(outcome);
    try {
      await logVisit(territoryId, addressId, { outcome }, token);
      onLogged?.(outcome);
    } catch (err) {
      console.error("Quick action failed:", err);
    } finally {
      setLoading(null);
    }
  }

  const items = compact ? OUTCOMES.slice(0, 3) : OUTCOMES;

  return (
    <div style={{
      display: "flex",
      gap: compact ? "4px" : "8px",
      flexWrap: "wrap",
      justifyContent: "center",
    }}>
      {items.map((o) => (
        <button
          key={o.outcome}
          onClick={() => handleTap(o.outcome)}
          disabled={loading !== null}
          style={{
            display: "flex",
            flexDirection: compact ? "row" : "column",
            alignItems: "center",
            gap: "2px",
            padding: compact ? "4px 8px" : "8px 12px",
            border: "1px solid transparent",
            borderRadius: "8px",
            background: loading === o.outcome ? o.color : o.bgColor,
            color: loading === o.outcome ? "white" : o.color,
            cursor: loading ? "wait" : "pointer",
            fontSize: compact ? "11px" : "12px",
            fontWeight: 600,
            transition: "all 0.15s ease",
            opacity: loading && loading !== o.outcome ? 0.5 : 1,
            minWidth: compact ? "auto" : "60px",
          }}
        >
          <span style={{ fontSize: compact ? "14px" : "18px" }}>{o.icon}</span>
          {!compact && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}
