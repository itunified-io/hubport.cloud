import { useEffect, useRef } from "react";
import type { MapInstance } from "../../hooks/useMapLibre";

interface MyLocationMarkerProps {
  map: MapInstance | null;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  accuracy: number | null;
  visible: boolean;
}

/**
 * Apple Maps-style blue dot with heading cone and accuracy circle.
 * Uses MapLibre custom HTML Marker (not GeoJSON source) to avoid
 * full layer re-render on every GPS tick.
 */
export function MyLocationMarker({
  map,
  lat,
  lng,
  heading,
  accuracy,
  visible,
}: MyLocationMarkerProps) {
  const markerRef = useRef<unknown>(null);
  const elRef = useRef<HTMLDivElement | null>(null);

  // Create / update marker
  useEffect(() => {
    if (!map || lat == null || lng == null || !visible) {
      if (markerRef.current) {
        (markerRef.current as { remove: () => void }).remove();
        markerRef.current = null;
      }
      return;
    }

    async function initMarker() {
      if (!map || lat == null || lng == null) return;

      const maplibregl = await import("maplibre-gl");

      if (!elRef.current) {
        // Build DOM elements safely (no innerHTML)
        const el = document.createElement("div");
        el.className = "my-location-marker";

        const accuracyCircle = document.createElement("div");
        accuracyCircle.className = "accuracy-circle";

        const headingCone = document.createElement("div");
        headingCone.className = "heading-cone";

        const dotOuter = document.createElement("div");
        dotOuter.className = "dot-outer";

        const dotInner = document.createElement("div");
        dotInner.className = "dot-inner";

        el.appendChild(accuracyCircle);
        el.appendChild(headingCone);
        el.appendChild(dotOuter);
        el.appendChild(dotInner);

        elRef.current = el;
      }

      if (!markerRef.current) {
        const marker = new maplibregl.Marker({ element: elRef.current })
          .setLngLat([lng, lat])
          .addTo(map as unknown as maplibregl.Map);
        markerRef.current = marker;
      } else {
        (markerRef.current as { setLngLat: (pos: [number, number]) => void }).setLngLat([lng, lat]);
      }

      // Update heading cone rotation
      const cone = elRef.current.querySelector(".heading-cone") as HTMLElement | null;
      if (cone) {
        if (heading != null) {
          cone.style.transform = `rotate(${heading}deg)`;
          cone.style.opacity = "1";
        } else {
          cone.style.opacity = "0";
        }
      }

      // Update accuracy circle size
      const circle = elRef.current.querySelector(".accuracy-circle") as HTMLElement | null;
      if (circle && accuracy != null) {
        const zoom = (map as unknown as { getZoom: () => number }).getZoom?.() ?? 16;
        const metersPerPixel = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * Math.pow(2, zoom));
        const radiusPx = Math.min(Math.max(accuracy / metersPerPixel, 14), 200);
        circle.style.width = `${radiusPx * 2}px`;
        circle.style.height = `${radiusPx * 2}px`;
      }
    }

    initMarker();
  }, [map, lat, lng, heading, accuracy, visible]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (markerRef.current) {
        (markerRef.current as { remove: () => void }).remove();
        markerRef.current = null;
      }
    };
  }, []);

  return null;
}

/** CSS for MyLocationMarker. Inject once via a style tag. */
export const MY_LOCATION_MARKER_CSS = [
  ".my-location-marker { position: relative; width: 44px; height: 44px; }",
  ".my-location-marker .dot-outer { position: absolute; top: 50%; left: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; background: white; box-shadow: 0 0 6px rgba(59,130,246,0.5); }",
  ".my-location-marker .dot-inner { position: absolute; top: 50%; left: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; background: #3b82f6; }",
  ".my-location-marker .heading-cone { position: absolute; top: 50%; left: 50%; width: 0; height: 0; margin-left: -12px; margin-top: -40px; border-left: 12px solid transparent; border-right: 12px solid transparent; border-bottom: 32px solid rgba(59,130,246,0.12); transform-origin: center bottom; transition: transform 0.3s ease, opacity 0.3s ease; opacity: 0; }",
  ".my-location-marker .accuracy-circle { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); border-radius: 50%; background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.15); animation: pulse-accuracy 3s ease-in-out infinite; pointer-events: none; }",
  "@keyframes pulse-accuracy { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }",
].join("\n");
