import { useState, useEffect, useRef, useCallback } from "react";
import { MapPin, RefreshCw, AlertTriangle } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";

interface LocationShare {
  id: string;
  publisherId: string;
  isActive: boolean;
  expiresAt: string;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastUpdatedAt: string | null;
}

interface PublisherInfo {
  id: string;
  name: string;
}

interface LocationMapProps {
  fieldGroupId: string;
  publishers: PublisherInfo[];
  locationShares: LocationShare[];
  publisherId: string;
  onShareExpired?: () => void;
}

const POLL_INTERVAL = 30_000; // 30 seconds

export function LocationMap({
  fieldGroupId,
  publishers,
  locationShares: initialShares,
  publisherId,
  onShareExpired,
}: LocationMapProps) {
  const { user } = useAuth();
  const apiUrl = getApiUrl();
  const headers: HeadersInit = { Authorization: `Bearer ${user?.access_token}`, "Content-Type": "application/json" };

  const [shares, setShares] = useState<LocationShare[]>(initialShares);
  const [error, setError] = useState<string | null>(null);
  const [lastPoll, setLastPoll] = useState<Date>(new Date());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const publisherMap = new Map(publishers.map((p) => [p.id, p.name]));

  // Update own location
  const updateOwnLocation = useCallback(async () => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const res = await fetch(`${apiUrl}/field-groups/${fieldGroupId}/location-share/update`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              publisherId,
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            }),
          });
          if (res.status === 410) {
            // Location share expired
            setError("Your location share has expired.");
            onShareExpired?.();
            return;
          }
          if (!res.ok) {
            setError("Failed to update location.");
          }
        } catch {
          setError("Network error updating location.");
        }
      },
      () => {
        setError("Location access denied.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },
    );
  }, [apiUrl, fieldGroupId, publisherId, headers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for other members' locations (mock - in real app this refreshes from campaign detail)
  const pollLocations = useCallback(async () => {
    try {
      // Re-fetch campaign detail to get updated location shares
      // The parent should pass updated locationShares, but we can trigger a refresh
      setLastPoll(new Date());
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    // Start polling
    updateOwnLocation();
    pollRef.current = setInterval(() => {
      updateOwnLocation();
      pollLocations();
    }, POLL_INTERVAL);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [updateOwnLocation, pollLocations]);

  // Update shares when props change
  useEffect(() => {
    setShares(initialShares);
  }, [initialShares]);

  const activeShares = shares.filter((s) => s.isActive && s.lastLatitude !== null && s.lastLongitude !== null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1">
          <MapPin size={12} /> Live Locations
        </h4>
        <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
          <RefreshCw size={10} />
          <span>Updated {lastPoll.toLocaleTimeString()}</span>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-2 bg-[#ef444414] border border-[var(--red)] rounded-[var(--radius-sm)]">
          <AlertTriangle size={12} className="text-[var(--red)]" />
          <span className="text-xs text-[var(--red)]">{error}</span>
        </div>
      )}

      {/* Map placeholder - CSS-based location display */}
      <div className="relative border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-2)] min-h-[300px] overflow-hidden">
        {/* Grid background */}
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: "radial-gradient(var(--text-muted) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />

        {activeShares.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <MapPin size={24} className="text-[var(--text-muted)] mx-auto mb-2" strokeWidth={1.2} />
              <p className="text-xs text-[var(--text-muted)]">No active location shares</p>
            </div>
          </div>
        ) : (
          // Simple marker display using relative positioning within the container
          // In production, this would use MapLibre GL or similar
          <div className="relative w-full h-full min-h-[300px]">
            {activeShares.map((share) => {
              const name = publisherMap.get(share.publisherId) ?? "Unknown";
              const isExpired = new Date(share.expiresAt) < new Date();
              const isOwnShare = share.publisherId === publisherId;

              if (isExpired) return null;

              return (
                <div
                  key={share.id}
                  className="absolute flex flex-col items-center"
                  style={{
                    // Normalize lat/lng to relative positions within the map
                    // This is a simplified representation
                    left: `${((share.lastLongitude! % 1) * 800 + 400) % 100}%`,
                    top: `${((share.lastLatitude! % 1) * 800 + 400) % 100}%`,
                    transform: "translate(-50%, -100%)",
                  }}
                >
                  {/* Marker */}
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shadow-lg ${
                      isOwnShare
                        ? "bg-[var(--amber)] text-black"
                        : "bg-[var(--blue)] text-white"
                    }`}
                  >
                    <MapPin size={14} />
                  </div>
                  {/* Label */}
                  <div className="mt-1 px-2 py-0.5 bg-[var(--bg-1)] border border-[var(--border)] rounded text-[9px] font-medium text-[var(--text)] whitespace-nowrap shadow">
                    {name}
                    {isOwnShare && " (you)"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Member list */}
      <div className="space-y-1">
        {activeShares.map((share) => {
          const name = publisherMap.get(share.publisherId) ?? "Unknown";
          const isExpired = new Date(share.expiresAt) < new Date();
          const lastUpdate = share.lastUpdatedAt ? new Date(share.lastUpdatedAt) : null;

          return (
            <div
              key={share.id}
              className="flex items-center justify-between px-3 py-2 border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--bg-1)]"
            >
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isExpired ? "bg-[var(--red)]" : "bg-[var(--green)]"}`} />
                <span className="text-xs text-[var(--text)]">{name}</span>
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">
                {isExpired ? (
                  <span className="text-[var(--red)]">Expired</span>
                ) : (
                  <>
                    {lastUpdate && `Updated ${lastUpdate.toLocaleTimeString()}`}
                    {" | Expires "}
                    {new Date(share.expiresAt).toLocaleTimeString()}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
