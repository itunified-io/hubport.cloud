import { useEffect, useState, useRef, useCallback } from "react";
import { FormattedMessage, FormattedDate } from "react-intl";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, User, Calendar, Loader2, MapPin, Clock, Hash, Layers, Maximize2, Minimize2 } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getTerritory, type TerritoryListItem } from "@/lib/territory-api";
import { useMapLibre, MAP_STYLES, type MapStyleKey } from "@/hooks/useMapLibre";

export function TerritoryDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const token = user?.access_token ?? "";

  const [territory, setTerritory] = useState<TerritoryListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapExpanded, setMapExpanded] = useState(false);

  // Mini map
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const { isLoaded, mapRef, addSource, addLayer, fitBounds, activeStyle, changeStyle, onStyleReady } = useMapLibre({
    container: mapContainerRef,
    center: [11.38, 47.75],
    zoom: 14,
  });
  const layerAdded = useRef(false);
  const territoryRef = useRef<TerritoryListItem | null>(null);

  useEffect(() => {
    if (!token || !id) return;
    getTerritory(id, token)
      .then((t) => {
        setTerritory(t);
        territoryRef.current = t;
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load territory"))
      .finally(() => setLoading(false));
  }, [token, id]);

  /** Add territory boundary layers to map */
  const addBoundaryLayers = useCallback(() => {
    const t = territoryRef.current;
    if (!t?.boundaries) return;

    addSource("territory", {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { number: t.number },
          geometry: t.boundaries,
        },
      ],
    });

    addLayer({
      id: "territory-fill",
      type: "fill",
      source: "territory",
      paint: { "fill-color": "rgba(217, 119, 6, 0.25)", "fill-opacity": 0.8 },
    });

    addLayer({
      id: "territory-outline",
      type: "line",
      source: "territory",
      paint: { "line-color": "#b45309", "line-width": 3 },
    });

    addLayer({
      id: "territory-label",
      type: "symbol",
      source: "territory",
      layout: {
        "text-field": ["get", "number"],
        "text-size": 16,
        "text-font": ["Open Sans Bold"],
      },
      paint: {
        "text-color": "#1e293b",
        "text-halo-color": "#ffffff",
        "text-halo-width": 2,
      },
    });

    // Fit bounds
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
    if (minLng < 180) {
      fitBounds([[minLng, minLat], [maxLng, maxLat]]);
    }
  }, [addSource, addLayer, fitBounds]);

  // Register style-change callback
  useEffect(() => {
    onStyleReady(() => {
      layerAdded.current = false;
      addBoundaryLayers();
      layerAdded.current = true;
    });
  }, [onStyleReady, addBoundaryLayers]);

  // Render boundary on mini map
  useEffect(() => {
    if (!isLoaded || !territory?.boundaries || layerAdded.current) return;

    addBoundaryLayers();
    layerAdded.current = true;
  }, [isLoaded, territory, addBoundaryLayers]);

  // Resize map when expanded/collapsed
  useEffect(() => {
    const map = mapRef.current;
    if (map && isLoaded) {
      // Small delay to let CSS transition finish
      const timer = setTimeout(() => map.resize(), 350);
      return () => clearTimeout(timer);
    }
  }, [mapExpanded, mapRef, isLoaded]);

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

  const activeAssignment = territory.assignments.find((a) => !a.returnedAt);
  const pastAssignments = territory.assignments.filter((a) => a.returnedAt);
  const hasBoundary = !!territory.boundaries;

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

      {/* Main content grid */}
      <div className={mapExpanded ? "space-y-6" : "grid grid-cols-1 lg:grid-cols-3 gap-6"}>
        {/* Map — takes 2 cols on large, or full width when expanded */}
        <div className={`${mapExpanded ? "" : "lg:col-span-2"} border border-[var(--border)] rounded-[var(--radius)] overflow-hidden bg-[var(--bg-1)] relative`}>
          {hasBoundary ? (
            <div
              ref={mapContainerRef}
              className={`w-full transition-[height] duration-300 ${mapExpanded ? "h-[70vh]" : "h-80"}`}
            />
          ) : (
            <>
              <div ref={mapContainerRef} className="hidden" />
              <div className="h-80 flex items-center justify-center">
                <div className="text-center">
                  <MapPin size={36} className="text-[var(--text-muted)] mx-auto mb-3" strokeWidth={1.5} />
                  <p className="text-sm text-[var(--text-muted)]">
                    <FormattedMessage id="territories.noBoundary" defaultMessage="No boundary defined" />
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-1 opacity-60">
                    <FormattedMessage id="territories.importBoundary" defaultMessage="Import via CSV or draw on map" />
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Map controls overlay */}
          {hasBoundary && isLoaded && (
            <>
              {/* Style switcher — top left */}
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

              {/* Expand/collapse — top right */}
              <button
                onClick={() => setMapExpanded((v) => !v)}
                className="absolute top-3 right-3 z-10 p-2 rounded-[var(--radius-sm)] bg-[var(--bg-1)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer shadow-lg"
                title={mapExpanded ? "Collapse" : "Expand"}
              >
                {mapExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
            </>
          )}
        </div>

        {/* Info sidebar */}
        <div className={`space-y-4 ${mapExpanded ? "grid grid-cols-1 sm:grid-cols-3 gap-4 space-y-0" : ""}`}>
          {/* Current assignment card */}
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

          {/* Stats */}
          <div className={`${mapExpanded ? "" : "grid grid-cols-2 gap-3"} ${mapExpanded ? "flex gap-3" : ""}`}>
            <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-3 text-center flex-1">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Hash size={12} className="text-[var(--text-muted)]" />
                <p className="text-lg font-bold text-[var(--text)]">{territory.assignments.length}</p>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">
                <FormattedMessage id="territories.totalAssignments" defaultMessage="Assignments" />
              </p>
            </div>
            <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-3 text-center flex-1">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <MapPin size={12} className="text-[var(--text-muted)]" />
                <p className={`text-lg font-bold ${hasBoundary ? "text-[var(--green)]" : "text-[var(--text-muted)]"}`}>
                  {hasBoundary ? "Yes" : "No"}
                </p>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">
                <FormattedMessage id="territories.boundary" defaultMessage="Boundary" />
              </p>
            </div>
          </div>

          {/* Dates */}
          <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)] flex items-center gap-1.5">
                <Clock size={11} />
                <FormattedMessage id="territories.created" defaultMessage="Created" />
              </span>
              <span className="text-[var(--text)]">
                <FormattedDate value={territory.createdAt} />
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)] flex items-center gap-1.5">
                <Clock size={11} />
                <FormattedMessage id="territories.updated" defaultMessage="Updated" />
              </span>
              <span className="text-[var(--text)]">
                <FormattedDate value={territory.updatedAt} />
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Assignment history */}
      {pastAssignments.length > 0 && (
        <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
          <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
            <Calendar size={14} className="text-[var(--text-muted)]" />
            <h3 className="text-sm font-semibold text-[var(--text)]">
              <FormattedMessage id="territories.assignmentHistory" defaultMessage="Assignment History" />
            </h3>
            <span className="text-xs text-[var(--text-muted)] ml-auto">{pastAssignments.length}</span>
          </div>
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
        </div>
      )}
    </div>
  );
}
