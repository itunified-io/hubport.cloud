import { useCallback, useRef, useEffect, useState } from "react";
import type { SnapResult, SnapTarget } from "./SnapEngine";
import { snapVertex } from "./SnapEngine";

interface VertexHandleProps {
  /** Vertex index within the polygon ring */
  index: number;
  /** Current position [lng, lat] */
  position: [number, number];
  /** Available snap targets */
  snapTargets: SnapTarget[];
  /** Snap tolerance in coordinate units */
  snapTolerance: number;
  /** Whether Alt/Option is held (disables snapping) */
  altPressed: boolean;
  /** Called when vertex is moved */
  onMove: (index: number, position: [number, number]) => void;
  /** Called when drag ends (for undo stack) */
  onDragEnd: (
    index: number,
    before: [number, number],
    after: [number, number],
  ) => void;
  /** Called on right-click for context menu */
  onContextMenu: (index: number, event: React.MouseEvent) => void;
  /** Whether this vertex is currently selected */
  selected?: boolean;
}

/**
 * Draggable circle handle for polygon vertices.
 * Integrates with SnapEngine for magnetic snapping during drag.
 */
export function VertexHandle({
  index,
  position,
  snapTargets,
  snapTolerance,
  altPressed,
  onMove,
  onDragEnd,
  onContextMenu,
  selected = false,
}: VertexHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [snapInfo, setSnapInfo] = useState<SnapResult | null>(null);
  const dragStartRef = useRef<[number, number] | null>(null);
  const containerRef = useRef<SVGCircleElement>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setIsDragging(true);
      dragStartRef.current = [position[0], position[1]];

      const el = e.currentTarget as Element;
      el.setPointerCapture(e.pointerId);
    },
    [position],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;

      // Convert screen delta to coordinate delta (simplified — real implementation
      // would use map.unproject() to convert pixel coordinates)
      const svg = containerRef.current?.ownerSVGElement;
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      const svgWidth = rect.width;
      const svgHeight = rect.height;

      // Use viewBox to calculate coordinate position
      const viewBox = svg.viewBox.baseVal;
      const x =
        ((e.clientX - rect.left) / svgWidth) * viewBox.width + viewBox.x;
      const y =
        ((e.clientY - rect.top) / svgHeight) * viewBox.height + viewBox.y;

      const dragPos: [number, number] = [x, y];

      if (altPressed) {
        // Alt held: no snapping
        onMove(index, dragPos);
        setSnapInfo(null);
      } else {
        const result = snapVertex(dragPos, snapTargets, snapTolerance);
        onMove(index, result.position);
        setSnapInfo(result);
      }
    },
    [isDragging, altPressed, index, onMove, snapTargets, snapTolerance],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      setIsDragging(false);
      setSnapInfo(null);

      const el = e.currentTarget as Element;
      el.releasePointerCapture(e.pointerId);

      if (dragStartRef.current) {
        onDragEnd(index, dragStartRef.current, position);
        dragStartRef.current = null;
      }
    },
    [isDragging, index, position, onDragEnd],
  );

  const handleContextMenuEvent = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(index, e);
    },
    [index, onContextMenu],
  );

  // Clean up on unmount
  useEffect(() => {
    return () => {
      setIsDragging(false);
    };
  }, []);

  const radius = selected ? 7 : 5;
  const strokeColor = isDragging
    ? "var(--amber)"
    : selected
      ? "var(--amber-light)"
      : "var(--text)";

  return (
    <>
      <circle
        ref={containerRef}
        cx={position[0]}
        cy={position[1]}
        r={radius}
        fill={isDragging ? "var(--amber)" : "var(--bg-1)"}
        stroke={strokeColor}
        strokeWidth={2}
        style={{
          cursor: isDragging ? "grabbing" : "grab",
          touchAction: "none",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={handleContextMenuEvent}
      />
      {/* Snap indicator label */}
      {isDragging && snapInfo?.label && (
        <text
          x={position[0]}
          y={position[1] - 12}
          textAnchor="middle"
          fill="var(--amber)"
          fontSize={10}
          fontWeight="bold"
        >
          {snapInfo.label}
        </text>
      )}
    </>
  );
}
