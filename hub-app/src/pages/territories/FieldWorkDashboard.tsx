import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/auth/useAuth";
import { useMapLibre } from "@/hooks/useMapLibre";
import { getActiveLocations, type LocationShareData } from "@/lib/territory-api";

/**
 * Overseer dashboard: full-screen map showing all publishers sharing location.
 * Permission-gated: FIELD_WORK_OVERSEER
 */
export default function FieldWorkDashboard() {
  const { user } = useAuth();
  const token = user?.access_token ?? "";
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const { mapRef, isLoaded } = useMapLibre({
    container: mapContainerRef,
    zoom: 13,
  });

  const [locations, setLocations] = useState<LocationShareData[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Poll active locations every 10s
  useEffect(() => {
    if (!token) return;

    async function fetchLocations() {
      try {
        const data = await getActiveLocations(token);
        setLocations(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch");
      }
    }

    fetchLocations();
    const timer = setInterval(fetchLocations, 10000);
    return () => clearInterval(timer);
  }, [token]);

  // Render publisher markers on map
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;

    const existingMarkers = document.querySelectorAll(".overseer-publisher-marker");
    existingMarkers.forEach((el) => el.remove());

    locations.forEach(async (loc) => {
      if (loc.lastLatitude == null || loc.lastLongitude == null) return;

      const maplibregl = await import("maplibre-gl");

      const el = document.createElement("div");
      el.className = "overseer-publisher-marker";
      el.style.cssText =
        "width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.3);";

      const hue = Math.abs(
        loc.fieldGroupId.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 360,
      );
      el.style.background = `hsl(${hue}, 70%, 50%)`;

      el.title = `${loc.publisher?.firstName ?? ""} ${loc.publisher?.lastName ?? ""}`;

      new maplibregl.Marker({ element: el })
        .setLngLat([loc.lastLongitude!, loc.lastLatitude!])
        .addTo(mapRef.current as unknown as maplibregl.Map);
    });
  }, [locations, mapRef, isLoaded]);

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <div ref={mapContainerRef} style={{ flex: 1 }} />

      <div style={{
        width: "300px",
        borderLeft: "1px solid var(--border, #e5e7eb)",
        overflowY: "auto",
        padding: "16px",
      }}>
        <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "16px" }}>
          Field Work Overview
        </h2>

        {error && (
          <div style={{ color: "#dc2626", marginBottom: "12px", fontSize: "13px" }}>
            {error}
          </div>
        )}

        <div style={{ fontSize: "13px", color: "var(--text-muted, #6b7280)", marginBottom: "16px" }}>
          {locations.length} publisher{locations.length !== 1 ? "s" : ""} sharing
        </div>

        {Object.entries(
          locations.reduce<Record<string, LocationShareData[]>>((acc, loc) => {
            const key = loc.fieldGroup?.name ?? loc.fieldGroupId;
            if (!acc[key]) acc[key] = [];
            acc[key].push(loc);
            return acc;
          }, {}),
        ).map(([groupName, members]) => (
          <div key={groupName} style={{ marginBottom: "16px" }}>
            <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "4px" }}>
              {groupName}
            </div>
            {members.map((m) => (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "4px 0",
                  fontSize: "13px",
                }}
              >
                <span style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: m.isActive ? "#16a34a" : "#9ca3af",
                }} />
                <span>
                  {m.publisher?.firstName} {m.publisher?.lastName}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
