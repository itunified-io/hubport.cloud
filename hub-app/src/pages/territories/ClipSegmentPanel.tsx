/**
 * ClipSegmentPanel — Floating panel showing available clip targets
 * for the selected polygon segment.
 *
 * Appears when the user has selected two vertices in clip mode.
 * Shows nearby roads, neighbors, and boundaries that the segment
 * can be clipped to. Also offers a "Straighten" option.
 */

import { Crop, Route, Map, Hexagon, Minus, X } from "lucide-react";
import type { ClipCandidate } from "../../hooks/useClipSegment";

interface ClipSegmentPanelProps {
  candidates: ClipCandidate[];
  onSelectCandidate: (candidate: ClipCandidate) => void;
  onStraighten: () => void;
  onCancel: () => void;
}

const TYPE_ICONS = {
  road: Route,
  neighbor: Hexagon,
  boundary: Map,
} as const;

const TYPE_COLORS = {
  road: "text-blue-400",
  neighbor: "text-[var(--amber)]",
  boundary: "text-green-400",
} as const;

export function ClipSegmentPanel({
  candidates,
  onSelectCandidate,
  onStraighten,
  onCancel,
}: ClipSegmentPanelProps) {
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 bg-[var(--bg-1)] border border-[var(--border-2)] rounded-[var(--radius)] shadow-lg p-3 min-w-[260px] max-w-[340px]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text)]">
          <Crop size={14} className="text-[var(--amber)]" />
          Clip Segment
        </div>
        <button
          onClick={onCancel}
          className="p-0.5 rounded hover:bg-[var(--glass)] transition-colors cursor-pointer"
        >
          <X size={14} className="text-[var(--text-muted)]" />
        </button>
      </div>

      {candidates.length === 0 ? (
        <div className="text-xs text-[var(--text-muted)] py-2 text-center">
          No roads or neighbors found nearby
        </div>
      ) : (
        <div className="space-y-1">
          {candidates.map((c, i) => {
            const Icon = TYPE_ICONS[c.type] ?? Route;
            const color = TYPE_COLORS[c.type] ?? "text-[var(--text-muted)]";
            return (
              <button
                key={`${c.type}-${c.label}-${i}`}
                onClick={() => onSelectCandidate(c)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer text-left"
              >
                <Icon size={14} className={color} />
                <span className="flex-1 text-[var(--text)] truncate">
                  Clip to {c.label}
                </span>
                <span className="text-[10px] text-[var(--text-muted)]">
                  {(c.score * 1000).toFixed(0)}m
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-2 pt-2 border-t border-[var(--border)]">
        <button
          onClick={onStraighten}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer text-left"
        >
          <Minus size={14} className="text-[var(--text-muted)]" />
          <span className="text-[var(--text)]">Straighten segment</span>
        </button>
      </div>
    </div>
  );
}
