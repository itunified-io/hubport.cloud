import { useEffect, useState, useRef, useCallback } from "react";
import { FormattedMessage, FormattedDate, useIntl } from "react-intl";
import { useNavigate, useParams } from "react-router";
import {
  ArrowLeft, User, Calendar, Loader2, MapPin, Clock, Hash,
  Layers, Maximize2, Minimize2, Home, Building, Trees,
  Ban, ArrowUpDown, Archive, Search, Filter, Bell,
  ChevronDown, Check, X, Edit3, Save, Wand2, AlertTriangle, Crop,
  MoreVertical, Trash2,
} from "lucide-react";
import type { Marker } from "maplibre-gl";
import { useAuth } from "@/auth/useAuth";
import { usePermissions } from "@/auth/PermissionProvider";
import ExportDropdown from "./ExportDropdown";
import {
  getTerritory, listTerritories, listAddresses, updateAddress,
  previewFix, updateTerritoryBoundaries, getViolations, getSnapContext, deleteBoundary,
  type TerritoryListItem, type Address, type AddressStatus, type AutoFixResult, type TerritoryViolation,
} from "@/lib/territory-api";
import { useClipSegment, type ClipCandidate } from "@/hooks/useClipSegment";
import type { SnapTarget } from "./SnapEngine";
import { ClipSegmentPanel } from "./ClipSegmentPanel";
import { CreationFlow } from "./CreationFlow";
import { AutoFixPreview } from "./AutoFixPreview";
import { VersionHistory } from "./VersionHistory";
import { useMapLibre, MAP_STYLES, type MapStyleKey } from "@/hooks/useMapLibre";
import { useGpsTracker } from "@/hooks/useGpsTracker";
import { MyLocationMarker, MY_LOCATION_MARKER_CSS } from "@/components/map/MyLocationMarker";

// ─── Status & type visuals ──────────────────────────────────────

const STATUS_META: Record<string, { icon: React.ElementType; color: string; label: string; dimmed?: boolean }> = {
  active:           { icon: Home,       color: "text-[var(--green)]",       label: "Active" },
  do_not_call:      { icon: Ban,        color: "text-[var(--red)]",         label: "Do Not Call",       dimmed: true },
  not_at_home:      { icon: Home,       color: "text-[var(--amber)]",       label: "Not at Home" },
  moved:            { icon: ArrowUpDown, color: "text-[var(--text-muted)]", label: "Moved" },
  deceased:         { icon: Home,       color: "text-[var(--text-muted)]",  label: "Deceased",          dimmed: true },
  foreign_language: { icon: Home,       color: "text-[var(--blue)]",        label: "Foreign Language" },
  archived:         { icon: Archive,    color: "text-[var(--text-muted)]",  label: "Archived",          dimmed: true },
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  residential: Home,
  business: Building,
  apartment_building: Building,
  rural: Trees,
};

const STATUS_OPTIONS: { value: AddressStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "not_at_home", label: "Not at Home" },
  { value: "do_not_call", label: "Do Not Call" },
  { value: "moved", label: "Moved" },
  { value: "foreign_language", label: "Foreign Language" },
  { value: "archived", label: "Archived" },
];

type TabId = "addresses" | "history";

