import { useRef, useEffect, useState } from "react";
import { FormattedMessage } from "react-intl";
import { useNavigate } from "react-router";
import { ArrowLeft, Map, Plus } from "lucide-react";
import { useMapLibre } from "../../hooks/useMapLibre";
import { useAuth } from "@/auth/useAuth";
import { listTerritories, type TerritoryListItem } from "@/lib/territory-api";

export function TerritoryMap() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const token = user?.access_token ?? "";
  const containerRef = useRef<HTMLDivElement>(null);
  const { isLoaded, addSource, addLayer, fitBounds, mapRef } = useMapLibre({
    container: containerRef,
    center: [11.38, 47.75], // Penzberg approximate center
    zoom: 13,
  });

  const [territories, setTerritories] = useState<TerritoryListItem[]>([]);
  const layersAdded = useRef(false);

  // Fetch territories
  useEffect(() => {
    if (!token) return;
    listTerritories(token).then(setTerritories).catch(() => {});
  }, [token]);

  // Add GeoJSON layers when map is loaded and territories are available
  useEffect(() => {
    if (!isLoaded || territories.length === 0 || layersAdded.current) return;

    const features = territories
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

    if (features.length === 0) return;

    addSource("territories", {
      type: "FeatureCollection",
      features,
    });

    // Fill layer
    addLayer({
      id: "territories-fill",
      type: "fill",
      source: "territories",
      paint: {
        "fill-color": [
          "case",
          ["get", "assigned"],
          "#f59e0b33", // amber for assigned
          "#22c55e22", // green for available
        ],
        "fill-opacity": 0.5,
      },
    });

    // Outline layer
    addLayer({
      id: "territories-outline",
      type: "line",
      source: "territories",
      paint: {
        "line-color": [
          "case",
          ["get", "assigned"],
          "#f59e0b",
          "#22c55e",
        ],
        "line-width": 2,
      },
    });

    // Number labels
    addLayer({
      id: "territories-labels",
      type: "symbol",
      source: "territories",
      layout: {
        "text-field": ["get", "number"],
        "text-size": 14,
        "text-font": ["Open Sans Bold"],
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "#000000",
        "text-halo-width": 1.5,
      },
    });

    layersAdded.current = true;

    // Fit bounds to all territories
    let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
    for (const f of features) {
      const coords = f.geometry.coordinates as number[][][] | number[][][][];
      const flatten = (c: unknown): void => {
        if (Array.isArray(c) && typeof c[0] === "number") {
          const [lng, lat] = c as number[];
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        } else if (Array.isArray(c)) {
          for (const item of c) flatten(item);
        }
      };
      flatten(coords);
    }
    if (minLng < 180) {
      fitBounds([minLng, minLat, maxLng, maxLat]);
    }

    // Click handler — navigate to territory detail
    const map = mapRef.current;
    if (map) {
      map.on("click", "territories-fill", (e: { features?: Array<{ properties?: { id?: string } }> }) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) navigate(`/territories/${id}`);
      });
      map.on("mouseenter", "territories-fill", () => {
        if (map.getCanvas()) map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "territories-fill", () => {
        if (map.getCanvas()) map.getCanvas().style.cursor = "";
      });
    }
  }, [isLoaded, territories, addSource, addLayer, fitBounds, mapRef, navigate]);

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
      </div>

      {/* Map container */}
      <div className="relative h-[70vh] border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] overflow-hidden">
        <div ref={containerRef} className="absolute inset-0" />

        {!isLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--bg-1)]">
            <Map size={48} className="text-[var(--text-muted)] mb-4" strokeWidth={1} />
            <p className="text-sm text-[var(--text-muted)]">
              <FormattedMessage id="territories.mapLoading" defaultMessage="Loading map..." />
            </p>
          </div>
        )}

        {/* New territory button */}
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
