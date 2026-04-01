import { useRef, useEffect, useState, useCallback } from "react";
import { FormattedMessage } from "react-intl";
import { useNavigate } from "react-router";
import { ArrowLeft, Map, Plus, Loader2 } from "lucide-react";
import { useMapLibre, MAP_STYLES, type MapStyleKey } from "../../hooks/useMapLibre";
import { useAuth } from "@/auth/useAuth";
import { listTerritories, type TerritoryListItem } from "@/lib/territory-api";

/** Compute GeoJSON features from territories (reused after style switch) */
function buildFeatures(territories: TerritoryListItem[]) {
  return territories
    .filter((t) => t.boundaries)
    .map((t) => ({
      type: "Feature" as const,
      properties: {
        id: t.id,
        number: t.number,
        name: t.name,
        assigned: t.assignments.some((a) => !a.returnedAt),
      },
      geometry: t.boundaries as { type: string; coordinates: unknown },
    }));
}

/** Compute bounding box from GeoJSON features */
function computeBounds(features: ReturnType<typeof buildFeatures>) {
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
  for (const f of features) flatten(f.geometry.coordinates);
  if (minLng < 180) return [[minLng, minLat], [maxLng, maxLat]] as [[number, number], [number, number]];
  return null;
}

export function TerritoryMap() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const token = user?.access_token ?? "";
  const containerRef = useRef<HTMLDivElement>(null);
  const { isLoaded, addSource, addLayer, fitBounds, mapRef, activeStyle, changeStyle, onStyleReady } = useMapLibre({
    container: containerRef,
    center: [11.38, 47.75],
    zoom: 13,
  });

  const [territories, setTerritories] = useState<TerritoryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const layersAdded = useRef(false);
  const territoriesRef = useRef<TerritoryListItem[]>([]);

  // Fetch territories (full, with boundaries for map rendering)
  useEffect(() => {
    if (!token) return;
    listTerritories(token)
      .then((data) => {
        setTerritories(data);
        territoriesRef.current = data;
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  /** Add territory layers to the map */
  const addTerritoryLayers = useCallback(() => {
    const data = territoriesRef.current;
    if (data.length === 0) return;

    const features = buildFeatures(data);
    if (features.length === 0) return;

    addSource("territories", { type: "FeatureCollection", features });

    addLayer({
      id: "territories-fill",
      type: "fill",
      source: "territories",
      paint: {
        "fill-color": [
          "case",
          ["get", "assigned"],
          "rgba(217, 119, 6, 0.25)",
          "rgba(22, 163, 74, 0.18)",
        ],
        "fill-opacity": 0.8,
      },
    });

    addLayer({
      id: "territories-outline",
      type: "line",
      source: "territories",
      paint: {
        "line-color": ["case", ["get", "assigned"], "#b45309", "#15803d"],
        "line-width": 2,
      },
    });

    addLayer({
      id: "territories-labels",
      type: "symbol",
      source: "territories",
      layout: {
        "text-field": ["get", "number"],
        "text-size": 13,
        "text-font": ["Open Sans Bold"],
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#1e293b",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    });

    // Click → navigate to detail
    const map = mapRef.current;
    if (map) {
      map.on("click", "territories-fill", (e: { features?: Array<{ properties?: { id?: string } }> }) => {
        const tid = e.features?.[0]?.properties?.id;
        if (tid) navigate(`/territories/${tid}`);
      });
      map.on("mouseenter", "territories-fill", () => {
        if (map.getCanvas()) map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "territories-fill", () => {
        if (map.getCanvas()) map.getCanvas().style.cursor = "";
      });
    }
  }, [addSource, addLayer, mapRef, navigate]);

  // Register style-change callback to re-add layers
  useEffect(() => {
    onStyleReady(() => {
      layersAdded.current = false;
      addTerritoryLayers();
      layersAdded.current = true;
    });
  }, [onStyleReady, addTerritoryLayers]);

  // Initial layer add when map + data ready
  useEffect(() => {
    if (!isLoaded || territories.length === 0 || layersAdded.current) return;

    addTerritoryLayers();
    layersAdded.current = true;

    // Fit bounds
    const features = buildFeatures(territories);
    const bounds = computeBounds(features);
    if (bounds) fitBounds(bounds);
  }, [isLoaded, territories, addTerritoryLayers, fitBounds]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/territories")}
          className="p-2 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-semibold text-[var(--text)]">
          <FormattedMessage id="territories.map" />
        </h1>
        {loading && <Loader2 size={16} className="text-[var(--amber)] animate-spin" />}
      </div>

      {/* Map container */}
      <div className="relative h-[80vh] border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] overflow-hidden">
        <div ref={containerRef} className="absolute inset-0" />

        {!isLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--bg-1)]">
            <Map size={48} className="text-[var(--text-muted)] mb-4" strokeWidth={1} />
            <p className="text-sm text-[var(--text-muted)]">
              <FormattedMessage id="territories.mapLoading" defaultMessage="Loading map..." />
            </p>
          </div>
        )}

        {/* Style switcher — top left */}
        {isLoaded && (
          <div className="absolute top-3 left-3 z-10 flex rounded-[var(--radius-sm)] overflow-hidden shadow-lg border border-[var(--border)]">
            {(Object.keys(MAP_STYLES) as MapStyleKey[]).map((key) => (
              <button
                key={key}
                onClick={() => changeStyle(key)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
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

        {/* New territory button — top right */}
        <button
          onClick={() => navigate("/territories/map?draw=true")}
          className="absolute top-3 right-3 z-10 flex items-center gap-2 px-4 py-2 text-sm font-semibold text-black bg-[var(--amber)] rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer shadow-lg"
        >
          <Plus size={16} />
          <FormattedMessage id="territories.newTerritory" defaultMessage="New Territory" />
        </button>
      </div>
    </div>
  );
}