export function TerritoryDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const intl = useIntl();
  const token = user?.access_token ?? "";

  const [territory, setTerritory] = useState<TerritoryListItem | null>(null);
  const [neighbors, setNeighbors] = useState<TerritoryListItem[]>([]);
  const [congBoundary, setCongBoundary] = useState<TerritoryListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("addresses");
  const { can } = usePermissions();

  // Edit / creation state
  const [editMode, setEditMode] = useState(false);
  const [editCoords, setEditCoords] = useState<[number, number][]>([]);
  const [saving, setSaving] = useState(false);
  const vertexMarkersRef = useRef<Marker[]>([]);
  const [creationMode, setCreationMode] = useState(false);
  const [autoFixResult, setAutoFixResult] = useState<AutoFixResult | null>(null);
  const [pendingBoundaries, setPendingBoundaries] = useState<unknown>(null);
  const [editViolations, setEditViolations] = useState<TerritoryViolation | null>(null);
  const [autoFixing, setAutoFixing] = useState(false);

  // Kebab menu + delete boundary state
  const [kebabOpen, setKebabOpen] = useState(false);
  const [showDeleteBoundaryModal, setShowDeleteBoundaryModal] = useState(false);
  const [deletingBoundary, setDeletingBoundary] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Clip mode state
  const [clipMode, setClipMode] = useState(false);
  const [clipSnapTargets, setClipSnapTargets] = useState<SnapTarget[]>([]);
  const [clipLoading, setClipLoading] = useState(false);
  const clipMarkersRef = useRef<Marker[]>([]);
  // Clip preview — shows clipped polygon for user approval before saving
  const [clipPreviewCoords, setClipPreviewCoords] = useState<[number, number][] | null>(null);
  // Cache snap context so Overpass is only called once per page load
  const snapContextCacheRef = useRef<any>(null);

  // Clip segment hook — initialized with current editCoords and snap targets
  const clipSegment = useClipSegment(editCoords, clipSnapTargets);
  // Ref to always access latest selectVertex (avoids stale closure in click handlers)
  const clipSelectVertexRef = useRef(clipSegment.selectVertex);
  clipSelectVertexRef.current = clipSegment.selectVertex;

  // Address state
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressLoading, setAddressLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AddressStatus | "all">("all");
  const [editingBellCount, setEditingBellCount] = useState<string | null>(null);
  const [bellCountValue, setBellCountValue] = useState("");
  const [editingStatus, setEditingStatus] = useState<string | null>(null);
  const [editingLanguage, setEditingLanguage] = useState<string | null>(null);
  const [languageValue, setLanguageValue] = useState("");

  // Map
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const { isLoaded, mapRef, addSource, addLayer, fitBounds, activeStyle, changeStyle, onStyleReady, maplibreModule } = useMapLibre({
    container: mapContainerRef,
    center: [11.38, 47.75],
    zoom: 14,
  });
  const layerAdded = useRef(false);
  const territoryRef = useRef<TerritoryListItem | null>(null);
  const gps = useGpsTracker();

  // Inject GPS marker CSS
  useEffect(() => {
    const styleId = "my-location-marker-style";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = MY_LOCATION_MARKER_CSS;
      document.head.appendChild(style);
    }
  }, []);

  // ─── Fetch territory ─────────────────────────────────────────

  useEffect(() => {
    if (!token || !id) return;
    Promise.all([
      getTerritory(id, token),
      listTerritories(token),
      listTerritories(token, { type: "congregation_boundary" }),
    ])
      .then(([t, allTerritories, congBounds]) => {
        setTerritory(t);
        territoryRef.current = t;
        // Neighbors = all territories with boundaries except current and congregation boundary
        setNeighbors(allTerritories.filter((n) => n.id !== id && n.boundaries && n.type !== "congregation_boundary"));
        setCongBoundary(congBounds[0] ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load territory"))
      .finally(() => setLoading(false));
  }, [token, id]);

  // ─── Fetch addresses ─────────────────────────────────────────

  const fetchAddresses = useCallback(async () => {
    if (!token || !id) return;
    setAddressLoading(true);
    try {
      const res = await listAddresses(id, token, {});
      // API returns raw array or { addresses: [...] } — handle both
      const list = Array.isArray(res) ? res : (res.addresses ?? []);
      setAddresses(list);
    } catch {
      // silently fail
    } finally {
      setAddressLoading(false);
    }
  }, [token, id]);

  useEffect(() => {
    if (id) void fetchAddresses();
  }, [fetchAddresses, id]);

  // ─── Map layers ──────────────────────────────────────────────

  const addBoundaryLayers = useCallback(() => {
    const t = territoryRef.current;
    if (!t?.boundaries) return;

    // Congregation boundary — red dashed line (render first, below everything)
    if (congBoundary?.boundaries) {
      addSource("cong-boundary", {
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: { name: congBoundary.name },
          geometry: congBoundary.boundaries,
        }],
      });
      addLayer({
        id: "cong-boundary-line", type: "line", source: "cong-boundary",
        paint: { "line-color": "#ef4444", "line-width": 2.5, "line-dasharray": [4, 3] },
      });
    }

    // Neighbor territories — subtle grey fill + border
    const neighborFeatures = neighbors
      .filter((n) => n.boundaries)
      .map((n) => ({
        type: "Feature" as const,
        properties: { number: n.number, name: n.name },
        geometry: n.boundaries,
      }));
    if (neighborFeatures.length > 0) {
      addSource("neighbors", { type: "FeatureCollection", features: neighborFeatures });
      addLayer({
        id: "neighbors-fill", type: "fill", source: "neighbors",
        paint: { "fill-color": "rgba(100, 116, 139, 0.12)", "fill-opacity": 0.8 },
      });
      addLayer({
        id: "neighbors-outline", type: "line", source: "neighbors",
        paint: { "line-color": "#94a3b8", "line-width": 1.5 },
      });
      addLayer({
        id: "neighbors-labels", type: "symbol", source: "neighbors",
        layout: { "text-field": ["get", "number"], "text-size": 11, "text-font": ["Open Sans Bold"], "text-allow-overlap": false },
        paint: { "text-color": "#94a3b8", "text-halo-color": "#ffffff", "text-halo-width": 1 },
      });
    }

    // Current territory — amber fill (on top)
    addSource("territory", {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { number: t.number },
        geometry: t.boundaries,
      }],
    });

    addLayer({
      id: "territory-fill", type: "fill", source: "territory",
      paint: { "fill-color": "rgba(217, 119, 6, 0.25)", "fill-opacity": 0.8 },
    });
    addLayer({
      id: "territory-outline", type: "line", source: "territory",
      paint: { "line-color": "#b45309", "line-width": 3 },
    });
    addLayer({
      id: "territory-label", type: "symbol", source: "territory",
      layout: { "text-field": ["get", "number"], "text-size": 16, "text-font": ["Open Sans Bold"] },
      paint: { "text-color": "#1e293b", "text-halo-color": "#ffffff", "text-halo-width": 2 },
    });

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
    flatten((t.boundaries as { coordinates: unknown }).coordinates);
    if (minLng < 180) fitBounds([[minLng, minLat], [maxLng, maxLat]]);
  }, [addSource, addLayer, fitBounds, neighbors, congBoundary]);

  useEffect(() => {
    onStyleReady(() => {
      layerAdded.current = false;
      addBoundaryLayers();
      layerAdded.current = true;
    });
  }, [onStyleReady, addBoundaryLayers]);

  useEffect(() => {
    if (!isLoaded || !territory?.boundaries || layerAdded.current) return;
    addBoundaryLayers();
    layerAdded.current = true;
  }, [isLoaded, territory, addBoundaryLayers]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && isLoaded) {
      const timer = setTimeout(() => map.resize(), 350);
      return () => clearTimeout(timer);
    }
  }, [mapExpanded, mapRef, isLoaded]);

  // ─── Polygon edit mode — vertex markers ─────────────────────

  /** Extract ring coordinates from territory boundaries */
  const extractRing = useCallback((boundaries: unknown): [number, number][] => {
    const b = boundaries as { type?: string; coordinates?: unknown };
    let ring: number[][] | undefined;
    if (b?.type === "MultiPolygon") {
      const polys = b.coordinates as number[][][][];
      if (polys.length > 0) {
        // Take the largest polygon's outer ring
        const largest = polys.reduce((a, c) =>
          (a[0]?.length ?? 0) >= (c[0]?.length ?? 0) ? a : c
        );
        ring = largest[0];
      }
    } else {
      ring = (b?.coordinates as number[][][])?.[0];
    }
    if (!ring || ring.length < 3) return [];
    return ring.map((c) => [c[0]!, c[1]!] as [number, number]);
  }, []);

  /** Enter edit mode — extract vertices, show markers, fetch violations */
  const enterEditMode = useCallback(() => {
    if (!territory?.boundaries) return;
    const ring = extractRing(territory.boundaries);
    if (ring.length < 3) return;
    setEditCoords(ring);
    setEditMode(true);
    setMapExpanded(true);
    // Fetch violations for this territory
    if (token && territory.id) {
      getViolations(token)
        .then((all) => {
          const mine = all.find((v) => v.territoryId === territory.id);
          setEditViolations(mine ?? null);
        })
        .catch(() => setEditViolations(null));
    }
  }, [territory, extractRing, token]);

  /** Update the map polygon source with current editCoords */
  const updateMapPolygon = useCallback((coords: [number, number][]) => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource("territory") as { setData?: (d: unknown) => void } | undefined;
    if (src?.setData) {
      src.setData({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: { number: territory?.number ?? "" },
          geometry: { type: "Polygon", coordinates: [coords] },
        }],
      });
    }
  }, [mapRef, territory?.number]);

  /** Enter clip mode — fetch snap context, extract vertices, activate clip tool */
  const enterClipMode = useCallback(async () => {
    if (!territory?.boundaries || !token || clipLoading) return;
    const ring = extractRing(territory.boundaries);
    if (ring.length < 3) return;

    setClipLoading(true);
    setMapExpanded(true);
    setEditCoords(ring);

    try {
      // Build targets from neighbors + congregation boundary (always available, no API call)
      const targets: SnapTarget[] = [];

      // Add neighbor territory boundaries as snap targets
      for (const n of neighbors) {
        if (n.boundaries) {
          targets.push({
            type: "neighbor",
            label: `Territory #${n.number}`,
            geometry: n.boundaries as SnapTarget["geometry"],
          });
        }
      }

      // Add congregation boundary if available
      if (congBoundary?.boundaries) {
        targets.push({
          type: "boundary",
          label: "Congregation boundary",
          geometry: congBoundary.boundaries as SnapTarget["geometry"],
        });
      }

      // Fetch snap context (roads, local streets, water) — cached after successful fetch
      try {
        let ctx = snapContextCacheRef.current;
        if (!ctx) {
          const lngs = ring.map((c) => c[0]);
          const lats = ring.map((c) => c[1]);
          const pad = 0.005; // ~500m padding
          const bbox = `${Math.min(...lngs) - pad},${Math.min(...lats) - pad},${Math.max(...lngs) + pad},${Math.max(...lats) + pad}`;
          ctx = await getSnapContext(bbox, token);
        }

        // Convert road + local_street features to SnapTargets
        const features = (ctx as any)?.features ?? (ctx as any)?.roads?.features ?? [];
        let hasRoads = false;
        for (const f of features) {
          const snapType = f.properties?.snapType;
          if (snapType === "road" || snapType === "local_street") {
            targets.push({
              type: "road",
              label: f.properties?.name ?? "Road",
              geometry: f.geometry as SnapTarget["geometry"],
            });
            hasRoads = true;
          }
        }
        // Only cache if we actually got road data (avoid caching Overpass timeouts)
        if (hasRoads) {
          snapContextCacheRef.current = ctx;
        }
      } catch (roadErr) {
        console.warn("Road data unavailable (Overpass timeout/rate-limit), continuing with neighbors only:", roadErr);
      }

      setClipSnapTargets(targets);
      setClipMode(true);
    } catch (err) {
      console.error("Failed to enter clip mode:", err);
    } finally {
      setClipLoading(false);
    }
  }, [territory, extractRing, token, neighbors, congBoundary, clipLoading]);

  // Start clip workflow when clip mode activates
  const clipStart = clipSegment.start;
  const clipPhase = clipSegment.phase;
  useEffect(() => {
    if (clipMode && clipPhase === "idle") {
      clipStart();
    }
  }, [clipMode, clipPhase, clipStart]);

  /** Cancel clip mode — clean up markers, restore original polygon */
  const cancelClipMode = useCallback(() => {
    clipSegment.cancel();
    setClipMode(false);
    setClipSnapTargets([]);
    setEditCoords([]);
    setMapExpanded(false);
    clipMarkersRef.current.forEach((m) => m.remove());
    clipMarkersRef.current = [];
    // Restore original polygon
    if (territory?.boundaries) {
      updateMapPolygon(extractRing(territory.boundaries));
    }
  }, [clipSegment, territory, updateMapPolygon, extractRing]);

  /** Auto-fix: run preview-fix on current polygon to resolve violations */
  const runAutoFix = useCallback(async () => {
    if (!token || !territory || editCoords.length < 4) return;
    setAutoFixing(true);
    try {
      const boundaries = { type: "Polygon", coordinates: [editCoords] };
      const result = await previewFix(token, territory.id, boundaries);
      if (result.geometryModified) {
        // Update polygon to the clipped version
        const clipped = result.clipped as { type?: string; coordinates?: number[][][] };
        if (clipped?.coordinates?.[0]) {
          const newRing = clipped.coordinates[0].map((c: number[]) => [c[0]!, c[1]!] as [number, number]);
          setEditCoords(newRing);
          updateMapPolygon(newRing);
        }
        setEditViolations(null); // Violations resolved
      }
    } catch (err) {
      console.error("Auto-fix failed:", err);
    } finally {
      setAutoFixing(false);
    }
  }, [token, territory, editCoords, updateMapPolygon]);

  /** Create draggable vertex markers + midpoint handles */
  useEffect(() => {
    const map = mapRef.current;
    const mgl = maplibreModule.current;
    if (!map || !mgl || !editMode || editCoords.length < 3) return;

    // Hide vertex markers while auto-fix dialog is open
    if (autoFixResult) {
      vertexMarkersRef.current.forEach((m) => m.remove());
      vertexMarkersRef.current = [];
      return;
    }

    // Clean old markers
    vertexMarkersRef.current.forEach((m) => m.remove());
    vertexMarkersRef.current = [];

    // Skip closing vertex (last = first)
    const uniqueCount = editCoords.length > 1 &&
      editCoords[0]![0] === editCoords[editCoords.length - 1]![0] &&
      editCoords[0]![1] === editCoords[editCoords.length - 1]![1]
      ? editCoords.length - 1
      : editCoords.length;

    // Use the same maplibre-gl module instance that created the map
    const MarkerClass = mgl.Marker || mgl.default?.Marker;
    if (!MarkerClass) {
      console.warn("Marker class not found in maplibre-gl module");
      return;
    }

    // ── Vertex markers (amber circles) ──
    for (let i = 0; i < uniqueCount; i++) {
      const coord = editCoords[i]!;
      const el = document.createElement("div");
      el.style.cssText = `
        width: 12px; height: 12px; border-radius: 50%;
        background: #f59e0b; border: 2px solid white;
        cursor: grab; box-shadow: 0 1px 4px rgba(0,0,0,0.4);
        z-index: 10;
      `;

      const marker = new MarkerClass({ element: el, draggable: true })
        .setLngLat([coord[0], coord[1]])
        .addTo(map as any);

      const idx = i;
      marker.on("drag", () => {
        const lngLat = marker.getLngLat();
        setEditCoords((prev) => {
          const next = [...prev];
          next[idx] = [lngLat.lng, lngLat.lat];
          // Keep ring closed
          if (idx === 0 && next.length > 1) {
            next[next.length - 1] = [lngLat.lng, lngLat.lat];
          }
          return next;
        });
      });

      vertexMarkersRef.current.push(marker);
    }

    // ── Midpoint handles (small grey "+" circles between vertices) ──
    for (let i = 0; i < uniqueCount; i++) {
      const a = editCoords[i]!;
      const b = editCoords[(i + 1) % uniqueCount]!;
      const midLng = (a[0] + b[0]) / 2;
      const midLat = (a[1] + b[1]) / 2;

      const el = document.createElement("div");
      el.style.cssText = `
        width: 10px; height: 10px; border-radius: 50%;
        background: rgba(100,116,139,0.6); border: 1.5px dashed white;
        cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        z-index: 9; display: flex; align-items: center; justify-content: center;
        font-size: 8px; color: white; font-weight: 700; line-height: 1;
      `;
      el.textContent = "+";
      el.title = "Drag to add vertex";

      const marker = new MarkerClass({ element: el, draggable: true })
        .setLngLat([midLng, midLat])
        .addTo(map as any);

      const insertAfter = i; // insert new point after index i (before i+1)
      marker.on("dragend", () => {
        const lngLat = marker.getLngLat();
        setEditCoords((prev) => {
          const next = [...prev];
          // Insert new vertex after the current index (+1 because ring is closed)
          next.splice(insertAfter + 1, 0, [lngLat.lng, lngLat.lat]);
          // Update closing vertex
          if (next.length > 1) {
            next[next.length - 1] = [next[0]![0], next[0]![1]];
          }
          return next;
        });
      });

      vertexMarkersRef.current.push(marker);
    }

    return () => {
      vertexMarkersRef.current.forEach((m) => m.remove());
      vertexMarkersRef.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, editCoords.length, mapRef, maplibreModule, autoFixResult]);

  /** Live-update polygon on map as vertices are dragged */
  useEffect(() => {
    if (!editMode || editCoords.length < 3) return;
    updateMapPolygon(editCoords);
  }, [editMode, editCoords, updateMapPolygon]);

  /** Clip mode — create vertex markers once when entering clip mode */
  useEffect(() => {
    const map = mapRef.current;
    const mgl = maplibreModule.current;
    if (!map || !mgl || !clipMode || editCoords.length < 3) {
      clipMarkersRef.current.forEach((m) => m.remove());
      clipMarkersRef.current = [];
      return;
    }

    // Only create markers if we don't have any yet
    if (clipMarkersRef.current.length > 0) return;

    const MarkerClass = mgl.Marker || mgl.default?.Marker;
    if (!MarkerClass) return;

    // Skip closing vertex
    const uniqueCount = editCoords.length > 1 &&
      editCoords[0]![0] === editCoords[editCoords.length - 1]![0] &&
      editCoords[0]![1] === editCoords[editCoords.length - 1]![1]
      ? editCoords.length - 1
      : editCoords.length;

    for (let i = 0; i < uniqueCount; i++) {
      const coord = editCoords[i]!;

      // Outer container — MapLibre controls its `transform` for positioning.
      // We must NEVER set `transform` on this element or MapLibre loses the position.
      const container = document.createElement("div");
      container.className = "clip-vertex";
      container.dataset.vertexIndex = String(i);
      container.style.cssText = "cursor: pointer; z-index: 10; padding: 4px;";

      // Inner dot — safe to style freely (background, border, scale)
      const dot = document.createElement("div");
      dot.style.cssText = `
        width: 14px; height: 14px; border-radius: 50%;
        background: rgba(255,255,255,0.9); border: 2px solid #64748b;
        box-shadow: 0 1px 4px rgba(0,0,0,0.4);
        transition: transform 0.15s, background 0.15s, border-color 0.15s;
        pointer-events: none;
      `;
      container.appendChild(dot);

      container.addEventListener("mouseenter", () => { dot.style.transform = "scale(1.3)"; });
      container.addEventListener("mouseleave", () => { dot.style.transform = "scale(1)"; });

      const marker = new MarkerClass({ element: container, draggable: false })
        .setLngLat([coord[0], coord[1]])
        .addTo(map as any);

      const idx = i;
      container.addEventListener("click", (e) => {
        e.stopPropagation();
        clipSelectVertexRef.current(idx);
      });

      clipMarkersRef.current.push(marker);
    }

    return () => {
      clipMarkersRef.current.forEach((m) => m.remove());
      clipMarkersRef.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipMode, editCoords.length, mapRef, maplibreModule]);

  /** Clip mode — update vertex marker styles when selection changes (no marker recreation) */
  useEffect(() => {
    if (!clipMode) return;
    const startIdx = clipSegment.startIndex;
    const endIdx = clipSegment.endIndex;

    clipMarkersRef.current.forEach((marker) => {
      const container = marker.getElement();
      const dot = container.querySelector("div") as HTMLDivElement | null;
      if (!dot) return;
      const idx = parseInt(container.dataset.vertexIndex ?? "-1", 10);
      const isStart = idx === startIdx;
      const isEnd = idx === endIdx;

      dot.style.background = isStart ? "#f59e0b" : isEnd ? "#22c55e" : "rgba(255,255,255,0.9)";
      dot.style.borderColor = isStart ? "#92400e" : isEnd ? "#166534" : "#64748b";
      container.title = isStart ? "Start vertex (A)" : isEnd ? "End vertex (B)" : "Click to select";
    });
  }, [clipMode, clipSegment.startIndex, clipSegment.endIndex]);

  /** Live-update polygon on map during clip mode */
  useEffect(() => {
    if (!clipMode || editCoords.length < 3) return;
    updateMapPolygon(editCoords);
  }, [clipMode, editCoords, updateMapPolygon]);

  /** Remove clip preview layers safely */
  const removeClipPreview = useCallback((map: any) => {
    if (!map) return;
    if (map.getLayer("clip-preview-fill")) map.removeLayer("clip-preview-fill");
    if (map.getLayer("clip-preview-outline")) map.removeLayer("clip-preview-outline");
    if (map.getSource("clip-preview")) map.removeSource("clip-preview");
  }, []);

  /** Show clipped boundary preview when auto-fix dialog is open */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pendingBoundaries || !autoFixResult) {
      removeClipPreview(map);
      return;
    }
    // Show the clipped polygon as a green overlay
    const geo = pendingBoundaries as { type?: string; coordinates?: number[][][] };
    if (!geo?.coordinates) return;

    removeClipPreview(map);

    map.addSource("clip-preview", {
      type: "geojson",
      data: { type: "Feature", properties: {}, geometry: pendingBoundaries },
    } as object);
    map.addLayer({
      id: "clip-preview-fill", type: "fill", source: "clip-preview",
      paint: { "fill-color": "rgba(34, 197, 94, 0.3)", "fill-opacity": 0.8 },
    } as object);
    map.addLayer({
      id: "clip-preview-outline", type: "line", source: "clip-preview",
      paint: { "line-color": "#16a34a", "line-width": 3, "line-dasharray": [3, 2] },
    } as object);

    // Also update the territory polygon to show the original (for comparison)
    updateMapPolygon(editCoords);

    return () => removeClipPreview(map);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBoundaries, autoFixResult, mapRef, removeClipPreview]);

  /** Save edited polygon — calls preview-fix then saves */
  const handleEditSave = useCallback(async () => {
    if (!token || !territory || editCoords.length < 4) return;
    setSaving(true);
    try {
      const boundaries = { type: "Polygon", coordinates: [editCoords] };
      const result = await previewFix(token, territory.id, boundaries);
      if (result.geometryModified) {
        // Show auto-fix preview dialog
        setAutoFixResult(result);
        setPendingBoundaries(result.clipped);
      } else {
        // No clipping needed — save directly
        await updateTerritoryBoundaries(token, territory.id, result.clipped);
        setEditMode(false);
        setEditViolations(null);
        vertexMarkersRef.current.forEach((m) => m.remove());
        vertexMarkersRef.current = [];
        const refreshed = await getTerritory(territory.id, token);
        setTerritory(refreshed);
        territoryRef.current = refreshed;
        layerAdded.current = false;
      }
    } catch (err) {
      console.error("Edit save failed:", err);
    } finally {
      setSaving(false);
    }
  }, [token, territory, editCoords]);

  /** Cancel edit — restore original polygon */
  const cancelEdit = useCallback(() => {
    setEditMode(false);
    setEditViolations(null);
    vertexMarkersRef.current.forEach((m) => m.remove());
    vertexMarkersRef.current = [];
    // Restore original polygon on map
    if (territory?.boundaries) {
      updateMapPolygon(extractRing(territory.boundaries));
    }
  }, [territory, updateMapPolygon, extractRing]);

  // ─── Delete boundary handler ─────────────────────────────────

  const handleDeleteBoundary = useCallback(async () => {
    if (!token || !territory) return;
    setDeletingBoundary(true);
    try {
      await deleteBoundary(token, territory.id);
      setShowDeleteBoundaryModal(false);
      setKebabOpen(false);
      // Refresh territory data
      const updated = await getTerritory(territory.id, token);
      setTerritory(updated);
      // Show success message
      setSuccessMessage(intl.formatMessage({ id: "territory.boundary.delete.success" }));
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error("Delete boundary failed:", err);
      setError(err instanceof Error ? err.message : "Failed to delete boundary");
    } finally {
      setDeletingBoundary(false);
    }
  }, [token, territory]);

  // ─── Inline edit handlers ────────────────────────────────────

  const handleSaveBellCount = async (addr: Address) => {
    const val = bellCountValue.trim() === "" ? null : parseInt(bellCountValue, 10);
    if (val !== null && isNaN(val)) return;
    try {
      await updateAddress(addr.territoryId!, addr.addressId, { bellCount: val } as Partial<Address>, token);
      setAddresses((prev) =>
        prev.map((a) => a.addressId === addr.addressId ? { ...a, bellCount: val } : a),
      );
    } catch {
      // silently fail
    }
    setEditingBellCount(null);
  };

  const handleStatusChange = async (addr: Address, newStatus: AddressStatus) => {
    try {
      await updateAddress(addr.territoryId!, addr.addressId, { status: newStatus } as Partial<Address>, token);
      setAddresses((prev) =>
        prev.map((a) => a.addressId === addr.addressId ? { ...a, status: newStatus } : a),
      );
    } catch {
      // silently fail
    }
    setEditingStatus(null);
  };

  const handleSaveLanguage = async (addr: Address) => {
    const val = languageValue.trim() || null;
    try {
      await updateAddress(addr.territoryId!, addr.addressId, { languageSpoken: val } as Partial<Address>, token);
      setAddresses((prev) =>
        prev.map((a) => a.addressId === addr.addressId ? { ...a, languageSpoken: val } : a),
      );
    } catch {
      // silently fail
    }
    setEditingLanguage(null);
  };

  // ─── Derived values ──────────────────────────────────────────

  const hasBoundary = !!territory?.boundaries;

  // ─── Boundary save with auto-fix preview ────────────────────
  const handleBoundarySave = async (boundaries: unknown) => {
    if (!token || !territory) return;
    try {
      const result = await previewFix(token, territory.id, boundaries);
      if (result.geometryModified) {
        setAutoFixResult(result);
        setPendingBoundaries(result.clipped);
      } else {
        await saveBoundary(result.clipped);
      }
    } catch (err) {
      console.error("Preview fix failed:", err);
    }
  };

  const saveBoundary = async (boundaries: unknown) => {
    if (!token || !territory) return;
    await updateTerritoryBoundaries(token, territory.id, boundaries);
    setEditMode(false);
    vertexMarkersRef.current.forEach((m) => m.remove());
    vertexMarkersRef.current = [];
    setCreationMode(false);
    setAutoFixResult(null);
    setPendingBoundaries(null);
    const refreshed = await getTerritory(territory.id, token);
    setTerritory(refreshed);
    territoryRef.current = refreshed;
    // Force map to re-render the updated polygon
    layerAdded.current = false;
  };

  const handleCreationComplete = (coords: [number, number][]) => {
    // coords is already a closed ring from CreationFlow
    const geojson = { type: "Polygon", coordinates: [coords] };
    handleBoundarySave(geojson);
  };
  const activeAssignment = territory?.assignments?.find((a) => !a.returnedAt);
  const pastAssignments = territory?.assignments?.filter((a) => a.returnedAt) ?? [];

  // Address filtering
  const filteredAddresses = addresses
    .filter((a) => {
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (a.status === "archived") return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          a.streetAddress.toLowerCase().includes(q) ||
          (a.apartment?.toLowerCase().includes(q) ?? false) ||
          (a.city?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  // Address stats
  const totalAddresses = addresses.filter((a) => a.status !== "archived").length;
  const dncCount = addresses.filter((a) => a.status === "do_not_call").length;
  const notAtHomeCount = addresses.filter((a) => a.status === "not_at_home").length;
  const totalBells = addresses.reduce((sum, a) => sum + (a.bellCount ?? 1), 0);

  // ─── Loading / error ─────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="text-[var(--amber)] animate-spin" />
      </div>
    );
  }

  if (error || !territory) {
    return (
      <div className="space-y-4">
        <button onClick={() => navigate("/territories")} className="p-2 text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer">
          <ArrowLeft size={18} />
        </button>
        <p className="text-sm text-[var(--red)]">{error ?? "Territory not found"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/territories")}
          className="p-2 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-[var(--text)]">
            <span className="text-[var(--amber)] font-mono">#{territory.number}</span>
            {" "}
            {territory.name}
          </h1>
          {territory.description && (
            <p className="text-sm text-[var(--text-muted)] mt-0.5">{territory.description}</p>
          )}
        </div>
        <button
          onClick={() => navigate("/territories/map")}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
        >
          <Layers size={14} />
          <FormattedMessage id="territories.viewOnMap" defaultMessage="View on Map" />
        </button>
      </div>

      {/* Content grid */}
      <div className={mapExpanded ? "space-y-6" : "grid grid-cols-1 lg:grid-cols-3 gap-6"}>
        {/* Map panel */}
        <div className={`${mapExpanded ? "" : "lg:col-span-2"} border border-[var(--border)] rounded-[var(--radius)] overflow-hidden bg-[var(--bg-1)] relative`}>
          <div
            ref={mapContainerRef}
            className={`w-full transition-[height] duration-300 ${
              hasBoundary || creationMode
                ? mapExpanded ? "h-[70vh]" : "h-80"
                : "h-0 overflow-hidden"
            }`}
          />

          {!hasBoundary && !creationMode && (
            <div className="h-80 flex items-center justify-center">
              <div className="text-center">
                <MapPin size={36} className="text-[var(--text-muted)] mx-auto mb-3" strokeWidth={1.5} />
                <p className="text-sm text-[var(--text-muted)] mb-3">
                  <FormattedMessage id="territories.noBoundary" defaultMessage="No boundary defined" />
                </p>
                {can("app:territories.edit") && (
                  <button
                    onClick={() => setCreationMode(true)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-[var(--amber)] text-black rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors mx-auto"
                  >
                    <MapPin size={16} />
                    <FormattedMessage id="territories.drawBoundary" defaultMessage="Draw Boundary" />
                  </button>
                )}
              </div>
            </div>
          )}

          {creationMode && !hasBoundary && isLoaded && (
            <CreationFlow
              map={mapRef.current}
              onComplete={handleCreationComplete}
              onCancel={() => setCreationMode(false)}
            />
          )}

          {hasBoundary && isLoaded && (
            <>
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
              <div className="absolute top-3 right-3 z-10 flex gap-1.5">
                <button
                  onClick={gps.toggle}
                  title={gps.active ? "Disable GPS" : "Enable GPS"}
                  className={`p-2 rounded-[var(--radius-sm)] border border-[var(--border)] transition-colors cursor-pointer shadow-lg ${
                    gps.active
                      ? "bg-[var(--blue)] text-white"
                      : "bg-[var(--bg-1)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)]"
                  }`}
                >
                  <MapPin size={16} />
                </button>
                <button
                  onClick={() => navigate(`/territories/${id}/field-work`)}
                  className="px-2.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--blue)] text-white text-[11px] font-semibold border border-[var(--blue)] hover:opacity-90 transition-opacity cursor-pointer shadow-lg"
                >
                  Field Work
                </button>
                {clipMode ? (
                  <>
                    {/* Clip mode status HUD */}
                    <div className="px-2.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--bg-1)] border border-[var(--amber)]/40 text-[10px] font-medium text-[var(--amber)] shadow-lg">
                      <Crop size={11} className="inline mr-1" />
                      {clipSegment.phase === "select_start" && "Click first vertex"}
                      {clipSegment.phase === "select_end" && "Click second vertex"}
                      {clipSegment.phase === "choose_target" && "Choose clip target"}
                    </div>
                    <button
                      onClick={cancelClipMode}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--bg-1)] border border-[var(--border)] text-[var(--text-muted)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer shadow-lg"
                    >
                      <X size={13} />
                      Cancel
                    </button>
                  </>
                ) : !editMode ? (
                  <>
                    <button
                      onClick={() => {
                        if (can("app:territories.edit")) enterEditMode();
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[var(--radius-sm)] transition-colors shadow-lg ${
                        can("app:territories.edit")
                          ? "bg-amber-500/80 text-black hover:bg-amber-400 cursor-pointer"
                          : "bg-[var(--bg-1)] text-[var(--text-muted)] opacity-50 cursor-not-allowed"
                      }`}
                    >
                      <Edit3 size={13} />
                      <FormattedMessage id="territories.edit" defaultMessage="Edit" />
                    </button>
                    <button
                      onClick={() => {
                        if (can("app:territories.edit")) enterClipMode();
                      }}
                      disabled={clipLoading}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[var(--radius-sm)] transition-colors shadow-lg ${
                        can("app:territories.edit") && !clipLoading
                          ? "bg-[var(--bg-1)] border border-[var(--amber)]/40 text-[var(--amber)] hover:bg-[var(--amber)]/10 cursor-pointer"
                          : "bg-[var(--bg-1)] text-[var(--text-muted)] opacity-50 cursor-not-allowed"
                      }`}
                    >
                      <Crop size={13} />
                      {clipLoading ? "Loading..." : "Clip"}
                    </button>
                    {can("app:territories.export") && territory?.boundaries && (
                      <ExportDropdown territories={[territory]} compact />
                    )}
                    {/* Kebab menu */}
                    {can("app:territories.edit") && territory?.boundaries && (
                      <div className="relative">
                        <button
                          onClick={() => setKebabOpen((v) => !v)}
                          className="p-2 rounded-[var(--radius-sm)] bg-[var(--bg-1)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer shadow-lg"
                        >
                          <MoreVertical size={16} />
                        </button>
                        {kebabOpen && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setKebabOpen(false)} />
                            <div className="absolute right-0 top-full mt-1 z-50 bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] shadow-xl min-w-[180px]">
                              <button
                                onClick={() => { setKebabOpen(false); setShowDeleteBoundaryModal(true); }}
                                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                              >
                                <Trash2 size={13} />
                                <FormattedMessage id="territory.boundary.delete" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    <button
                      onClick={() => setMapExpanded((v) => !v)}
                      className="p-2 rounded-[var(--radius-sm)] bg-[var(--bg-1)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer shadow-lg"
                    >
                      {mapExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={handleEditSave}
                      disabled={saving}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[var(--green)] text-black rounded-[var(--radius-sm)] hover:opacity-90 transition-opacity cursor-pointer shadow-lg disabled:opacity-50"
                    >
                      <Save size={13} />
                      {saving ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--bg-1)] border border-[var(--border)] text-[var(--text-muted)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer shadow-lg"
                    >
                      <X size={13} />
                      Cancel
                    </button>
                  </>
                )}
              </div>

              {/* Edit-mode violation panel */}
              {editMode && editViolations && editViolations.violations.length > 0 && (
                <div className="absolute bottom-3 left-3 right-3 z-10 bg-[var(--bg-1)]/95 backdrop-blur border border-amber-500/40 rounded-[var(--radius)] p-3 shadow-xl">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-amber-400 mb-1">
                        <FormattedMessage id="territories.edit.violations" defaultMessage="Boundary issues detected" />
                      </p>
                      <ul className="space-y-0.5 mb-2">
                        {editViolations.violations.map((v, i) => (
                          <li key={i} className="text-[11px] text-[var(--text-muted)]">• {v}</li>
                        ))}
                      </ul>
                      <button
                        onClick={runAutoFix}
                        disabled={autoFixing}
                        className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold bg-amber-500/80 text-black rounded-[var(--radius-sm)] hover:bg-amber-400 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <Wand2 size={12} />
                        {autoFixing ? "Fixing..." : <FormattedMessage id="territories.edit.autoFix" defaultMessage="Auto-Fix" />}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Clip Segment target panel */}
              {clipMode && clipSegment.phase === "choose_target" && !clipPreviewCoords && (
                <ClipSegmentPanel
                  candidates={clipSegment.candidates}
                  onSelectCandidate={(candidate: ClipCandidate) => {
                    const newCoords = clipSegment.applyClip(candidate);
                    if (newCoords) {
                      setClipPreviewCoords(newCoords);
                      // Show preview: update polygon to clipped version
                      updateMapPolygon(newCoords);
                      // Hide vertex markers during preview
                      clipMarkersRef.current.forEach((m) => m.remove());
                      clipMarkersRef.current = [];
                    }
                  }}
                  onStraighten={() => {
                    const newCoords = clipSegment.straighten();
                    if (newCoords) {
                      setClipPreviewCoords(newCoords);
                      updateMapPolygon(newCoords);
                      clipMarkersRef.current.forEach((m) => m.remove());
                      clipMarkersRef.current = [];
                    }
                  }}
                  onCancel={cancelClipMode}
                />
              )}

              {/* Clip preview approval — Save / Cancel */}
              {clipMode && clipPreviewCoords && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 bg-[var(--bg-1)] border border-[var(--border-2)] rounded-[var(--radius)] shadow-lg p-3 min-w-[260px]">
                  <p className="text-xs text-[var(--text-muted)] mb-2 text-center">Review the clipped boundary</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        // Save the clipped polygon
                        const boundaries = { type: "Polygon", coordinates: [clipPreviewCoords] };
                        if (token && territory) {
                          setSaving(true);
                          updateTerritoryBoundaries(token, territory.id, boundaries)
                            .then(async () => {
                              const refreshed = await getTerritory(territory.id, token);
                              setTerritory(refreshed);
                              territoryRef.current = refreshed;
                              layerAdded.current = false;
                              // Clean up clip mode AFTER save completes
                              setClipPreviewCoords(null);
                              setClipMode(false);
                              setClipSnapTargets([]);
                              setEditCoords([]);
                              setMapExpanded(false);
                              clipMarkersRef.current.forEach((m) => m.remove());
                              clipMarkersRef.current = [];
                            })
                            .catch((err) => console.error("Clip save failed:", err))
                            .finally(() => setSaving(false));
                        }
                      }}
                      disabled={saving}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[var(--green)] text-black rounded-[var(--radius-sm)] hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                    >
                      <Save size={13} />
                      {saving ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={() => {
                        setClipPreviewCoords(null);
                        // Restore original polygon
                        if (territory?.boundaries) {
                          updateMapPolygon(extractRing(territory.boundaries));
                        }
                        cancelClipMode();
                      }}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--bg-1)] border border-[var(--border)] text-[var(--text-muted)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
                    >
                      <X size={13} />
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <MyLocationMarker
                map={mapRef.current}
                lat={gps.lat}
                lng={gps.lng}
                heading={gps.heading}
                accuracy={gps.accuracy}
                visible={gps.active}
              />
            </>
          )}
        </div>

        {/* Info sidebar */}
        <div className={`space-y-4 ${mapExpanded ? "grid grid-cols-1 sm:grid-cols-3 gap-4 space-y-0" : ""}`}>
          <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3 flex items-center gap-2">
              <User size={12} />
              <FormattedMessage id="territories.currentAssignment" defaultMessage="Current Assignment" />
            </h3>
            {activeAssignment ? (
              <div className="flex items-center gap-3 p-3 rounded-[var(--radius-sm)] bg-[var(--glass)]">
                <div className="w-9 h-9 rounded-full bg-[var(--amber)] bg-opacity-20 flex items-center justify-center flex-shrink-0">
                  <User size={16} className="text-[var(--amber)]" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text)] truncate">
                    {activeAssignment.publisher.firstName} {activeAssignment.publisher.lastName}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    <FormattedMessage id="territories.since" defaultMessage="Since" />{" "}
                    <FormattedDate value={activeAssignment.assignedAt} />
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--glass)] text-center">
                <p className="text-sm text-[var(--text-muted)] italic">
                  <FormattedMessage id="territories.notAssigned" defaultMessage="Not assigned" />
                </p>
              </div>
            )}
          </div>

          {/* Stats row */}
          <div className={`${mapExpanded ? "flex gap-3" : "grid grid-cols-2 gap-3"}`}>
            <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-3 text-center flex-1">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <MapPin size={12} className="text-[var(--text-muted)]" />
                <p className="text-lg font-bold text-[var(--text)]">{totalAddresses}</p>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">
                <FormattedMessage id="territories.addresses" defaultMessage="Addresses" />
              </p>
            </div>
            <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-3 text-center flex-1">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Bell size={12} className="text-[var(--text-muted)]" />
                <p className="text-lg font-bold text-[var(--text)]">{totalBells}</p>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">
                <FormattedMessage id="territories.bellCount" defaultMessage="Doorbells" />
              </p>
            </div>
          </div>

          {/* Mini stats */}
          <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)] flex items-center gap-1.5">
                <Ban size={11} className="text-[var(--red)]" />
                <FormattedMessage id="territories.doNotCall" defaultMessage="Do Not Call" />
              </span>
              <span className="text-[var(--text)] font-mono">{dncCount}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)] flex items-center gap-1.5">
                <Home size={11} className="text-[var(--amber)]" />
                <FormattedMessage id="territories.notAtHome" defaultMessage="Not at Home" />
              </span>
              <span className="text-[var(--text)] font-mono">{notAtHomeCount}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)] flex items-center gap-1.5">
                <Hash size={11} />
                <FormattedMessage id="territories.totalAssignments" defaultMessage="Assignments" />
              </span>
              <span className="text-[var(--text)] font-mono">{territory.assignments?.length ?? 0}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)] flex items-center gap-1.5"><Clock size={11} /><FormattedMessage id="territories.created" defaultMessage="Created" /></span>
              <span className="text-[var(--text)]"><FormattedDate value={territory.createdAt} /></span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Tabs ──────────────────────────────────────────────── */}
      <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-[var(--border)]">
          {([
            { id: "addresses" as TabId, label: intl.formatMessage({ id: "territories.addresses", defaultMessage: "Addresses" }), count: totalAddresses },
            { id: "history" as TabId, label: intl.formatMessage({ id: "territories.assignmentHistory", defaultMessage: "Assignment History" }), count: pastAssignments.length },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 sm:flex-none px-6 py-3 text-sm font-medium transition-colors cursor-pointer border-b-2 ${
                activeTab === tab.id
                  ? "border-[var(--amber)] text-[var(--text)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)]"
              }`}
            >
              {tab.label}
              <span className="ml-2 text-xs text-[var(--text-muted)]">({tab.count})</span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "addresses" && (
          <div>
            {/* Address toolbar */}
            <div className="p-4 border-b border-[var(--border)] flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={intl.formatMessage({ id: "common.search", defaultMessage: "Search..." })}
                  className="w-full pl-8 pr-3 py-1.5 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
                />
              </div>
              <div className="flex items-center gap-2">
                <Filter size={12} className="text-[var(--text-muted)]" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as AddressStatus | "all")}
                  className="bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text)] text-xs cursor-pointer"
                >
                  <option value="all">{intl.formatMessage({ id: "common.all", defaultMessage: "All" })}</option>
                  <option value="active">Active</option>
                  <option value="do_not_call">Do Not Call</option>
                  <option value="not_at_home">Not at Home</option>
                  <option value="moved">Moved</option>
                  <option value="foreign_language">Foreign Language</option>
                </select>
              </div>
            </div>

            {/* Address table */}
            {addressLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={20} className="text-[var(--amber)] animate-spin" />
              </div>
            ) : filteredAddresses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
                <MapPin size={28} strokeWidth={1.2} className="mb-2" />
                <p className="text-xs">
                  <FormattedMessage id="territories.noAddresses" defaultMessage="No addresses found" />
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
                      <th className="text-left px-4 py-2 font-medium">#</th>
                      <th className="text-left px-4 py-2 font-medium">
                        <FormattedMessage id="territories.street" defaultMessage="Street" />
                      </th>
                      <th className="text-left px-4 py-2 font-medium">
                        <FormattedMessage id="territories.city" defaultMessage="City" />
                      </th>
                      <th className="text-center px-4 py-2 font-medium">
                        <Bell size={11} className="inline" />
                      </th>
                      <th className="text-left px-4 py-2 font-medium">
                        <FormattedMessage id="territories.status" defaultMessage="Status" />
                      </th>
                      <th className="text-left px-4 py-2 font-medium">
                        <FormattedMessage id="territories.language" defaultMessage="Language" />
                      </th>
                      <th className="text-left px-4 py-2 font-medium">
                        <FormattedMessage id="territories.lastVisit" defaultMessage="Last Visit" />
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {filteredAddresses.map((addr, idx) => {
                      const meta = STATUS_META[addr.status] ?? STATUS_META.active!;
                      const StatusIcon = meta.icon;
                      const TypeIcon = TYPE_ICONS[addr.type] ?? Home;

                      return (
                        <tr
                          key={addr.addressId}
                          className={`transition-colors hover:bg-[var(--glass)] ${meta.dimmed ? "opacity-60" : ""}`}
                        >
                          {/* Row number */}
                          <td className="px-4 py-2.5 text-xs text-[var(--text-muted)] font-mono">
                            {idx + 1}
                          </td>

                          {/* Street address */}
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <TypeIcon size={13} className="text-[var(--text-muted)] flex-shrink-0" />
                              <div className="min-w-0">
                                <div className="text-sm text-[var(--text)] truncate">
                                  {addr.streetAddress}
                                  {addr.apartment && (
                                    <span className="text-[var(--text-muted)] ml-1">/ {addr.apartment}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* City */}
                          <td className="px-4 py-2.5 text-xs text-[var(--text-muted)]">
                            {addr.postalCode} {addr.city}
                          </td>

                          {/* Bell count — inline editable */}
                          <td className="px-4 py-2.5 text-center">
                            {editingBellCount === addr.addressId ? (
                              <div className="flex items-center justify-center gap-1">
                                <input
                                  type="number"
                                  min={0}
                                  max={999}
                                  value={bellCountValue}
                                  onChange={(e) => setBellCountValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleSaveBellCount(addr);
                                    if (e.key === "Escape") setEditingBellCount(null);
                                  }}
                                  autoFocus
                                  className="w-12 px-1 py-0.5 text-xs text-center bg-[var(--bg)] border border-[var(--amber)] rounded text-[var(--text)] focus:outline-none"
                                />
                                <button onClick={() => handleSaveBellCount(addr)} className="text-[var(--green)] cursor-pointer">
                                  <Check size={12} />
                                </button>
                                <button onClick={() => setEditingBellCount(null)} className="text-[var(--text-muted)] cursor-pointer">
                                  <X size={12} />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  setEditingBellCount(addr.addressId);
                                  setBellCountValue(addr.bellCount?.toString() ?? "");
                                }}
                                className="px-2 py-0.5 text-xs font-mono text-[var(--text)] hover:bg-[var(--glass-2)] rounded cursor-pointer transition-colors"
                                title={intl.formatMessage({ id: "territories.editBellCount", defaultMessage: "Edit bell count" })}
                              >
                                {addr.bellCount ?? "–"}
                              </button>
                            )}
                          </td>

                          {/* Status — inline editable */}
                          <td className="px-4 py-2.5">
                            {editingStatus === addr.addressId ? (
                              <div className="relative">
                                <select
                                  value={addr.status}
                                  onChange={(e) => handleStatusChange(addr, e.target.value as AddressStatus)}
                                  onBlur={() => setEditingStatus(null)}
                                  autoFocus
                                  className="bg-[var(--bg)] border border-[var(--amber)] rounded px-2 py-0.5 text-xs text-[var(--text)] cursor-pointer focus:outline-none"
                                >
                                  {STATUS_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                  ))}
                                </select>
                              </div>
                            ) : (
                              <button
                                onClick={() => setEditingStatus(addr.addressId)}
                                className={`flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-[var(--glass-2)] cursor-pointer transition-colors ${meta.color}`}
                                title={intl.formatMessage({ id: "territories.changeStatus", defaultMessage: "Change status" })}
                              >
                                <StatusIcon size={13} />
                                <span className="text-xs">{meta.label}</span>
                                <ChevronDown size={10} className="text-[var(--text-muted)]" />
                              </button>
                            )}
                          </td>

                          {/* Language — inline editable */}
                          <td className="px-4 py-2.5">
                            {editingLanguage === addr.addressId ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  value={languageValue}
                                  onChange={(e) => setLanguageValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleSaveLanguage(addr);
                                    if (e.key === "Escape") setEditingLanguage(null);
                                  }}
                                  autoFocus
                                  placeholder="de, en, tr..."
                                  className="w-16 px-1 py-0.5 text-xs bg-[var(--bg)] border border-[var(--amber)] rounded text-[var(--text)] focus:outline-none"
                                />
                                <button onClick={() => handleSaveLanguage(addr)} className="text-[var(--green)] cursor-pointer">
                                  <Check size={12} />
                                </button>
                                <button onClick={() => setEditingLanguage(null)} className="text-[var(--text-muted)] cursor-pointer">
                                  <X size={12} />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  setEditingLanguage(addr.addressId);
                                  setLanguageValue(addr.languageSpoken ?? "");
                                }}
                                className="px-2 py-0.5 text-xs rounded hover:bg-[var(--glass-2)] cursor-pointer transition-colors"
                                title={intl.formatMessage({ id: "territories.setLanguage", defaultMessage: "Set language" })}
                              >
                                {addr.languageSpoken ? (
                                  <span className="px-1.5 py-0 rounded-full bg-[var(--glass)] text-[var(--blue)]">
                                    {addr.languageSpoken}
                                  </span>
                                ) : (
                                  <span className="text-[var(--text-muted)] italic">—</span>
                                )}
                              </button>
                            )}
                          </td>

                          {/* Last visit */}
                          <td className="px-4 py-2.5 text-xs text-[var(--text-muted)]">
                            {addr.lastVisitDate ? (
                              <div>
                                <div>{new Date(addr.lastVisitDate).toLocaleDateString()}</div>
                                {addr.lastVisitOutcome && (
                                  <div className="text-[10px]">
                                    {addr.lastVisitOutcome.replace(/_/g, " ")}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-[var(--text-muted)] italic">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === "history" && (
          <div>
            {pastAssignments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
                <Calendar size={28} strokeWidth={1.2} className="mb-2" />
                <p className="text-xs">
                  <FormattedMessage id="territories.noHistory" defaultMessage="No assignment history" />
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {pastAssignments.map((a) => (
                  <div key={a.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-[var(--glass)] flex items-center justify-center flex-shrink-0">
                      <User size={12} className="text-[var(--text-muted)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--text)] truncate">
                        {a.publisher.firstName} {a.publisher.lastName}
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">
                        <FormattedDate value={a.assignedAt} /> — <FormattedDate value={a.returnedAt!} />
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Version History */}
      {hasBoundary && territory && (
        <VersionHistory
          territoryId={territory.id}
          token={token}
          canEdit={can("app:territories.edit")}
          onRestore={(result) => {
            if (result.geometryModified) {
              setAutoFixResult(result);
              setPendingBoundaries(result.clipped);
            } else {
              saveBoundary(result.clipped);
            }
          }}
        />
      )}

      {/* Auto-Fix Preview dialog */}
      {autoFixResult && (
        <AutoFixPreview
          result={autoFixResult}
          onAccept={() => saveBoundary(pendingBoundaries)}
          onCancel={() => {
            setAutoFixResult(null);
            setPendingBoundaries(null);
          }}
        />
      )}

      {/* Success message banner */}
      {successMessage && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-green-500/20 border border-green-500/40 rounded-[var(--radius)] shadow-xl text-xs text-green-400 font-medium">
          {successMessage}
        </div>
      )}

      {/* Delete Boundary Confirmation Modal */}
      {showDeleteBoundaryModal && territory && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius)] p-6 max-w-md mx-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-[var(--text)] mb-3">
              <FormattedMessage id="territory.boundary.delete" />
            </h3>
            <p className="text-sm text-[var(--text-muted)] mb-6">
              <FormattedMessage
                id="territory.boundary.delete.confirm"
                values={{ number: territory.number, name: territory.name }}
              />
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteBoundaryModal(false)}
                disabled={deletingBoundary}
                className="px-4 py-2 text-xs font-medium border border-[var(--border)] text-[var(--text-muted)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
              >
                <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
              </button>
              <button
                onClick={handleDeleteBoundary}
                disabled={deletingBoundary}
                className="px-4 py-2 text-xs font-semibold bg-red-500 text-white rounded-[var(--radius-sm)] hover:bg-red-600 transition-colors cursor-pointer disabled:opacity-50"
              >
                {deletingBoundary ? "..." : <FormattedMessage id="territory.boundary.delete" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
