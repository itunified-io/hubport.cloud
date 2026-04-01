import { useRef, useEffect, useState, useCallback } from "react";
import { FormattedMessage } from "react-intl";
import { useNavigate } from "react-router";
import { ArrowLeft, Map, Plus, Loader2 } from "lucide-react";
import { useMapLibre, MAP_STYLES, type MapStyleKey } from "../../hooks/useMapLibre";
import { useAuth } from "@/auth/useAuth";
import { usePermissions } from "@/auth/PermissionProvider";
import { listTerritories, createTerritory, type TerritoryListItem } from "@/lib/territory-api";
import { NewTerritoryModal } from "./NewTerritoryModal";
import { ViolationBadges } from "./ViolationBadges";

/** Color palette for territory groups (by number prefix) */
const GROUP_COLORS: Record<string, { fill: string; border: string; label: string }> = {
  "1": { fill: "rgba(59, 130, 246, 0.28)", border: "#2563eb", label: "blue" },
  "2": { fill: "rgba(139, 92, 246, 0.28)", border: "#7c3aed", label: "purple" },
  "3": { fill: "rgba(20, 184, 166, 0.28)", border: "#0d9488", label: "teal" },
  "4": { fill: "rgba(245, 158, 11, 0.28)", border: "#d97706", label: "amber" },
  "5": { fill: "rgba(236, 72, 153, 0.28)", border: "#db2777", label: "pink" },
  "6": { fill: "rgba(34, 197, 94, 0.28)", border: "#16a34a", label: "green" },
  "7": { fill: "rgba(239, 68, 68, 0.28)", border: "#dc2626", label: "red" },
  "8": { fill: "rgba(99, 102, 241, 0.28)", border: "#4f46e5", label: "indigo" },
  "9": { fill: "rgba(168, 85, 247, 0.28)", border: "#9333ea", label: "violet" },
};
const DEFAULT_GROUP_COLOR = { fill: "rgba(100, 116, 139, 0.28)", border: "#475569" };

/** Get the group prefix (first digit) from a territory number */
function getGroupPrefix(number: string): string {
  return number.charAt(0);
}

/** Build group info from territories: prefix → representative name */
function buildGroupInfo(territories: TerritoryListItem[]): Record<string, string> {
  const groups: Record<string, Record<string, number>> = {};
  for (const t of territories) {
    if (!t.boundaries || t.type === "congregation_boundary") continue;
    const prefix = getGroupPrefix(t.number);
    if (!groups[prefix]) groups[prefix] = {};
    const name = t.name.trim();
    groups[prefix][name] = (groups[prefix][name] ?? 0) + 1;
  }
  // Pick the most common name per group
  const result: Record<string, string> = {};
  for (const prefix of Object.keys(groups)) {
    let best = "", bestCount = 0;
    for (const [name, count] of Object.entries(groups[prefix]!)) {
      if (count > bestCount) { best = name; bestCount = count; }
    }
    result[prefix] = best;
  }
  return result;
}

/** Compute GeoJSON features from territories */
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
        group: getGroupPrefix(t.number),
      },
      geometry: t.boundaries as { type: string; coordinates: unknown },
    }));
}

