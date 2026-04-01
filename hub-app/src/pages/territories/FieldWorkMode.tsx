import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { useAuth } from "@/auth/useAuth";
import { useGpsTracker } from "@/hooks/useGpsTracker";
import { useMapLibre } from "@/hooks/useMapLibre";
import { MyLocationMarker, MY_LOCATION_MARKER_CSS } from "@/components/map/MyLocationMarker";
import { QuickActionBar } from "@/components/territory/QuickActionBar";
import { ProximityList } from "@/components/territory/ProximityList";
import { BottomSheet } from "@/components/territory/BottomSheet";
import {
  getTerritory,
  listAddresses,
  type Address,
  type VisitOutcome,
} from "@/lib/territory-api";

type SheetState = "collapsed" | "peek" | "expanded";

export default function FieldWorkMode() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const token = user?.access_token ?? "";
  const gps = useGpsTracker();

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const { mapRef } = useMapLibre({
    container: mapContainerRef,
    zoom: 17,
  });

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddr, setSelectedAddr] = useState<Address | null>(null);
  const [sheetState, setSheetState] = useState<SheetState>("collapsed");
  const [territoryName, setTerritoryName] = useState("");

  // Inject marker CSS once
  useEffect(() => {
    const styleId = "my-location-marker-style";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = MY_LOCATION_MARKER_CSS;
      document.head.appendChild(style);
    }
  }, []);

  // Load territory + addresses
  useEffect(() => {
    if (!id || !token) return;
    Promise.all([
      getTerritory(id, token),
      listAddresses(id, token),
    ]).then(([territory, addrResp]) => {
      setTerritoryName(territory.name ?? territory.number ?? "");
      // listAddresses returns { addresses, meta } or array depending on response
      const addrs = Array.isArray(addrResp) ? addrResp : addrResp.addresses;
      setAddresses(addrs);
    });
  }, [id, token]);

  // Auto-activate GPS
  useEffect(() => {
    if (!gps.active) gps.toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Center map on first GPS fix
  const centeredRef = useRef(false);
  useEffect(() => {
    if (gps.lat != null && gps.lng != null && !centeredRef.current && mapRef.current) {
      mapRef.current.fitBounds(
        [[gps.lng - 0.002, gps.lat - 0.002], [gps.lng + 0.002, gps.lat + 0.002]],
        { padding: 60 },
      );
      centeredRef.current = true;
    }
  }, [gps.lat, gps.lng, mapRef]);

  const handleAddressSelect = useCallback((addressId: string) => {
    const addr = addresses.find((a) => a.addressId === addressId);
    if (addr) {
      setSelectedAddr(addr);
      setSheetState("peek");
    }
  }, [addresses]);

  const handleVisitLogged = useCallback((_addressId: string, outcome: VisitOutcome) => {
    setAddresses((prev) =>
      prev.map((a) =>
        a.addressId === _addressId
          ? { ...a, lastVisitDate: new Date().toISOString(), status: outcome === "do_not_call" ? "do_not_call" as const : a.status }
          : a,
      ),
    );
    setTimeout(() => setSheetState("collapsed"), 800);
  }, []);

  const handleRecenter = useCallback(() => {
    if (gps.lat != null && gps.lng != null && mapRef.current) {
      mapRef.current.fitBounds(
        [[gps.lng - 0.001, gps.lat - 0.001], [gps.lng + 0.001, gps.lat + 0.001]],
        { padding: 60 },
      );
    }
  }, [gps.lat, gps.lng, mapRef]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 900, background: "black" }}>
      {/* Map */}
      <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />

      {/* GPS marker */}
      <MyLocationMarker
        map={mapRef.current}
        lat={gps.lat}
        lng={gps.lng}
        heading={gps.heading}
        accuracy={gps.accuracy}
        visible={gps.active}
      />

      {/* Back button */}
      <button
        onClick={() => navigate(`/territories/${id}`)}
        style={{
          position: "fixed",
          top: "12px",
          left: "12px",
          zIndex: 1001,
          background: "var(--bg-surface, white)",
          border: "none",
          borderRadius: "8px",
          padding: "8px 12px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          cursor: "pointer",
          fontSize: "14px",
          fontWeight: 600,
        }}
      >
        &larr; {territoryName}
      </button>

      {/* Recenter button */}
      <button
        onClick={handleRecenter}
        style={{
          position: "fixed",
          bottom: sheetState === "collapsed" ? "80px" : sheetState === "peek" ? "200px" : "62vh",
          right: "12px",
          zIndex: 1001,
          background: "var(--bg-surface, white)",
          border: "none",
          borderRadius: "50%",
          width: "44px",
          height: "44px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          cursor: "pointer",
          fontSize: "18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "bottom 0.3s ease",
        }}
      >
        &#8982;
      </button>

      {/* Bottom sheet */}
      <BottomSheet
        state={sheetState}
        onStateChange={setSheetState}
        collapsedContent={
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
            <span style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: gps.active ? "#3b82f6" : "#9ca3af",
            }} />
            <span>{gps.active ? "GPS active" : "GPS off"}</span>
            {gps.error && <span style={{ color: "#dc2626" }}>{gps.error}</span>}
          </div>
        }
        peekContent={
          selectedAddr && id ? (
            <div>
              <div style={{ fontWeight: 600, fontSize: "16px", marginBottom: "8px" }}>
                {selectedAddr.streetAddress ?? "Unknown address"}
              </div>
              <QuickActionBar
                territoryId={id}
                addressId={selectedAddr.addressId}
                onLogged={(outcome) => handleVisitLogged(selectedAddr.addressId, outcome)}
              />
            </div>
          ) : null
        }
        expandedContent={
          id ? (
            <ProximityList
              addresses={addresses}
              territoryId={id}
              userLat={gps.lat}
              userLng={gps.lng}
              onAddressSelect={handleAddressSelect}
              onVisitLogged={handleVisitLogged}
            />
          ) : null
        }
      />
    </div>
  );
}
