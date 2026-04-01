import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router";
import { getViolations, type TerritoryViolation } from "@/lib/territory-api";

interface ViolationBadgesProps {
  map: any;
  maplibreModule: React.RefObject<any | null>;
  token: string | null;
  territories: Array<{ id: string; number: string; boundaries: unknown }>;
}

export function ViolationBadges({ map, maplibreModule, token, territories }: ViolationBadgesProps) {
  const navigate = useNavigate();
  const [violations, setViolations] = useState<TerritoryViolation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [fetched, setFetched] = useState(false);
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(false);
    getViolations(token)
      .then((data) => { setViolations(data); setFetched(true); })
      .catch(() => { setError(true); setFetched(true); })
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!map) return;

    // Clean up old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (violations.length === 0) return;

    const mgl = maplibreModule.current;
    if (!mgl) return;

    const MarkerClass = mgl.Marker || mgl.default?.Marker;
    if (!MarkerClass) return;

    {
      for (const v of violations) {
        const territory = territories.find((t) => t.id === v.territoryId);
        if (!territory?.boundaries) continue;

        const bounds = territory.boundaries as { type?: string; coordinates?: number[][][] };
        const coords = bounds.coordinates?.[0];
        if (!coords || coords.length < 2) continue;

        const ring = coords.slice(0, -1);
        let cx = 0, cy = 0;
        for (const coord of ring) { cx += (coord[0] ?? 0); cy += (coord[1] ?? 0); }
        cx /= ring.length;
        cy /= ring.length;

        const hasExceedsBoundary = v.violations.some((vv) => vv === "exceeds_boundary");
        const color = hasExceedsBoundary ? "#ef4444" : "#f59e0b";

        const el = document.createElement("div");
        el.className = "violation-badge";
        el.style.cssText = `
          width: 22px; height: 22px; border-radius: 50%;
          background: ${color}; color: ${hasExceedsBoundary ? "white" : "black"};
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: 700; cursor: pointer;
          box-shadow: 0 2px 8px ${color}66;
        `;
        el.textContent = "!";
        el.onclick = () => navigate(`/territories/${v.territoryId}`);

        const marker = new MarkerClass({ element: el })
          .setLngLat([cx, cy])
          .addTo(map);
        markersRef.current.push(marker);
      }
    }

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [map, violations, territories, navigate]);

  // Status indicator in bottom-right corner
  if (!fetched && !loading) return null;

  return (
    <div className="absolute bottom-3 right-3 z-10">
      {loading && (
        <div className="bg-[var(--bg-1)] border border-[var(--border)] rounded-full px-2.5 py-1 text-[10px] text-[var(--text-muted)] shadow-sm">
          Checking...
        </div>
      )}
      {!loading && error && (
        <div className="bg-red-500/20 border border-red-500/30 rounded-full px-2.5 py-1 text-[10px] text-red-400 shadow-sm">
          Violation check failed
        </div>
      )}
      {!loading && !error && fetched && violations.length === 0 && (
        <div className="bg-green-500/20 border border-green-500/30 rounded-full px-2.5 py-1 text-[10px] text-green-400 shadow-sm">
          No violations
        </div>
      )}
    </div>
  );
}
