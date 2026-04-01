import { useCallback, useEffect, useRef, useState } from "react";
import { FormattedMessage } from "react-intl";
import { MousePointer, Spline, Check, X } from "lucide-react";

interface CreationFlowProps {
  /** MapLibre map instance to draw on (optional — without map, uses pixel-based drawing) */
  map?: any;
  /** Called with the completed polygon coordinates (closed ring) */
  onComplete: (coords: [number, number][]) => void;
  /** Called to cancel creation */
  onCancel: () => void;
}

type DrawMode = "click" | "freehand";

const SOURCE_ID = "creation-flow";
const FILL_LAYER = "creation-flow-fill";
const LINE_LAYER = "creation-flow-line";
const POINTS_LAYER = "creation-flow-points";

/**
 * Territory creation flow — draws directly on a MapLibre map.
 * - Click mode: click to add vertices, double-click or Enter to close
 * - Freehand mode: hold Shift + drag to lasso
 */
export function CreationFlow({ map, onComplete, onCancel }: CreationFlowProps) {
  const [drawMode, setDrawMode] = useState<DrawMode>("click");
  const verticesRef = useRef<[number, number][]>([]);
  const [vertexCount, setVertexCount] = useState(0);
  const isDrawingRef = useRef(false);

  // Add GeoJSON source + layers on mount
  useEffect(() => {
    if (!map) return;

    const emptyGeoJSON = {
      type: "FeatureCollection" as const,
      features: [],
    };

    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, { type: "geojson", data: emptyGeoJSON });
    }

    if (!map.getLayer(FILL_LAYER)) {
      map.addLayer({
        id: FILL_LAYER,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": "#f59e0b",
          "fill-opacity": 0.2,
        },
        filter: ["==", "$type", "Polygon"],
      });
    }

    if (!map.getLayer(LINE_LAYER)) {
      map.addLayer({
        id: LINE_LAYER,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": "#f59e0b",
          "line-width": 2,
          "line-dasharray": [3, 2],
        },
      });
    }

    if (!map.getLayer(POINTS_LAYER)) {
      map.addLayer({
        id: POINTS_LAYER,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": 5,
          "circle-color": "#f59e0b",
          "circle-stroke-color": "#000",
          "circle-stroke-width": 1,
        },
        filter: ["==", "$type", "Point"],
      });
    }

    // Change cursor
    map.getCanvas().style.cursor = "crosshair";

    return () => {
      if (map.getLayer(POINTS_LAYER)) map.removeLayer(POINTS_LAYER);
      if (map.getLayer(LINE_LAYER)) map.removeLayer(LINE_LAYER);
      if (map.getLayer(FILL_LAYER)) map.removeLayer(FILL_LAYER);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      map.getCanvas().style.cursor = "";
    };
  }, [map]);

  // Update the GeoJSON source with current vertices
  const updateSource = useCallback(() => {
    if (!map) return;
    const src = map.getSource(SOURCE_ID);
    if (!src) return;

    const verts = verticesRef.current;
    const features: any[] = [];

    // Point features for each vertex
    for (const v of verts) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: v },
        properties: {},
      });
    }

    // Line or polygon
    if (verts.length >= 2) {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: verts,
        },
        properties: {},
      });
    }

    // Preview polygon if 3+ vertices
    if (verts.length >= 3) {
      features.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[...verts, verts[0]]],
        },
        properties: {},
      });
    }

    src.setData({ type: "FeatureCollection", features });
    setVertexCount(verts.length);
  }, [map]);

  const finalize = useCallback(() => {
    const verts = verticesRef.current;
    if (verts.length < 3) return;
    // Close the ring
    const closed: [number, number][] = [...verts, [verts[0]![0], verts[0]![1]]];
    onComplete(closed);
  }, [onComplete]);

  // Map click handler for vertex placement
  useEffect(() => {
    if (!map) return;

    const handleClick = (e: any) => {
      if (isDrawingRef.current) return; // freehand in progress
      const { lng, lat } = e.lngLat;
      verticesRef.current = [...verticesRef.current, [lng, lat]];
      updateSource();
    };

    const handleDblClick = (e: any) => {
      e.preventDefault();
      // Remove the last vertex added by the preceding click
      if (verticesRef.current.length > 3) {
        verticesRef.current = verticesRef.current.slice(0, -1);
      }
      finalize();
    };

    map.on("click", handleClick);
    map.on("dblclick", handleDblClick);
    // Disable default double-click zoom
    map.doubleClickZoom.disable();

    return () => {
      map.off("click", handleClick);
      map.off("dblclick", handleDblClick);
      map.doubleClickZoom.enable();
    };
  }, [map, updateSource, finalize]);

  // Freehand drawing via pointer events on canvas
  useEffect(() => {
    if (!map) return;
    const canvas = map.getCanvas() as HTMLCanvasElement;

    const handlePointerDown = (e: PointerEvent) => {
      if (!e.shiftKey) return;
      isDrawingRef.current = true;
      verticesRef.current = [];
      const { lng, lat } = map.unproject([e.offsetX, e.offsetY]);
      verticesRef.current.push([lng, lat]);
      canvas.setPointerCapture(e.pointerId);
      updateSource();
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!isDrawingRef.current) return;
      const { lng, lat } = map.unproject([e.offsetX, e.offsetY]);
      verticesRef.current.push([lng, lat]);
      updateSource();
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;
      canvas.releasePointerCapture(e.pointerId);
      if (verticesRef.current.length >= 3) {
        finalize();
      } else {
        verticesRef.current = [];
        updateSource();
      }
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);

    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
    };
  }, [map, updateSource, finalize]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
      if (e.key === "Enter" && verticesRef.current.length >= 3) {
        finalize();
      }
      if (e.key === "Backspace" && verticesRef.current.length > 0) {
        verticesRef.current = verticesRef.current.slice(0, -1);
        updateSource();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, finalize, updateSource]);

  return (
    <>
      {/* Drawing mode indicator — top left */}
      <div className="absolute top-3 left-3 z-40 flex items-center gap-2 bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius-sm)] px-3 py-2 shadow-lg">
        <button
          onClick={() => setDrawMode("click")}
          className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
            drawMode === "click"
              ? "bg-[var(--amber)] text-black"
              : "text-[var(--text-muted)] hover:bg-[var(--glass)]"
          }`}
        >
          <MousePointer size={12} />
          <FormattedMessage id="territories.clickMode" defaultMessage="Click" />
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
          <FormattedMessage id="territories.freehandMode" defaultMessage="Freehand" />
        </button>
      </div>

      {/* Action buttons — top right */}
      <div className="absolute top-3 right-3 z-40 flex items-center gap-1.5">
        {vertexCount >= 3 && (
          <button
            onClick={finalize}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[var(--green)] text-white rounded-[var(--radius-sm)] hover:opacity-90 transition-opacity cursor-pointer shadow-lg"
          >
            <Check size={13} />
            <FormattedMessage id="territories.finishDrawing" defaultMessage="Finish" />
          </button>
        )}
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[var(--bg-1)] text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:text-[var(--text)] transition-colors cursor-pointer shadow-lg"
        >
          <X size={13} />
          <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
        </button>
      </div>

      {/* Instructions — bottom center */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-40 bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius-sm)] px-4 py-2 text-xs text-[var(--text-muted)] shadow-lg">
        {drawMode === "click" ? (
          vertexCount < 3 ? (
            <FormattedMessage
              id="territories.clickInstructions"
              defaultMessage="Click to place vertices ({count}/3 min). Double-click to close."
              values={{ count: vertexCount }}
            />
          ) : (
            <FormattedMessage
              id="territories.clickReady"
              defaultMessage="{count} vertices. Double-click or press Enter to complete."
              values={{ count: vertexCount }}
            />
          )
        ) : (
          <FormattedMessage
            id="territories.freehandInstructions"
            defaultMessage="Hold Shift + drag to draw. Release to auto-close."
          />
        )}
      </div>
    </>
  );
}
