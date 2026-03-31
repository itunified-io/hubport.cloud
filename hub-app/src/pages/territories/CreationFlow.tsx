import { useCallback, useEffect, useState } from "react";
import { FormattedMessage } from "react-intl";
import { MousePointer, Spline } from "lucide-react";

interface CreationFlowProps {
  /** Called with the completed polygon coordinates */
  onComplete: (coords: [number, number][]) => void;
  /** Called to cancel creation */
  onCancel: () => void;
}

type DrawMode = "click" | "freehand";

/**
 * Territory creation flow supporting:
 * - Click-to-place: click to add vertices, double-click to close
 * - Freehand lasso: Shift+drag to draw freehand, auto-closes on release
 */
export function CreationFlow({ onComplete, onCancel }: CreationFlowProps) {
  const [drawMode, setDrawMode] = useState<DrawMode>("click");
  const [vertices, setVertices] = useState<[number, number][]>([]);
  const [isDrawing, setIsDrawing] = useState(false);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCancel();
      }
      // Enter to complete (need at least 3 vertices)
      if (e.key === "Enter" && vertices.length >= 3) {
        finalize();
      }
      // Backspace to remove last vertex
      if (e.key === "Backspace" && vertices.length > 0) {
        setVertices((prev) => prev.slice(0, -1));
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const finalize = useCallback(() => {
    if (vertices.length < 3) return;

    // Close the ring
    const closed: [number, number][] = [
      ...vertices,
      [vertices[0]![0], vertices[0]![1]],
    ];
    onComplete(closed);
  }, [vertices, onComplete]);

  const handleMapClick = useCallback(
    (e: React.MouseEvent) => {
      if (drawMode !== "click") return;

      // Get click position relative to container (simplified coordinates)
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // In a real implementation, these would be map.unproject(x, y)
      // For now, use normalized coordinates as placeholder
      const lng = (x / rect.width) * 360 - 180;
      const lat = 90 - (y / rect.height) * 180;

      setVertices((prev) => [...prev, [lng, lat]]);
    },
    [drawMode],
  );

  const handleMapDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (drawMode !== "click") return;
      e.preventDefault();
      e.stopPropagation();
      finalize();
    },
    [drawMode, finalize],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Shift+drag starts freehand mode
      if (e.shiftKey) {
        setDrawMode("freehand");
        setIsDrawing(true);
        setVertices([]);

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const lng = ((e.clientX - rect.left) / rect.width) * 360 - 180;
        const lat = 90 - ((e.clientY - rect.top) / rect.height) * 180;
        setVertices([[lng, lat]]);

        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawing || drawMode !== "freehand") return;

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const lng = ((e.clientX - rect.left) / rect.width) * 360 - 180;
      const lat = 90 - ((e.clientY - rect.top) / rect.height) * 180;

      setVertices((prev) => [...prev, [lng, lat]]);
    },
    [isDrawing, drawMode],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawing || drawMode !== "freehand") return;
      setIsDrawing(false);

      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

      // Auto-close if enough vertices
      if (vertices.length >= 3) {
        finalize();
      } else {
        setVertices([]);
        setDrawMode("click");
      }
    },
    [isDrawing, drawMode, vertices, finalize],
  );

  return (
    <div className="absolute inset-0 z-30">
      {/* Drawing surface */}
      <div
        className="absolute inset-0 cursor-crosshair"
        onClick={handleMapClick}
        onDoubleClick={handleMapDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{ touchAction: "none" }}
      />

      {/* Drawing mode indicator */}
      <div className="absolute top-3 left-3 z-40 flex items-center gap-2 bg-[var(--bg-1)] border border-[var(--border-2)] rounded-[var(--radius-sm)] px-3 py-2">
        <button
          onClick={() => setDrawMode("click")}
          className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
            drawMode === "click"
              ? "bg-[var(--amber)] text-black"
              : "text-[var(--text-muted)] hover:bg-[var(--glass)]"
          }`}
        >
          <MousePointer size={12} />
          <FormattedMessage
            id="territories.clickMode"
            defaultMessage="Click"
          />
        </button>
        <button
          onClick={() => setDrawMode("freehand")}
          className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
            drawMode === "freehand"
              ? "bg-[var(--amber)] text-black"
              : "text-[var(--text-muted)] hover:bg-[var(--glass)]"
          }`}
        >
          <Spline size={12} />
          <FormattedMessage
            id="territories.freehandMode"
            defaultMessage="Freehand"
          />
        </button>
      </div>

      {/* Vertex count & instructions */}
      <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-40 bg-[var(--bg-1)] border border-[var(--border-2)] rounded-[var(--radius-sm)] px-4 py-2 text-xs text-[var(--text-muted)]">
        {drawMode === "click" ? (
          vertices.length < 3 ? (
            <FormattedMessage
              id="territories.clickInstructions"
              defaultMessage="Click to place vertices ({count}/3 min). Double-click to close."
              values={{ count: vertices.length }}
            />
          ) : (
            <FormattedMessage
              id="territories.clickReady"
              defaultMessage="{count} vertices. Double-click or press Enter to complete."
              values={{ count: vertices.length }}
            />
          )
        ) : (
          <FormattedMessage
            id="territories.freehandInstructions"
            defaultMessage="Hold Shift + drag to draw. Release to auto-close."
          />
        )}
      </div>
    </div>
  );
}
