/**
 * Gap Detection page — split layout: map (left) + controls (right).
 * Shows uncovered buildings as markers on the map.
 * Click marker → ignore popup with reason.
 * Bulk select + ignore from list.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  AlertTriangle, Play, Loader2, CheckCircle2, XCircle,
  MapPin, EyeOff, ChevronRight, Trash2,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import {
  runGapDetection,
  getGapRuns,
  deleteGapRun,
  ignoreBuildings,
  listTerritories,
  populateAddressesFromOsm,
  type GapDetectionRun,
  type GeoJsonFeature,
  type TerritoryListItem,
  type OsmPopulateResult,
} from "@/lib/territory-api";
import { useMapLibre, MAP_STYLES, type MapStyleKey } from "@/hooks/useMapLibre";

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

  // ─── Map: add territory boundaries + congregation outline ────

  const addMapLayers = useCallback(() => {
    if (!territories.length) return;

    const congBoundary = territories.find((t) => t.type === "congregation_boundary" && t.boundaries);
    const regularTerritories = territories.filter((t) => t.type === "territory" && t.boundaries);

    // Territory fills
    if (!mapRef.current?.getSource("territories")) {
      addSource("territories", {
        type: "FeatureCollection",
        features: regularTerritories.map((t) => ({
          type: "Feature",
          properties: { number: t.number, name: t.name },
          geometry: t.boundaries,
        })),
      });

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
    try { map.removeLayer("gap-markers"); } catch { /* ok */ }
    try { map.removeLayer("gap-markers-border"); } catch { /* ok */ }
    try { map.removeSource("gaps"); } catch { /* ok */ }

    if (!run?.resultGeoJson || run.resultGeoJson.features.length === 0) return;

    addSource("gaps", run.resultGeoJson);

    // Orange/red circles for gap buildings
    addLayer({
      id: "gap-markers",
      type: "circle",
      source: "gaps",
      paint: {
        "circle-radius": 6,
        "circle-color": "#f97316",
        "circle-opacity": 0.85,
        "circle-stroke-color": "#b45309",
        "circle-stroke-width": 1.5,
      },
    });
  }, [addSource, addLayer, mapRef]);

  // ─── Map: click handler for gap markers ──────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded) return;

    const handleClick = (e: { point: { x: number; y: number }; lngLat: { lng: number; lat: number }; features?: Array<{ properties: Record<string, unknown> }> }) => {
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

  // ─── Map: initialize layers on style ready ───────────────────

  useEffect(() => {
    onStyleReady(() => {
      layersAdded.current = false;
      addMapLayers();
      layersAdded.current = true;
      const sel = runs.find((r) => r.id === selectedRunId);
      if (sel) showGapsOnMap(sel);
    });
  }, [onStyleReady, addMapLayers, showGapsOnMap, runs, selectedRunId]);

  useEffect(() => {
    if (!isLoaded || !territories.length) return;
    addMapLayers();
    layersAdded.current = true;
  }, [isLoaded, territories, addMapLayers]);

  // When selectedRunId changes, update gap markers
  const selectedRun = runs.find((r) => r.id === selectedRunId);
  useEffect(() => {
    if (isLoaded && layersAdded.current) {
      showGapsOnMap(selectedRun);
    }
  }, [isLoaded, selectedRun, showGapsOnMap]);

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

  const toggleGapSelection = (osmId: string) => {
    setSelectedGaps((prev) => {
      const next = new Set(prev);
      if (next.has(osmId)) next.delete(osmId);
      else next.add(osmId);
      return next;
    });
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

        {/* Map legend */}
        {isLoaded && (
          <div className="absolute bottom-4 left-3 z-10 bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius-sm)] shadow-lg px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
              <span className="w-3 h-3 rounded-full bg-[#f97316] border border-[#b45309]" />
              Uncovered building
            </div>
            <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
              <span className="w-3 h-0.5 bg-[#16a34a]" />
              Territory boundary
            </div>
            <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
              <span className="w-3 h-0.5 bg-[#dc2626]" style={{ borderTop: "2px dashed #dc2626" }} />
              Congregation boundary
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
                <div className="text-lg font-bold text-[var(--amber)]">{selectedRun.gapCount ?? 0}</div>
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

            {/* Bulk actions */}
            {selectedGaps.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-muted)]">{selectedGaps.size} selected</span>
                <button
                  onClick={() => setShowIgnoreDialog(true)}
                  className="px-3 py-1 text-xs text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer flex items-center gap-1"
                >
                  <EyeOff size={12} />
                  <FormattedMessage id="territories.gapIgnore" defaultMessage="Ignore" />
                </button>
              </div>
            )}

            {/* Gap list */}
            {selectedRun.resultGeoJson && selectedRun.resultGeoJson.features.length > 0 && (
              <ul className="max-h-40 overflow-y-auto space-y-0.5">
                {selectedRun.resultGeoJson.features.map((feature: GeoJsonFeature) => {
                  const osmId = feature.properties?.osmId as string;
                  const isSelected = selectedGaps.has(osmId);
                  return (
                    <li key={osmId}>
                      <button
                        onClick={() => toggleGapSelection(osmId)}
                        className={`w-full text-left px-3 py-2 text-xs rounded-[var(--radius-sm)] flex items-center gap-2 transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-[var(--glass-2)] text-[var(--text)]"
                            : "text-[var(--text-muted)] hover:bg-[var(--glass)]"
                        }`}
                      >
                        <input type="checkbox" checked={isSelected} readOnly className="accent-[var(--amber)]" />
                        <MapPin size={12} className="text-[var(--amber)] flex-shrink-0" />
                        <span className="truncate flex-1">
                          {(feature.properties?.streetAddress as string) ?? osmId}
                        </span>
                        {(feature.properties?.buildingType as string | undefined) && (
                          <span className="text-[10px] px-1.5 py-0 rounded-full bg-[var(--glass)] text-[var(--text-muted)] flex-shrink-0">
                            {String(feature.properties?.buildingType)}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {selectedRun.resultGeoJson && selectedRun.resultGeoJson.features.length === 0 && (
              <div className="flex flex-col items-center py-4 text-[var(--green)]">
                <CheckCircle2 size={24} strokeWidth={1.2} className="mb-2" />
                <p className="text-xs font-medium">All buildings are covered by territories!</p>
              </div>
            )}
          </div>
        )}

        {/* Ignore dialog */}
        {showIgnoreDialog && (
          <div className="p-4 border-b border-[var(--border)] bg-[var(--bg-1)] space-y-3 flex-shrink-0">
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

        {/* Run history */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-2 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
            Run History
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
