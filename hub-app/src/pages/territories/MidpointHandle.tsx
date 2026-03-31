import { useCallback } from "react";

interface MidpointHandleProps {
  /** Index of the edge start vertex */
  edgeIndex: number;
  /** Midpoint position [lng, lat] */
  position: [number, number];
  /** Called when the midpoint is clicked to insert a new vertex */
  onInsert: (edgeIndex: number, position: [number, number]) => void;
}

/**
 * Smaller circle on edge midpoints.
 * Click converts to a full vertex (inserts between edgeIndex and edgeIndex+1).
 */
export function MidpointHandle({
  edgeIndex,
  position,
  onInsert,
}: MidpointHandleProps) {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onInsert(edgeIndex, position);
    },
    [edgeIndex, position, onInsert],
  );

  return (
    <circle
      cx={position[0]}
      cy={position[1]}
      r={3.5}
      fill="var(--bg-2)"
      stroke="var(--text-muted)"
      strokeWidth={1.5}
      strokeDasharray="2 2"
      style={{ cursor: "crosshair" }}
      onClick={handleClick}
    />
  );
}
