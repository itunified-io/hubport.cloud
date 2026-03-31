import { useEffect, useState, useRef } from "react";
import { FormattedMessage, FormattedDate } from "react-intl";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, User, Calendar, Loader2, Map } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getTerritory, type TerritoryListItem } from "@/lib/territory-api";
import { useMapLibre } from "@/hooks/useMapLibre";

export function TerritoryDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const token = user?.access_token ?? "";

  const [territory, setTerritory] = useState<TerritoryListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Mini map
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const { isLoaded, addSource, addLayer, fitBounds } = useMapLibre({
    container: mapContainerRef,
    center: [11.38, 47.75],
    zoom: 14,
  });
  const layerAdded = useRef(false);

  useEffect(() => {
    if (!token || !id) return;
    getTerritory(id, token)
      .then(setTerritory)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load territory"))
      .finally(() => setLoading(false));
  }, [token, id]);

  // Render boundary on mini map
  useEffect(() => {
    if (!isLoaded || !territory?.boundaries || layerAdded.current) return;

    addSource("territory", {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { number: territory.number },
          geometry: territory.boundaries,
        },
      ],
    });

    addLayer({
      id: "territory-fill",
      type: "fill",
      source: "territory",
      paint: { "fill-color": "#f59e0b33", "fill-opacity": 0.6 },
    });

    addLayer({
      id: "territory-outline",
      type: "line",
      source: "territory",
      paint: { "line-color": "#f59e0b", "line-width": 2.5 },
    });

    layerAdded.current = true;

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
    flatten((territory.boundaries as { coordinates: unknown }).coordinates);
    if (minLng < 180) {
      fitBounds([[minLng, minLat], [maxLng, maxLat]]);
    }
  }, [isLoaded, territory, addSource, addLayer, fitBounds]);

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

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/territories")}
          className="p-2 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-semibold text-[var(--text)]">
            <span className="text-[var(--amber)] font-mono">#{territory.number}</span>
            {" "}
            {territory.name}
          </h1>
          {territory.description && (
            <p className="text-sm text-[var(--text-muted)] mt-0.5">{territory.description}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Mini map */}
        <div className="border border-[var(--border)] rounded-[var(--radius)] overflow-hidden bg-[var(--bg-1)]">
          <div ref={mapContainerRef} className="h-64 w-full" />
          {!territory.boundaries && (
            <div className="h-64 flex items-center justify-center">
              <div className="text-center">
                <Map size={32} className="text-[var(--text-muted)] mx-auto mb-2" />
                <p className="text-xs text-[var(--text-muted)]">No boundary defined</p>
              </div>
            </div>
          )}
        </div>

        {/* Info card */}
        <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-4 space-y-4">
          {/* Current assignment */}
          <div>
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">
              <FormattedMessage id="territories.currentAssignment" defaultMessage="Current Assignment" />
            </h3>
            {activeAssignment ? (
              <div className="flex items-center gap-3 p-3 rounded-[var(--radius-sm)] bg-[var(--glass)]">
                <User size={16} className="text-[var(--amber)]" />
                <div>
                  <p className="text-sm font-medium text-[var(--text)]">
                    {activeAssignment.publisher.firstName} {activeAssignment.publisher.lastName}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    <FormattedMessage id="territories.since" defaultMessage="Since" />{" "}
                    <FormattedDate value={activeAssignment.assignedAt} />
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)] italic">
                <FormattedMessage id="territories.notAssigned" defaultMessage="Not assigned" />
              </p>
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--glass)] text-center">
              <p className="text-lg font-bold text-[var(--text)]">{territory.assignments.length}</p>
              <p className="text-xs text-[var(--text-muted)]">
                <FormattedMessage id="territories.totalAssignments" defaultMessage="Total Assignments" />
              </p>
            </div>
            <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--glass)] text-center">
              <p className="text-lg font-bold text-[var(--text)]">
                {territory.boundaries ? "✓" : "—"}
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                <FormattedMessage id="territories.boundary" defaultMessage="Boundary" />
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Assignment history */}
      {pastAssignments.length > 0 && (
        <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <h3 className="text-sm font-semibold text-[var(--text)]">
              <FormattedMessage id="territories.assignmentHistory" defaultMessage="Assignment History" />
            </h3>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {pastAssignments.map((a) => (
              <div key={a.id} className="px-4 py-3 flex items-center gap-3">
                <Calendar size={14} className="text-[var(--text-muted)]" />
                <div className="flex-1">
                  <p className="text-sm text-[var(--text)]">
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
