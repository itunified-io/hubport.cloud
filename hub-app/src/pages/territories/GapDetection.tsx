/**
 * Gap Detection page — split layout: map (left) + controls (right).
 * Shows uncovered buildings as markers on the map.
 * Click marker → ignore popup with reason.
 * Bulk select + ignore from list.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  AlertTriangle, Play, Loader2, CheckCircle2, XCircle,
  MapPin, EyeOff, ChevronRight, Trash2, PanelRightClose, PanelRightOpen, Sparkles,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import {
  runGapDetection,
  getGapRuns,
  deleteGapRun,
  ignoreBuildings,
  listTerritories,
  populateAddressesFromOsm,
  fetchBuildingOverrides,
  batchOverrides,
  type GapDetectionRun,
  type GeoJsonFeature,
  type TerritoryListItem,
  type OsmPopulateResult,
  type BuildingOverride,
  type TriageStatus,
} from "@/lib/territory-api";
import { useMapLibre, MAP_STYLES, type MapStyleKey } from "@/hooks/useMapLibre";
import { GapResolutionSection } from "@/components/territories/GapResolutionSection";
import { BuildingTriageList } from "@/components/territories/BuildingTriageList";

const STATUS_META: Record<string, { icon: React.ElementType; color: string }> = {
  running: { icon: Loader2, color: "text-[var(--amber)]" },
  completed: { icon: CheckCircle2, color: "text-[var(--green)]" },
  failed: { icon: XCircle, color: "text-[var(--red)]" },
};

const IGNORE_REASONS = [
  { value: "garage_carport", label: "Garage / Carport" },
  { value: "shed_barn", label: "Shed / Barn" },
  { value: "commercial_industrial", label: "Commercial / Industrial" },
  { value: "church_public", label: "Church / Public building" },
  { value: "unoccupied_ruins", label: "Unoccupied / Ruins" },
  { value: "not_a_residence", label: "Not a residence" },
  { value: "duplicate", label: "Duplicate" },
  { value: "other", label: "Other" },
];

// ─── Severity-based building type color mapping ─────────────────────
const SEVERITY_HIGH_TYPES = new Set([
  "house", "apartments", "residential", "detached", "semidetached_house", "terrace",
  "cabin",
]);
const SEVERITY_MEDIUM_TYPES = new Set(["farm", "farm_auxiliary"]);
const SEVERITY_IGNORABLE_TYPES = new Set([
  "garage", "garages", "commercial", "industrial", "retail",
  "shed", "barn", "church", "public",
  "warehouse", "office", "school", "hospital", "hotel", "supermarket",
  "service", "construction", "boathouse", "cowshed", "ruins",
  "roof", "hut", "transformer_tower", "bridge", "bunker",
  "carport", "kiosk", "toilets", "pavilion", "greenhouse",
]);

const SEVERITY_COLORS = {
  high: { fill: "#ef4444", stroke: "#b91c1c", label: "Residential" },
  medium: { fill: "#f97316", stroke: "#c2410c", label: "Mixed / Farm" },
  low: { fill: "#eab308", stroke: "#a16207", label: "Uncertain" },
  ignorable: { fill: "#9ca3af", stroke: "#6b7280", label: "Non-residential" },
} as const;

// All ignorable type strings for MapLibre expressions
const IGNORABLE_LIST = [
  "garage", "garages", "commercial", "industrial", "retail",
  "shed", "barn", "church", "public",
  "warehouse", "office", "school", "hospital", "hotel", "supermarket",
  "service", "construction", "boathouse", "cowshed", "ruins",
  "roof", "hut", "transformer_tower", "bridge", "bunker",
  "carport", "kiosk", "toilets", "pavilion", "greenhouse",
];

/** Classify a building type string into severity level. */
function getBuildingSeverity(buildingType: string | undefined, hasAddress: boolean): keyof typeof SEVERITY_COLORS {
  if (!buildingType || buildingType === "unknown") return "low";
  if (SEVERITY_HIGH_TYPES.has(buildingType)) return "high";
  if (SEVERITY_MEDIUM_TYPES.has(buildingType)) return "medium";
  if (buildingType === "yes") return hasAddress ? "medium" : "low";
  if (SEVERITY_IGNORABLE_TYPES.has(buildingType)) return "ignorable";
  return "low";
}

/** MapLibre data-driven expression for circle-color based on building type severity. */
const SEVERITY_CIRCLE_COLOR: unknown = [
  "case",
  // High severity — residential
  ["in", ["get", "buildingType"], ["literal", ["house", "apartments", "residential", "detached", "semidetached_house", "terrace", "cabin"]]],
  "#ef4444",
  // Medium severity — farm
  ["in", ["get", "buildingType"], ["literal", ["farm", "farm_auxiliary"]]],
  "#f97316",
  // Medium — "yes" with address
  ["all", ["==", ["get", "buildingType"], "yes"], ["!=", ["get", "streetAddress"], null]],
  "#f97316",
  // Ignorable — non-residential
  ["in", ["get", "buildingType"], ["literal", IGNORABLE_LIST]],
  "#9ca3af",
  // Default — low severity (uncertain)
  "#eab308",
];

/** MapLibre data-driven expression for circle-stroke-color. */
const SEVERITY_STROKE_COLOR: unknown = [
  "case",
  ["in", ["get", "buildingType"], ["literal", ["house", "apartments", "residential", "detached", "semidetached_house", "terrace", "cabin"]]],
  "#b91c1c",
  ["in", ["get", "buildingType"], ["literal", ["farm", "farm_auxiliary"]]],
  "#c2410c",
  ["all", ["==", ["get", "buildingType"], "yes"], ["!=", ["get", "streetAddress"], null]],
  "#c2410c",
  ["in", ["get", "buildingType"], ["literal", IGNORABLE_LIST]],
  "#6b7280",
  "#a16207",
];