/** Compute bounding box */
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

  const { can } = usePermissions();
  const [territories, setTerritories] = useState<TerritoryListItem[]>([]);
  const [congBoundary, setCongBoundary] = useState<TerritoryListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [groupInfo, setGroupInfo] = useState<Record<string, string>>({});
  const [showNewModal, setShowNewModal] = useState(false);
  const layersAdded = useRef(false);
  const territoriesRef = useRef<TerritoryListItem[]>([]);
  const congBoundaryRef = useRef<TerritoryListItem | null>(null);

  // Fetch territories + congregation boundary in parallel
  useEffect(() => {
    if (!token) return;
    Promise.all([
      listTerritories(token),
      listTerritories(token, { type: "congregation_boundary" }),
    ])
      .then(([terrs, bounds]) => {
        setTerritories(terrs);
        territoriesRef.current = terrs;
        setGroupInfo(buildGroupInfo(terrs));
        const cb = bounds[0] ?? null;
        setCongBoundary(cb);
        congBoundaryRef.current = cb;
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  /** Add all map layers */
  const addAllLayers = useCallback(() => {
    const data = territoriesRef.current;
    const cb = congBoundaryRef.current;

    // Congregation boundary — red dashed line (add first so it's below territory fills)
    if (cb?.boundaries) {
      addSource("cong-boundary", {
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: { name: cb.name },
          geometry: cb.boundaries,
        }],
      });

      addLayer({
        id: "cong-boundary-line",
        type: "line",
        source: "cong-boundary",
        paint: {
          "line-color": "#ef4444",
          "line-width": 3,
          "line-dasharray": [4, 3],
        },
      });
    }

    // Territory polygons
    if (data.length > 0) {
      const features = buildFeatures(data);
      if (features.length === 0) return;

      addSource("territories", { type: "FeatureCollection", features });

      // Build match expressions for group colors
      const groups = Object.keys(GROUP_COLORS);
      const fillMatch: unknown[] = ["match", ["get", "group"]];
      const borderMatch: unknown[] = ["match", ["get", "group"]];
      for (const g of groups) {
        fillMatch.push(g, GROUP_COLORS[g]!.fill);
        borderMatch.push(g, GROUP_COLORS[g]!.border);
      }
      fillMatch.push(DEFAULT_GROUP_COLOR.fill); // fallback
      borderMatch.push(DEFAULT_GROUP_COLOR.border); // fallback

      addLayer({
        id: "territories-fill",
        type: "fill",
        source: "territories",
        paint: {
          "fill-color": fillMatch,
          "fill-opacity": 0.85,
        },
      });

      addLayer({
        id: "territories-outline",
        type: "line",
        source: "territories",
        paint: {
          "line-color": borderMatch,
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
    }
  }, [addSource, addLayer, mapRef, navigate]);

  // Register style-change callback to re-add layers
  useEffect(() => {
    onStyleReady(() => {
      layersAdded.current = false;
      addAllLayers();
      layersAdded.current = true;
    });
  }, [onStyleReady, addAllLayers]);

  // Initial layer add when map + data ready
  useEffect(() => {
    if (!isLoaded || layersAdded.current) return;
    if (territories.length === 0 && !congBoundary) return;

    addAllLayers();
    layersAdded.current = true;

    // Fit bounds — prefer congregation boundary, fallback to territory extent
    if (congBoundary?.boundaries) {
      const cbFeatures = buildFeatures([congBoundary]);
      const bounds = computeBounds(cbFeatures);
      if (bounds) fitBounds(bounds);
    } else {
      const features = buildFeatures(territories);
      const bounds = computeBounds(features);
      if (bounds) fitBounds(bounds);
    }
  }, [isLoaded, territories, congBoundary, addAllLayers, fitBounds]);

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

        {/* Legend — bottom left */}
        {isLoaded && (
          <div className="absolute bottom-3 left-3 z-10 bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius-sm)] shadow-lg px-3 py-2 space-y-1.5 max-h-[50vh] overflow-y-auto">
            <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
              <span className="w-4 h-0.5 block" style={{ borderTop: "2px dashed #ef4444" }} />
              <FormattedMessage id="territories.congBoundary" defaultMessage="Congregation Boundary" />
            </div>
            {Object.entries(groupInfo)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([prefix, name]) => {
                const colors = GROUP_COLORS[prefix] ?? DEFAULT_GROUP_COLOR;
                return (
                  <div key={prefix} className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                    <span
                      className="w-4 h-3 rounded-sm block flex-shrink-0"
                      style={{ background: colors.fill, border: `1.5px solid ${colors.border}` }}
                    />
                    <span className="font-mono font-semibold">{prefix}xx</span>
                    <span className="truncate">{name}</span>
                  </div>
                );
              })}
          </div>
        )}

        {/* New territory button — top right */}
        {can("app:territories.edit") && (
          <button
            onClick={() => setShowNewModal(true)}
            className="absolute top-3 right-3 z-10 flex items-center gap-2 px-4 py-2 text-sm font-semibold text-black bg-[var(--amber)] rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer shadow-lg"
          >
            <Plus size={16} />
            <FormattedMessage id="territories.newTerritory" defaultMessage="New Territory" />
          </button>
        )}

        {/* Violation warning badges */}
        <ViolationBadges
          map={mapRef.current}
          token={token}
          territories={territories}
        />
      </div>

      {/* New Territory modal */}
      {showNewModal && (
        <NewTerritoryModal
          onCancel={() => setShowNewModal(false)}
          onSubmit={async (number, name) => {
            if (!token) return;
            try {
              const territory = await createTerritory(token, { number, name });
              setShowNewModal(false);
              navigate(`/territories/${territory.id}`);
            } catch (err) {
              console.error("Create territory failed:", err);
            }
          }}
        />
      )}
    </div>
  );
}
