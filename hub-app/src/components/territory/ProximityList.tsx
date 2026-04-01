import { useEffect, useMemo, useRef, useState } from "react";
import { QuickActionBar } from "./QuickActionBar";
import type { VisitOutcome } from "../../lib/territory-api";

interface Address {
  addressId: string;
  streetAddress: string | null;
  status: string;
  lastVisitDate: string | null;
  latitude: number;
  longitude: number;
}

interface ProximityListProps {
  addresses: Address[];
  territoryId: string;
  userLat: number | null;
  userLng: number | null;
  onAddressSelect?: (addressId: string) => void;
  onVisitLogged?: (addressId: string, outcome: VisitOutcome) => void;
}

/** Haversine distance in meters */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

/**
 * Address list sorted by GPS proximity. Re-sorts every 5 seconds.
 */
export function ProximityList({
  addresses,
  territoryId,
  userLat,
  userLng,
  onAddressSelect,
  onVisitLogged,
}: ProximityListProps) {
  const [frozen, setFrozen] = useState(false);
  const [sortMode, setSortMode] = useState<"distance" | "street">("distance");
  const [tick, setTick] = useState(0);
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;

  useEffect(() => {
    const timer = setInterval(() => {
      if (!frozenRef.current) setTick((t) => t + 1);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const sorted = useMemo(() => {
    const withDist = addresses.map((a) => ({
      ...a,
      distance:
        userLat != null && userLng != null
          ? haversineM(userLat, userLng, a.latitude, a.longitude)
          : Infinity,
    }));

    if (sortMode === "distance") {
      withDist.sort((a, b) => a.distance - b.distance);
    } else {
      withDist.sort((a, b) =>
        (a.streetAddress ?? "").localeCompare(b.streetAddress ?? ""),
      );
    }
    return withDist;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses, userLat, userLng, sortMode, tick]);

  const hasGps = userLat != null && userLng != null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px",
        borderBottom: "1px solid var(--border, #e5e7eb)",
        fontSize: "13px",
      }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            onClick={() => setSortMode(sortMode === "distance" ? "street" : "distance")}
            style={{
              background: "none",
              border: "1px solid var(--border, #d1d5db)",
              borderRadius: "4px",
              padding: "2px 8px",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            {sortMode === "distance" ? "\ud83d\udccd Distance" : "\ud83c\udfe0 Street"}
          </button>
          {sortMode === "distance" && hasGps && (
            <button
              onClick={() => setFrozen((f) => !f)}
              style={{
                background: frozen ? "#fef3c7" : "none",
                border: "1px solid var(--border, #d1d5db)",
                borderRadius: "4px",
                padding: "2px 8px",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              {frozen ? "\ud83d\udd12 Frozen" : "\ud83d\udd13 Live"}
            </button>
          )}
        </div>
        <span style={{ color: "var(--text-muted, #6b7280)" }}>
          {addresses.length} addresses
        </span>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {sorted.map((addr) => {
          const isDone = addr.status === "contacted" || !!addr.lastVisitDate;
          const isDnc = addr.status === "do_not_call";

          return (
            <div
              key={addr.addressId}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "8px 12px",
                borderBottom: "1px solid var(--border, #f3f4f6)",
                borderLeft: isDnc
                  ? "3px solid #dc2626"
                  : isDone
                    ? "3px solid #16a34a"
                    : "3px solid transparent",
                opacity: isDnc ? 0.5 : 1,
                cursor: "pointer",
                gap: "8px",
              }}
              onClick={() => onAddressSelect?.(addr.addressId)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: "14px",
                  fontWeight: 500,
                  textDecoration: isDone ? "line-through" : "none",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                  {addr.streetAddress ?? "Unknown"}
                </div>
                {hasGps && addr.distance < Infinity && (
                  <div style={{ fontSize: "11px", color: "var(--text-muted, #9ca3af)" }}>
                    {formatDistance(addr.distance)}
                  </div>
                )}
              </div>

              {!isDnc && !isDone && (
                <div onClick={(e) => e.stopPropagation()}>
                  <QuickActionBar
                    territoryId={territoryId}
                    addressId={addr.addressId}
                    compact
                    onLogged={(outcome) => onVisitLogged?.(addr.addressId, outcome)}
                  />
                </div>
              )}

              {isDone && (
                <span style={{ fontSize: "11px", color: "#16a34a", fontWeight: 600 }}>
                  Done
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
