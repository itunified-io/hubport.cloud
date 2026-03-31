import { useCallback, useState } from "react";
import { FormattedMessage } from "react-intl";
import { Check, X } from "lucide-react";
import { ScissorsAffordance } from "./ScissorsAffordance";
import type { Territory } from "../../hooks/useTerritoryEditor";

interface SplitFlowProps {
  /** Territory being split */
  territory: Territory;
  /** Called when split is confirmed */
  onComplete: () => void;
  /** Called to cancel split */
  onCancel: () => void;
}

type SplitPhase = "draw_cut" | "confirm";

/**
 * Territory split flow:
 * 1. draw_cut: User draws a line across the territory to define the cut
 * 2. confirm: Preview the two resulting territories, confirm or cancel
 */
export function SplitFlow({
  territory,
  onComplete,
  onCancel,
}: SplitFlowProps) {
  const [phase, setPhase] = useState<SplitPhase>("draw_cut");
  const [cutLine, setCutLine] = useState<[number, number][]>([]);
  const [scissorsPos, setScissorsPos] = useState({ x: 0, y: 0 });
  const [showScissors, setShowScissors] = useState(false);

  const handleMapClick = useCallback(
    (e: React.MouseEvent) => {
      if (phase !== "draw_cut") return;

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const lng = ((e.clientX - rect.left) / rect.width) * 360 - 180;
      const lat = 90 - ((e.clientY - rect.top) / rect.height) * 180;

      setCutLine((prev) => [...prev, [lng, lat]]);
    },
    [phase],
  );

  const handleMapDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (phase !== "draw_cut" || cutLine.length < 2) return;
      e.preventDefault();
      e.stopPropagation();
      setPhase("confirm");
    },
    [phase, cutLine],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (phase !== "draw_cut") return;
      setScissorsPos({ x: e.clientX, y: e.clientY });
      setShowScissors(true);
    },
    [phase],
  );

  const handleConfirm = useCallback(() => {
    // In a full implementation, this would:
    // 1. Compute the intersection of cut line with territory boundary
    // 2. Split the polygon into two parts
    // 3. Save both new territories via API
    onComplete();
  }, [onComplete]);

  return (
    <div className="absolute inset-0 z-30">
      {/* Cut line drawing surface */}
      <div
        className="absolute inset-0 cursor-crosshair"
        onClick={handleMapClick}
        onDoubleClick={handleMapDoubleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setShowScissors(false)}
        style={{ touchAction: "none" }}
      />

      {/* Scissors affordance on hover */}
      <ScissorsAffordance position={scissorsPos} visible={showScissors} />

      {/* Phase indicator */}
      <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-40 bg-[var(--bg-1)] border border-[var(--border-2)] rounded-[var(--radius-sm)] px-4 py-2 text-xs text-[var(--text-muted)]">
        {phase === "draw_cut" ? (
          <FormattedMessage
            id="territories.splitDrawCut"
            defaultMessage="Click to draw cut line across territory '{name}'. Double-click to finish."
            values={{ name: territory.name }}
          />
        ) : (
          <span className="flex items-center gap-3">
            <FormattedMessage
              id="territories.splitConfirm"
              defaultMessage="Confirm split of '{name}'?"
              values={{ name: territory.name }}
            />
            <button
              onClick={handleConfirm}
              className="flex items-center gap-1 px-2 py-1 bg-[var(--green)] text-black text-xs font-medium rounded-[var(--radius-sm)] hover:opacity-90 cursor-pointer"
            >
              <Check size={12} />
              <FormattedMessage
                id="territories.confirm"
                defaultMessage="Confirm"
              />
            </button>
            <button
              onClick={onCancel}
              className="flex items-center gap-1 px-2 py-1 bg-[var(--bg-2)] text-[var(--text-muted)] text-xs rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer"
            >
              <X size={12} />
              <FormattedMessage
                id="territories.cancel"
                defaultMessage="Cancel"
              />
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
