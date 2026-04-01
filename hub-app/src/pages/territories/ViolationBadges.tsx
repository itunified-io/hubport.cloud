import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router";
import { Marker } from "maplibre-gl";
import { getViolations, type TerritoryViolation } from "@/lib/territory-api";

interface ViolationBadgesProps {
  map: any;
  token: string | null;
  territories: Array<{ id: string; number: string; boundaries: unknown }>;
}

export function ViolationBadges({ map, token, territories }: ViolationBadgesProps) {
  const navigate = useNavigate();
  const [violations, setViolations] = useState<TerritoryViolation[]>([]);
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    if (!token) return;
    getViolations(token).then(setViolations).catch(console.error);
  }, [token]);

  useEffect(() => {
    if (!map || violations.length === 0) return;

    // Clean up old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    for (const v of violations) {
      const territory = territories.find((t) => t.id === v.territoryId);
      if (!territory?.boundaries) continue;

      // Get centroid from boundaries for marker placement
      const bounds = territory.boundaries as { type?: string; coordinates?: number[][][] };
      const coords = bounds.coordinates?.[0];
      if (!coords || coords.length < 2) continue;

      // Simple centroid (exclude closing vertex which duplicates first vertex)
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

      const marker = new Marker({ element: el })
        .setLngLat([cx, cy])
        .addTo(map);
      markersRef.current.push(marker);
    }

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [map, violations, territories, navigate]);

  return null; // Markers are added directly to the map
}