export function GapDetection() {
  const { user } = useAuth();
  const intl = useIntl();
  const token = user?.access_token ?? "";

  const [runs, setRuns] = useState<GapDetectionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedGaps, setSelectedGaps] = useState<Set<string>>(new Set());
  const [showIgnoreDialog, setShowIgnoreDialog] = useState(false);
  const [ignoreReason, setIgnoreReason] = useState("not_a_residence");

  // Building type filter — hiddenTypes tracks types the user has toggled off
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());

  // ─── Tab state + triage overrides ─────────────────────────────
  const [activeTab, setActiveTab] = useState<"buildings" | "gaps">("buildings");
  const [overrides, setOverrides] = useState<Map<string, BuildingOverride>>(new Map());
  const [statusFilter, setStatusFilter] = useState("all");
  const [smartResolveUndocked, setSmartResolveUndocked] = useState(false);

  // Map
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const { isLoaded, mapRef, addSource, addLayer, fitBounds, activeStyle, changeStyle, onStyleReady } = useMapLibre({
    container: mapContainerRef,
    center: [11.38, 47.75],
    zoom: 12,
  });
  const [territories, setTerritories] = useState<TerritoryListItem[]>([]);
  const layersAdded = useRef(false);

  // ─── Popup state (for map click) ────────────────────────────
  const [popupFeature, setPopupFeature] = useState<{
    osmId: string;
    streetAddress: string | null;
    buildingType: string | null;
    lngLat: [number, number];
    screenPos: { x: number; y: number };
  } | null>(null);
  const [popupReason, setPopupReason] = useState("not_a_residence");

  // ─── Rectangle selection state ──────────────────────────────────
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number } | null>(null);
  const [selectedFeatures, setSelectedFeatures] = useState<GeoJsonFeature[]>([]);
  const [selectIgnoreReason, setSelectIgnoreReason] = useState(IGNORE_REASONS[0]!.value);
  const [isIgnoring, setIsIgnoring] = useState(false);

  // Refs for synchronous access in map event handlers
  const isSelectingRef = useRef(false);
  const justFinishedSelectingRef = useRef(false);
  const selectedFeaturesRef = useRef<GeoJsonFeature[]>([]);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);

  // Keep selectedFeatures ref in sync with state (for onStyleReady closure)
  useEffect(() => {
    selectedFeaturesRef.current = selectedFeatures;
  }, [selectedFeatures]);

  // ─── Gap resolution: polygon visualization ──────────────────
  const [gapPolygons, setGapPolygons] = useState<object[]>([]);
  const [highlightedGap, setHighlightedGap] = useState<object | null>(null);

  // Show gap polygon fills on map
  const updateGapPolygonLayers = useCallback((polygons: object[], highlighted: object | null) => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old layers
    if (map.getLayer("gap-highlight-outline")) map.removeLayer("gap-highlight-outline");
    if (map.getLayer("gap-highlight-fill")) map.removeLayer("gap-highlight-fill");
    if (map.getLayer("gap-polygon-outline")) map.removeLayer("gap-polygon-outline");
    if (map.getLayer("gap-polygon-fill")) map.removeLayer("gap-polygon-fill");
    if (map.getSource("gap-polygons")) map.removeSource("gap-polygons");
    if (map.getSource("gap-highlight")) map.removeSource("gap-highlight");

    // Insert gap polygons BELOW building markers so dots remain clickable
    const beforeLayer = map.getLayer("gap-markers") ? "gap-markers" : undefined;

    if (polygons.length > 0) {
      addSource("gap-polygons", {
        type: "FeatureCollection",
        features: polygons.map((p, i) => ({
          type: "Feature",
          properties: { index: i },
          geometry: p,
        })),
      });
      addLayer({
        id: "gap-polygon-fill",
        type: "fill",
        source: "gap-polygons",
        paint: { "fill-color": "#f97316", "fill-opacity": 0.1 },
      }, beforeLayer);
      addLayer({
        id: "gap-polygon-outline",
        type: "line",
        source: "gap-polygons",
        paint: { "line-color": "#f97316", "line-width": 1.5, "line-dasharray": [3, 2] },
      }, beforeLayer);
    }

    if (highlighted) {
      addSource("gap-highlight", {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: highlighted }],
      });
      addLayer({
        id: "gap-highlight-fill",
        type: "fill",
        source: "gap-highlight",
        paint: { "fill-color": "#f97316", "fill-opacity": 0.25 },
      }, beforeLayer);
      addLayer({
        id: "gap-highlight-outline",
        type: "line",
        source: "gap-highlight",
        paint: { "line-color": "#f97316", "line-width": 2.5 },
      }, beforeLayer);

      // Fly to highlighted gap polygon bounds
      try {
        const geo = highlighted as { coordinates?: number[][][][] | number[][][] };
        if (geo.coordinates) {
          let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
          const allCoords: number[][] = (geo.coordinates as number[][][][]).flat(2);
          for (const c of allCoords) {
            if (c[0]! < minLng) minLng = c[0]!;
            if (c[1]! < minLat) minLat = c[1]!;
            if (c[0]! > maxLng) maxLng = c[0]!;
            if (c[1]! > maxLat) maxLat = c[1]!;
          }
          if (isFinite(minLng)) {
            map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
              padding: 80,
              maxZoom: 16,
              duration: 800,
            });
          }
        }
      } catch {
        // Ignore bounds calculation errors
      }
    }
  }, [mapRef, addSource, addLayer]);

  // Update gap polygon layers when state changes
  useEffect(() => {
    if (isLoaded) {
      updateGapPolygonLayers(gapPolygons, highlightedGap);
    }
  }, [isLoaded, gapPolygons, highlightedGap, updateGapPolygonLayers]);

  const handleGapPolygonsChange = useCallback((polygons: object[]) => {
    setGapPolygons(polygons);
  }, []);

  const handleHighlightGap = useCallback((polygon: object | null) => {
    setHighlightedGap(polygon);
  }, []);

  // ─── Fetch territories for map ───────────────────────────────

  useEffect(() => {
    if (!token) return;
    listTerritories(token, { type: "all" }).then(setTerritories).catch(() => {});
  }, [token]);

  // ─── Fetch runs ──────────────────────────────────────────────

  const fetchRuns = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getGapRuns(token);
      setRuns(data);
      if (data.length > 0 && !selectedRunId) {
        const firstCompleted = data.find((r) => r.status === "completed");
        if (firstCompleted) setSelectedRunId(firstCompleted.id);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [token, selectedRunId]);

  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns]);

  const handleGapResolved = useCallback(() => {
    // Refresh territories + gap markers after gap resolution
    if (token) {
      listTerritories(token, { type: "all" }).then(setTerritories).catch(() => {});
      void fetchRuns();
    }
  }, [token, fetchRuns]);

  // ─── Override loading + handlers ──────────────────────────────
  const loadOverrides = useCallback(async () => {
    if (!token) return;
    try {
      const data = await fetchBuildingOverrides(token, { limit: 1000 });
      setOverrides(new Map(data.overrides.map(o => [o.osmId, o])));
    } catch { /* ignore */ }
  }, [token]);

  useEffect(() => { loadOverrides(); }, [loadOverrides]);

  const handleOverrideChange = useCallback((_osmId: string, override: BuildingOverride) => {
    setOverrides(prev => new Map(prev).set(override.osmId, override));
  }, []);

  const handleBatchOverride = useCallback(async (osmIds: string[], triageStatus: TriageStatus) => {
    if (!token) return;
    try {
      await batchOverrides(token, osmIds.map(osmId => ({ osmId, triageStatus })));
      await loadOverrides();
    } catch { /* ignore */ }
  }, [token, loadOverrides]);

  // ─── Map: add territory boundaries + congregation outline ────

  const addMapLayers = useCallback(() => {
    if (!territories.length) return;

    const congBoundary = territories.find((t) => t.type === "congregation_boundary" && t.boundaries);
    const regularTerritories = territories.filter((t) => t.type === "territory" && t.boundaries);

    // Territory fills — update source data if already exists, otherwise create
    const territoryFeatures = {
      type: "FeatureCollection" as const,
      features: regularTerritories.map((t) => ({
        type: "Feature" as const,
        properties: { number: t.number, name: t.name },
        geometry: t.boundaries,
      })),
    };

    const existingSource = mapRef.current?.getSource("territories") as { setData?: (data: object) => void } | undefined;
    if (existingSource?.setData) {
      // Update existing source data (e.g., after gap expansion changes boundaries)
      existingSource.setData(territoryFeatures);
    } else {
      addSource("territories", territoryFeatures);

      addLayer({
        id: "territory-fill", type: "fill", source: "territories",
        paint: { "fill-color": "rgba(34, 197, 94, 0.12)", "fill-opacity": 0.8 },
      });
      addLayer({
        id: "territory-outline", type: "line", source: "territories",
        paint: { "line-color": "#16a34a", "line-width": 1.5, "line-opacity": 0.6 },
      });
      addLayer({
        id: "territory-label", type: "symbol", source: "territories",
        layout: { "text-field": ["get", "number"], "text-size": 11, "text-font": ["Open Sans Bold"] },
        paint: { "text-color": "#16a34a", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
      });
    }

    // Congregation boundary (dashed red outline)
    if (congBoundary && !mapRef.current?.getSource("congregation")) {
      addSource("congregation", {
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: {},
          geometry: congBoundary.boundaries,
        }],
      });
      addLayer({
        id: "congregation-outline", type: "line", source: "congregation",
        paint: { "line-color": "#dc2626", "line-width": 2.5, "line-dasharray": [4, 3] },
      });

      // Fit map to congregation boundary
      const geo = congBoundary.boundaries as { coordinates: unknown };
      let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
      const flatten = (c: unknown): void => {
        if (Array.isArray(c) && typeof c[0] === "number") {
          const pt = c as number[];
          if (pt[0]! < minLng) minLng = pt[0]!;
          if (pt[0]! > maxLng) maxLng = pt[0]!;
          if (pt[1]! < minLat) minLat = pt[1]!;
          if (pt[1]! > maxLat) maxLat = pt[1]!;
        } else if (Array.isArray(c)) {
          for (const item of c) flatten(item);
        }
      };
      flatten(geo.coordinates);
      if (minLng < 180) fitBounds([[minLng, minLat], [maxLng, maxLat]]);
    }
  }, [territories, addSource, addLayer, mapRef, fitBounds]);

  // ─── Map: show gap markers for selected run ──────────────────

  const showGapsOnMap = useCallback((run: GapDetectionRun | undefined) => {
    // Remove old gap layer
    const map = mapRef.current;
    if (!map) return;
    if (map.getLayer("gap-markers")) map.removeLayer("gap-markers");
    if (map.getSource("gaps")) map.removeSource("gaps");

    if (!run?.resultGeoJson || run.resultGeoJson.features.length === 0) return;

    addSource("gaps", run.resultGeoJson);

    // Severity-colored circles for gap buildings
    addLayer({
      id: "gap-markers",
      type: "circle",
      source: "gaps",
      paint: {
        "circle-radius": 6,
        "circle-color": SEVERITY_CIRCLE_COLOR as any,
        "circle-opacity": 0.85,
        "circle-stroke-color": SEVERITY_STROKE_COLOR as any,
        "circle-stroke-width": 1.5,
      },
    });
  }, [addSource, addLayer, mapRef]);

  /** Apply yellow highlight to selected gap markers via paint property expressions. */
  const applySelectionHighlight = useCallback((osmIds: string[]) => {
    const map = mapRef.current;
    if (!map || !map.getLayer("gap-markers") || osmIds.length === 0) return;

    map.setPaintProperty("gap-markers", "circle-color", [
      "match",
      ["get", "osmId"],
      ...osmIds.flatMap((id) => [id, "#facc15"]),
      // Fall back to severity colors for non-selected markers
      ...(() => {
        // MapLibre match requires a flat fallback — use the severity expression
        return [SEVERITY_CIRCLE_COLOR];
      })(),
    ]);
    map.setPaintProperty("gap-markers", "circle-radius", [
      "match",
      ["get", "osmId"],
      ...osmIds.flatMap((id) => [id, 8]),
      6, // default
    ]);
  }, [mapRef]);

  /** Reset gap marker paint to default severity colors (remove selection highlight). */
  const clearSelectionHighlight = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("gap-markers")) return;
    map.setPaintProperty("gap-markers", "circle-color", SEVERITY_CIRCLE_COLOR as any);
    map.setPaintProperty("gap-markers", "circle-radius", 6);
  }, [mapRef]);

  // ─── Map: click handler for gap markers ──────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded) return;

    const handleClick = (e: { point: { x: number; y: number }; lngLat: { lng: number; lat: number }; features?: Array<{ properties: Record<string, unknown> }> }) => {
      // Don't open popup if we just finished a rectangle selection
      if (justFinishedSelectingRef.current) return;
      if (!e.features || e.features.length === 0) return;
      const f = e.features[0]!;
      setPopupFeature({
        osmId: f.properties.osmId as string,
        streetAddress: (f.properties.streetAddress as string) || null,
        buildingType: (f.properties.buildingType as string) || null,
        lngLat: [e.lngLat.lng, e.lngLat.lat],
        screenPos: { x: e.point.x, y: e.point.y },
      });
      setPopupReason("not_a_residence");
    };

    const handleEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const handleLeave = () => {
      map.getCanvas().style.cursor = "";
      // Don't close popup on leave — only on explicit dismiss
    };

    map.on("click", "gap-markers", handleClick);
    map.on("mouseenter", "gap-markers", handleEnter);
    map.on("mouseleave", "gap-markers", handleLeave);

    return () => {
      map.off("click", "gap-markers", handleClick);
      map.off("mouseenter", "gap-markers", handleEnter);
      map.off("mouseleave", "gap-markers", handleLeave);
    };
  }, [mapRef, isLoaded]);

  // ─── Rectangle selection: Shift+drag ────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded) return;
    const canvas = map.getCanvas();

    // Disable MapLibre's built-in BoxZoom (shift+drag to zoom) so our
    // rectangle selection can use shift+drag without triggering a zoom.
    if ((map as any).boxZoom) {
      (map as any).boxZoom.disable();
    }

    function handleMouseDown(e: MouseEvent) {
      if (!e.shiftKey || isIgnoring) return;
      e.preventDefault();
      e.stopPropagation();
      map!.dragPan.disable();
      const rect = canvas.getBoundingClientRect();
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      selectionStartRef.current = point;
      setSelectionStart(point);
      setSelectionEnd(point);
      setIsSelecting(true);
      isSelectingRef.current = true;
    }

    function handleMouseMove(e: MouseEvent) {
      if (!isSelectingRef.current) return;
      const rect = canvas.getBoundingClientRect();
      setSelectionEnd({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }

    function handleMouseUp(e: MouseEvent) {
      if (!isSelectingRef.current) return;
      isSelectingRef.current = false;
      setIsSelecting(false);
      map!.dragPan.enable();

      // Read start from ref (not React state) to avoid stale closure
      const start = selectionStartRef.current;
      const rect = canvas.getBoundingClientRect();
      const end = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      // If drag distance < 5px, treat as click (not selection)
      if (
        start &&
        Math.abs(end.x - start.x) < 5 &&
        Math.abs(end.y - start.y) < 5
      ) {
        setSelectionStart(null);
        setSelectionEnd(null);
        return;
      }

      if (!start) return;

      // Query features in screen-pixel bbox
      const sw: [number, number] = [
        Math.min(start.x, end.x),
        Math.max(start.y, end.y),
      ];
      const ne: [number, number] = [
        Math.max(start.x, end.x),
        Math.min(start.y, end.y),
      ];
      const features = map!.queryRenderedFeatures([sw, ne], {
        layers: ["gap-markers"],
      });

      // Clear rectangle overlay
      setSelectionStart(null);
      setSelectionEnd(null);

      if (features.length === 0) {
        return;
      }

      // Convert to GeoJsonFeature array
      const geoFeatures: GeoJsonFeature[] = features.map((f) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [0, 0] },
        properties: f.properties,
      }));

      setSelectedFeatures(geoFeatures);
      setSelectIgnoreReason(IGNORE_REASONS[0]!.value);

      // Highlight selected markers
      const osmIds = features
        .map((f) => f.properties?.osmId as string)
        .filter(Boolean);
      applySelectionHighlight(osmIds);

      // Switch to satellite for visual verification
      if (activeStyle !== "satellite") {
        changeStyle("satellite");
      }

      // Prevent click handler from firing
      justFinishedSelectingRef.current = true;
      requestAnimationFrame(() => {
        justFinishedSelectingRef.current = false;
      });
    }

    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseup", handleMouseUp);

    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseup", handleMouseUp);
    };
  }, [mapRef, isLoaded, isIgnoring, activeStyle, applySelectionHighlight, changeStyle]);

  // ─── Map: initialize layers on style ready ───────────────────

  // Keep gap polygons ref in sync for style change re-render
  const gapPolygonsRef = useRef<object[]>([]);
  const highlightedGapRef = useRef<object | null>(null);
  useEffect(() => { gapPolygonsRef.current = gapPolygons; }, [gapPolygons]);
  useEffect(() => { highlightedGapRef.current = highlightedGap; }, [highlightedGap]);

  useEffect(() => {
    onStyleReady(() => {
      layersAdded.current = false;
      // Re-add territory boundary layers (fills, outlines, labels, congregation)
      addMapLayers();
      layersAdded.current = true;
      // Re-add gap markers for current run
      const sel = runs.find((r) => r.id === selectedRunId);
      if (sel) showGapsOnMap(sel);
      // Re-apply selection highlighting if active (via ref to avoid stale closure)
      const currentFeatures = selectedFeaturesRef.current;
      if (currentFeatures.length > 0) {
        const osmIds = currentFeatures
          .map((f) => (f.properties?.osmId as string) ?? "")
          .filter(Boolean);
        applySelectionHighlight(osmIds);
      }
      // Re-add gap resolution polygon layers
      if (gapPolygonsRef.current.length > 0) {
        updateGapPolygonLayers(gapPolygonsRef.current, highlightedGapRef.current);
      }
    });
  }, [onStyleReady, addMapLayers, showGapsOnMap, applySelectionHighlight, updateGapPolygonLayers, runs, selectedRunId]);

  useEffect(() => {
    if (!isLoaded || !territories.length) return;
    addMapLayers();
    layersAdded.current = true;
  }, [isLoaded, territories, addMapLayers]);

  // When selectedRunId changes, update gap markers and clear selection
  const selectedRun = runs.find((r) => r.id === selectedRunId);

  // Derive unique building types + counts from current run, filter by hiddenTypes
  const { typeCountMap, visibleFeatures } = (() => {
    const features: GeoJsonFeature[] = selectedRun?.resultGeoJson?.features ?? [];
    const counts = new Map<string, number>();
    for (const f of features) {
      const t = (f.properties?.buildingType as string) || "unknown";
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const visible = features.filter((f) => {
      const t = (f.properties?.buildingType as string) || "unknown";
      return !hiddenTypes.has(t);
    });
    return { typeCountMap: counts, visibleFeatures: visible };
  })();

  // Triage progress: count uncertain buildings (yellow) and how many are reviewed
  const { triageUnreviewedCount, triageReviewedCount, triageTotalUncertain } = useMemo(() => {
    const features: GeoJsonFeature[] = visibleFeatures;
    if (!features.length) return { triageUnreviewedCount: 0, triageReviewedCount: 0, triageTotalUncertain: 0 };

    let uncertain = 0;
    let reviewed = 0;

    for (const f of features) {
      const osmId = f.properties?.osmId as string;
      const override = overrides.get(osmId);
      const effectiveType = override?.overriddenType ?? (f.properties?.buildingType as string) ?? "unknown";
      const effectiveHasAddress = (override?.overriddenAddress != null) || !!(f.properties?.streetAddress);

      const isYellow = !SEVERITY_HIGH_TYPES.has(effectiveType)
        && !SEVERITY_MEDIUM_TYPES.has(effectiveType)
        && !SEVERITY_IGNORABLE_TYPES.has(effectiveType)
        && !(effectiveType === "yes" && effectiveHasAddress);

      if (isYellow) {
        uncertain++;
        if (override && override.triageStatus !== "unreviewed") {
          reviewed++;
        }
      }
    }

    return { triageUnreviewedCount: uncertain - reviewed, triageReviewedCount: reviewed, triageTotalUncertain: uncertain };
  }, [visibleFeatures, overrides]);

  // Reset filter when switching runs
  useEffect(() => {
    setHiddenTypes(new Set());
  }, [selectedRunId]);

  useEffect(() => {
    setSelectedFeatures([]);
    if (isLoaded && layersAdded.current) {
      showGapsOnMap(selectedRun);
    }
  }, [isLoaded, selectedRun, showGapsOnMap]);

  // Filter map markers when hiddenTypes changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedRun?.resultGeoJson) return;
    const src = map.getSource("gaps") as { setData?: (d: unknown) => void } | undefined;
    if (src?.setData) {
      src.setData({
        ...selectedRun.resultGeoJson,
        features: visibleFeatures,
      });
    }
  }, [hiddenTypes, visibleFeatures, selectedRun, mapRef]);

  // ─── Run detection ────────────────────────────────────────────

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await runGapDetection(token);
      await fetchRuns();

      if (result.status === "completed") {
        setSelectedRunId(result.id);
      } else if (result.status === "failed") {
        setError("Overpass API timed out. Try again later.");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({ id: "common.error", defaultMessage: "An error occurred" }),
      );
    } finally {
      setRunning(false);
    }
  };

  // ─── Populate addresses from OSM ─────────────────────────────

  const [populating, setPopulating] = useState(false);
  const [populateResult, setPopulateResult] = useState<OsmPopulateResult | null>(null);

  const handlePopulate = async () => {
    setPopulating(true);
    setError(null);
    setPopulateResult(null);
    try {
      const result = await populateAddressesFromOsm(token);
      setPopulateResult(result);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({ id: "common.error", defaultMessage: "An error occurred" }),
      );
    } finally {
      setPopulating(false);
    }
  };

  // ─── Delete run ──────────────────────────────────────────────

  const handleDeleteRun = async (runId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteGapRun(runId, token);
      if (selectedRunId === runId) {
        setSelectedRunId(null);
        setSelectedGaps(new Set());
      }
      await fetchRuns();
    } catch {
      // silently fail
    }
  };

  // ─── Show results on map ──────────────────────────────────────

  const handleShowOnMap = (run: GapDetectionRun) => {
    setSelectedRunId(run.id);
  };

  // ─── Ignore single building (from map popup) ─────────────────

  const handleIgnoreSingle = async (osmId: string, reason: string) => {
    if (!selectedRun?.territoryId) return;

    const feature = selectedRun.resultGeoJson?.features.find(
      (f: GeoJsonFeature) => f.properties?.osmId === osmId,
    );

    try {
      await ignoreBuildings([{
        territoryId: selectedRun.territoryId,
        osmId,
        reason,
        lat: feature?.geometry.type === "Point" ? (feature.geometry.coordinates as number[])[1] : undefined,
        lng: feature?.geometry.type === "Point" ? (feature.geometry.coordinates as number[])[0] : undefined,
        streetAddress: (feature?.properties?.streetAddress as string) || undefined,
        buildingType: (feature?.properties?.buildingType as string) || undefined,
      }], token);
      setPopupFeature(null);
      // Re-run to refresh the data
      await fetchRuns();
    } catch {
      // silently fail
    }
  };

  // ─── Bulk ignore ──────────────────────────────────────────────

  const handleBulkIgnore = async () => {
    if (selectedGaps.size === 0 || !selectedRun?.resultGeoJson || !selectedRun.territoryId) return;

    const buildings = selectedRun.resultGeoJson.features
      .filter((f: GeoJsonFeature) => selectedGaps.has(f.properties?.osmId as string))
      .map((f: GeoJsonFeature) => ({
        territoryId: selectedRun.territoryId,
        osmId: f.properties?.osmId as string,
        reason: ignoreReason,
        lat: f.geometry.type === "Point" ? (f.geometry.coordinates as number[])[1] : undefined,
        lng: f.geometry.type === "Point" ? (f.geometry.coordinates as number[])[0] : undefined,
        streetAddress: f.properties?.streetAddress as string | undefined,
        buildingType: f.properties?.buildingType as string | undefined,
      }));

    try {
      await ignoreBuildings(buildings, token);
      setSelectedGaps(new Set());
      setShowIgnoreDialog(false);
      await fetchRuns();
    } catch {
      // handle silently
    }
  };

  /** Handle bulk ignore from rectangle selection. Chunks into batches of 200 (API limit). */
  const handleRectangleIgnore = async () => {
    if (!selectedRun || !user?.access_token || selectedFeatures.length === 0) return;
    setIsIgnoring(true);

    // Filter out features with missing/empty osmId and build payload
    const buildings = selectedFeatures
      .filter((f) => f.properties?.osmId)
      .map((f) => ({
        territoryId: selectedRun.territoryId,
        osmId: f.properties!.osmId as string,
        reason: selectIgnoreReason,
        lat: f.properties?.lat as number | undefined,
        lng: f.properties?.lng as number | undefined,
        streetAddress: f.properties?.streetAddress as string | undefined,
        buildingType: f.properties?.buildingType as string | undefined,
      }));

    if (buildings.length === 0) {
      setIsIgnoring(false);
      return;
    }

    // Chunk into batches of 200 (backend maxItems limit)
    const BATCH_SIZE = 200;

    try {
      let batchErrors = 0;
      for (let i = 0; i < buildings.length; i += BATCH_SIZE) {
        const batch = buildings.slice(i, i + BATCH_SIZE);
        try {
          await ignoreBuildings(batch, user.access_token);
        } catch (batchErr) {
          batchErrors++;
          console.error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, batchErr);
        }
      }
      // Clear selection and revert to street view
      setSelectedFeatures([]);
      clearSelectionHighlight();
      if (activeStyle === "satellite") changeStyle("street");
      // Re-fetch runs and force refresh gap markers on map
      const updatedRuns = await getGapRuns(user.access_token);
      setRuns(updatedRuns);
      const updatedRun = updatedRuns.find((r) => r.id === selectedRunId);
      if (updatedRun) showGapsOnMap(updatedRun);
      if (batchErrors > 0) {
        console.warn(`${batchErrors} batch(es) failed. Some buildings may not have been ignored.`);
      }
    } catch {
      // Keep selection active so user can retry
    } finally {
      setIsIgnoring(false);
    }
  };

  /** Cancel rectangle selection — clear highlights, revert to street view. */
  const handleRectangleCancel = () => {
    setSelectedFeatures([]);
    clearSelectionHighlight();
    if (activeStyle === "satellite") changeStyle("street");
  };

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-4rem)] -m-6">
      {/* ─── Map (left) ───────────────────────────────────────── */}
      <div className="flex-1 relative">
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* Map style switcher */}
        {isLoaded && (
          <div className="absolute top-3 left-3 z-10 flex rounded-[var(--radius-sm)] overflow-hidden shadow-lg border border-[var(--border)]">
            {(Object.keys(MAP_STYLES) as MapStyleKey[]).map((key) => (
              <button
                key={key}
                onClick={() => changeStyle(key)}
                className={`px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                  activeStyle === key
                    ? "bg-[var(--amber)] text-black"
                    : "bg-[var(--bg-1)] text-[var(--text-muted)] hover:bg-[var(--glass)] hover:text-[var(--text)]"
                }`}
              >
                {MAP_STYLES[key].label}
              </button>
            ))}
          </div>
        )}

        {/* Map legend — severity-based colors */}
        {isLoaded && (
          <div className="absolute bottom-4 left-3 z-10 bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius-sm)] shadow-lg px-3 py-2 space-y-1.5">
            <div className="text-[9px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
              <FormattedMessage id="gap.legend.title" defaultMessage="Building Severity" />
            </div>
            {(Object.entries(SEVERITY_COLORS) as [string, typeof SEVERITY_COLORS[keyof typeof SEVERITY_COLORS]][]).map(([key, { fill, stroke, label }]) => (
              <div key={key} className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: fill, border: `1.5px solid ${stroke}` }} />
                {label}
              </div>
            ))}
            <div className="border-t border-[var(--glass-border)] my-1" />
            <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
              <span className="w-3 h-0.5 bg-[#16a34a]" />
              <FormattedMessage id="gap.legend.territory" defaultMessage="Territory boundary" />
            </div>
            <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
              <span className="w-3 h-0.5 bg-[#dc2626]" style={{ borderTop: "2px dashed #dc2626" }} />
              <FormattedMessage id="gap.legend.congregation" defaultMessage="Congregation boundary" />
            </div>
          </div>
        )}

        {/* Map popup for single gap */}
        {popupFeature && (
          <div
            className="absolute z-20 bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius)] shadow-xl p-3 space-y-2 w-64"
            style={{
              left: Math.min(popupFeature.screenPos.x + 12, window.innerWidth - 280),
              top: Math.max(popupFeature.screenPos.y - 100, 8),
            }}
          >
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--text)] truncate">
                  {popupFeature.streetAddress ?? popupFeature.osmId}
                </p>
                {popupFeature.buildingType && (
                  <p className="text-[10px] text-[var(--text-muted)]">{popupFeature.buildingType}</p>
                )}
              </div>
              <button
                onClick={() => setPopupFeature(null)}
                className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
              >
                ✕
              </button>
            </div>
            <select
              value={popupReason}
              onChange={(e) => setPopupReason(e.target.value)}
              className="w-full px-2 py-1 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] cursor-pointer"
            >
              {IGNORE_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <button
              onClick={() => handleIgnoreSingle(popupFeature.osmId, popupReason)}
              className="w-full py-1.5 text-xs font-semibold text-black bg-[var(--amber)] rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] cursor-pointer flex items-center justify-center gap-1"
            >
              <EyeOff size={12} />
              Ignore
            </button>
          </div>
        )}

        {/* Rectangle selection overlay */}
        {isSelecting && selectionStart && selectionEnd && (
          <div
            style={{
              position: "absolute",
              left: Math.min(selectionStart.x, selectionEnd.x),
              top: Math.min(selectionStart.y, selectionEnd.y),
              width: Math.abs(selectionEnd.x - selectionStart.x),
              height: Math.abs(selectionEnd.y - selectionStart.y),
              border: "2px solid #3b82f6",
              backgroundColor: "rgba(59, 130, 246, 0.15)",
              pointerEvents: "none",
              zIndex: 10,
            }}
          />
        )}

        {/* Rectangle selection confirmation bar */}
        {selectedFeatures.length > 0 && (
          <div className="absolute bottom-4 left-4 right-4 z-20 flex items-center gap-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] px-4 py-3 shadow-lg">
            <span className="text-sm font-medium whitespace-nowrap">
              {selectedFeatures.length} buildings selected
            </span>
            <select
              value={selectIgnoreReason}
              onChange={(e) => setSelectIgnoreReason(e.target.value)}
              className="flex-1 min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
            >
              {IGNORE_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              onClick={handleRectangleIgnore}
              disabled={isIgnoring}
              className="rounded-md bg-[var(--amber)] px-3 py-1.5 text-sm font-medium text-black hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              {isIgnoring ? "…" : intl.formatMessage({ id: "gap.ignore", defaultMessage: "Ignore" })}
            </button>
            <button
              onClick={handleRectangleCancel}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:bg-[var(--glass)] cursor-pointer"
            >
              {intl.formatMessage({ id: "common.cancel", defaultMessage: "Cancel" })}
            </button>
          </div>
        )}

        {/* ─── Undocked Smart Resolve floating panel ──────────── */}
        {smartResolveUndocked && selectedRun?.status === "completed" && activeTab === "gaps" && (
          <div className="absolute bottom-4 left-4 right-4 z-20 max-h-[50vh] bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius)] shadow-xl overflow-hidden flex flex-col">
            {/* Panel header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] flex-shrink-0 bg-[var(--glass)]">
              <span className="text-xs font-semibold text-[var(--text)] flex items-center gap-2">
                <Sparkles size={14} className="text-[var(--amber)]" />
                <FormattedMessage id="gap.smartResolve" defaultMessage="Smart Resolve" />
              </span>
              <button
                onClick={() => setSmartResolveUndocked(false)}
                className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)] flex items-center gap-1 cursor-pointer"
                title="Dock back to sidebar"
              >
                <PanelRightOpen size={12} />
                <FormattedMessage id="gap.dock" defaultMessage="Dock" />
              </button>
            </div>
            {/* Panel content */}
            <div className="flex-1 overflow-y-auto">
              <GapResolutionSection
                token={token}
                onGapPolygonsChange={handleGapPolygonsChange}
                onResolved={handleGapResolved}
                onHighlightGap={handleHighlightGap}
                overrides={overrides}
              />
            </div>
          </div>
        )}
      </div>

      {/* ─── Sidebar (right) ──────────────────────────────────── */}
      <div className="w-96 flex flex-col border-l border-[var(--border)] bg-[var(--bg-1)] overflow-hidden">
        {/* Header + run button */}
        <div className="p-4 border-b border-[var(--border)] space-y-3 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text)] flex items-center gap-2">
              <AlertTriangle size={16} className="text-[var(--amber)]" />
              <FormattedMessage id="territories.gapDetection" defaultMessage="Gap Detection" />
            </h2>
          </div>

          <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
            <FormattedMessage
              id="territories.gapDescription"
              defaultMessage="Finds buildings inside the branch territory assignment that are not covered by any territory."
            />
          </p>

          <button
            onClick={handleRun}
            disabled={running}
            className="w-full py-2.5 text-sm font-semibold text-black bg-[var(--amber)] rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {running ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <FormattedMessage id="territories.gapRunning" defaultMessage="Detecting gaps... (up to 2 min)" />
              </>
            ) : (
              <>
                <Play size={16} />
                <FormattedMessage id="territories.gapRun" defaultMessage="Run Detection" />
              </>
            )}
          </button>

          <div className="border-t border-[var(--glass-border)] my-1" />

          <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
            <FormattedMessage
              id="territories.populateDescription"
              defaultMessage="Fetches all buildings from OSM within the branch territory and creates address records in each territory."
            />
          </p>

          <button
            onClick={handlePopulate}
            disabled={populating}
            className="w-full py-2.5 text-sm font-semibold text-black bg-[var(--green)] rounded-[var(--radius-sm)] hover:opacity-90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {populating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <FormattedMessage id="territories.populating" defaultMessage="Loading addresses... (up to 2 min)" />
              </>
            ) : (
              <>
                <MapPin size={16} />
                <FormattedMessage id="territories.populateRun" defaultMessage="Populate Addresses from OSM" />
              </>
            )}
          </button>

          {populateResult && (
            <div className="px-3 py-2 rounded-[var(--radius-sm)] bg-[#22c55e14] text-xs text-[var(--green)] space-y-0.5">
              <div>{populateResult.addressesCreated} addresses created</div>
              <div>{populateResult.addressesUpdated} addresses updated</div>
              <div>{populateResult.territoriesProcessed} territories affected</div>
              {populateResult.unassigned > 0 && (
                <div className="text-[var(--amber)]">{populateResult.unassigned} buildings outside all territories</div>
              )}
            </div>
          )}

          {error && (
            <div className="px-3 py-2 rounded-[var(--radius-sm)] bg-[#ef444414] text-xs text-[var(--red)]">
              {error}
            </div>
          )}
        </div>

        {/* Results for selected run */}
        {selectedRun && selectedRun.status === "completed" && (
          <div className="p-4 border-b border-[var(--border)] space-y-3 flex-shrink-0">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2 rounded-[var(--radius-sm)] bg-[var(--glass)]">
                <div className="text-lg font-bold text-[var(--text)]">{selectedRun.totalBuildings ?? 0}</div>
                <div className="text-[10px] text-[var(--text-muted)]">Buildings</div>
              </div>
              <div className="p-2 rounded-[var(--radius-sm)] bg-[#22c55e14]">
                <div className="text-lg font-bold text-[var(--green)]">{selectedRun.coveredCount ?? 0}</div>
                <div className="text-[10px] text-[var(--text-muted)]">In territories</div>
              </div>
              <div className="p-2 rounded-[var(--radius-sm)] bg-[#f9731614]">
                <div className="text-lg font-bold text-[var(--amber)]">{visibleFeatures.length}</div>
                <div className="text-[10px] text-[var(--text-muted)]">Uncovered</div>
              </div>
            </div>

            {/* Coverage bar */}
            {selectedRun.totalBuildings && selectedRun.totalBuildings > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
                  <span>Territory coverage</span>
                  <span className="font-mono">
                    {Math.round(((selectedRun.coveredCount ?? 0) / selectedRun.totalBuildings) * 100)}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--glass)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--green)] transition-all"
                    style={{
                      width: `${Math.round(((selectedRun.coveredCount ?? 0) / selectedRun.totalBuildings) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Building type filter chips — colored by severity */}
            {typeCountMap.size > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {Array.from(typeCountMap.entries())
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => {
                    const active = !hiddenTypes.has(type);
                    const severity = getBuildingSeverity(type, false);
                    const color = SEVERITY_COLORS[severity].fill;
                    return (
                      <button
                        key={type}
                        onClick={() => {
                          setHiddenTypes((prev) => {
                            const next = new Set(prev);
                            if (next.has(type)) next.delete(type);
                            else next.add(type);
                            return next;
                          });
                        }}
                        className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors cursor-pointer ${
                          active
                            ? "text-[var(--text)]"
                            : "border-[var(--border)] text-[var(--text-muted)] opacity-50"
                        }`}
                        style={active ? { borderColor: color, backgroundColor: `${color}18` } : undefined}
                      >
                        <span className="inline-block w-1.5 h-1.5 rounded-full mr-1" style={{ backgroundColor: color }} />
                        {type} ({count})
                      </button>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* ─── Tab bar ─────────────────────────────────────────── */}
        {selectedRun?.status === "completed" && (
          <div className="flex border-b border-[var(--border)] flex-shrink-0">
            <button
              onClick={() => setActiveTab("buildings")}
              className={`flex-1 py-2 text-xs font-medium text-center transition-colors cursor-pointer ${
                activeTab === "buildings"
                  ? "text-[var(--text)] border-b-2 border-[var(--amber)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              <FormattedMessage id="gap.tab.buildings" defaultMessage="Buildings" />
              {triageUnreviewedCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-[9px] rounded-full bg-[var(--amber)]/10 text-[var(--amber)]">
                  {triageUnreviewedCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("gaps")}
              className={`flex-1 py-2 text-xs font-medium text-center transition-colors cursor-pointer ${
                activeTab === "gaps"
                  ? "text-[var(--text)] border-b-2 border-[var(--amber)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              <FormattedMessage id="gap.tab.gaps" defaultMessage="Gaps" />
              {visibleFeatures.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-[9px] rounded-full bg-[var(--amber)]/10 text-[var(--amber)]">
                  {visibleFeatures.length}
                </span>
              )}
            </button>
          </div>
        )}

        {/* ─── Buildings Tab ───────────────────────────────────── */}
        {selectedRun?.status === "completed" && activeTab === "buildings" && (
          <div className="flex-1 overflow-y-auto">
            {/* Triage progress bar */}
            {triageTotalUncertain > 0 && (
              <div className="px-4 py-2">
                <div className="flex justify-between text-[9px] text-[var(--text-muted)] mb-1">
                  <span>{triageReviewedCount}/{triageTotalUncertain} <FormattedMessage id="gap.triageProgress" defaultMessage="uncertain reviewed" /></span>
                </div>
                <div className="h-1 bg-[var(--glass)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--amber)] rounded-full transition-all"
                    style={{ width: `${triageTotalUncertain > 0 ? (triageReviewedCount / triageTotalUncertain) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}
            <BuildingTriageList
              features={visibleFeatures}
              overrides={overrides}
              token={token}
              onOverrideChange={handleOverrideChange}
              onBatchOverride={handleBatchOverride}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
            />

            {selectedRun?.resultGeoJson && visibleFeatures.length === 0 && (
              <div className="flex flex-col items-center py-4 text-[var(--green)]">
                <CheckCircle2 size={24} strokeWidth={1.2} className="mb-2" />
                <p className="text-xs font-medium">All buildings are covered by territories!</p>
              </div>
            )}
          </div>
        )}

        {/* ─── Gaps Tab ────────────────────────────────────────── */}
        {selectedRun?.status === "completed" && activeTab === "gaps" && (
          <div className="flex-1 overflow-y-auto">
            {/* Ignore dialog */}
            {showIgnoreDialog && (
              <div className="p-4 border-b border-[var(--border)] bg-[var(--bg-1)] space-y-3">
                <h3 className="text-xs font-semibold text-[var(--text)]">
                  Ignore {selectedGaps.size} buildings
                </h3>
                <div>
                  <label className="block text-[10px] font-medium text-[var(--text-muted)] mb-1">Reason</label>
                  <select
                    value={ignoreReason}
                    onChange={(e) => setIgnoreReason(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] cursor-pointer"
                  >
                    {IGNORE_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowIgnoreDialog(false)}
                    className="flex-1 py-1.5 text-xs text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleBulkIgnore}
                    className="flex-1 py-1.5 text-xs font-semibold text-black bg-[var(--amber)] rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] cursor-pointer flex items-center justify-center gap-1"
                  >
                    <EyeOff size={12} />
                    Ignore
                  </button>
                </div>
              </div>
            )}

            {/* Smart Gap Resolution — docked in sidebar */}
            {!smartResolveUndocked && (
              <>
                {/* Undock button */}
                <div className="px-4 pt-2 flex justify-end">
                  <button
                    onClick={() => setSmartResolveUndocked(true)}
                    className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)] flex items-center gap-1 cursor-pointer"
                    title="Undock to floating panel"
                  >
                    <PanelRightClose size={12} />
                    <FormattedMessage id="gap.undock" defaultMessage="Undock" />
                  </button>
                </div>
                <GapResolutionSection
                  token={token}
                  onGapPolygonsChange={handleGapPolygonsChange}
                  onResolved={handleGapResolved}
                  onHighlightGap={handleHighlightGap}
                  overrides={overrides}
                />
              </>
            )}

            {/* Placeholder when undocked */}
            {smartResolveUndocked && (
              <div className="flex flex-col items-center justify-center py-8 text-[var(--text-muted)] space-y-3">
                <PanelRightClose size={24} strokeWidth={1.2} />
                <p className="text-xs">
                  <FormattedMessage id="gap.undockedHint" defaultMessage="Smart Resolve is undocked" />
                </p>
                <button
                  onClick={() => setSmartResolveUndocked(false)}
                  className="text-xs text-[var(--amber)] hover:text-[var(--amber-light)] flex items-center gap-1 cursor-pointer"
                >
                  <PanelRightOpen size={12} />
                  <FormattedMessage id="gap.dock" defaultMessage="Dock back" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Run history — collapse to compact size when tab content is showing */}
        <div className={`${selectedRun?.status === "completed" ? "flex-shrink-0 max-h-[100px]" : "flex-1"} overflow-y-auto border-t border-[var(--border)]`}>
          <div className="px-4 py-1.5 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
            <FormattedMessage id="gap.runHistory" defaultMessage="Run History" />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--glass-2)] border-t-[var(--amber)]" />
            </div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-[var(--text-muted)]">
              <AlertTriangle size={24} strokeWidth={1.2} className="mb-2" />
              <p className="text-xs">No detection runs yet</p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {runs.map((run) => {
                const meta = STATUS_META[run.status] ?? STATUS_META.running!;
                const Icon = meta.icon;
                const isActive = run.id === selectedRunId;

                return (
                  <li key={run.id}>
                    <button
                      onClick={() => handleShowOnMap(run)}
                      className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors cursor-pointer ${
                        isActive ? "bg-[var(--glass-2)]" : "hover:bg-[var(--glass)]"
                      }`}
                    >
                      <Icon
                        size={16}
                        className={`${meta.color} ${run.status === "running" ? "animate-spin" : ""}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-[var(--text)]">
                          {new Date(run.startedAt).toLocaleString(undefined, {
                            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                          })}
                        </div>
                        {run.status === "completed" && (
                          <div className="text-[10px] text-[var(--text-muted)]">
                            {run.gapCount ?? 0} uncovered / {run.totalBuildings ?? 0} buildings
                          </div>
                        )}
                        {run.status === "failed" && (
                          <div className="text-[10px] text-[var(--red)]">Failed (timeout)</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => handleDeleteRun(run.id, e)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleDeleteRun(run.id, e as unknown as React.MouseEvent); }}
                          className="p-1 rounded hover:bg-[var(--glass-2)] text-[var(--text-muted)] hover:text-[var(--red)] transition-colors"
                          title="Delete run"
                        >
                          <Trash2 size={12} />
                        </span>
                        <ChevronRight size={14} className="text-[var(--text-muted)]" />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
