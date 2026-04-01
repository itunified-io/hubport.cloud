import { useCallback, useEffect, useRef, useState } from "react";

export interface GpsState {
  lat: number | null;
  lng: number | null;
  heading: number | null;
  accuracy: number | null;
  speed: number | null;
  active: boolean;
  error: string | null;
  toggle: () => void;
}

/**
 * GPS position + compass heading tracker.
 *
 * Uses navigator.geolocation.watchPosition with high accuracy.
 * Heading from DeviceOrientationEvent (mobile compass) with fallback
 * to position-delta heading when speed > 1 m/s.
 */
export function useGpsTracker(): GpsState {
  const [active, setActive] = useState(false);
  const [position, setPosition] = useState<{
    lat: number | null;
    lng: number | null;
    accuracy: number | null;
    speed: number | null;
  }>({ lat: null, lng: null, accuracy: null, speed: null });
  const [heading, setHeading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const prevPosRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const headingThrottleRef = useRef<number>(0);

  // Position watcher
  useEffect(() => {
    if (!active) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    if (!navigator.geolocation) {
      setError("Geolocation not supported");
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy, speed } = pos.coords;
        setPosition({ lat: latitude, lng: longitude, accuracy, speed });
        setError(null);

        // Fallback heading from position delta when speed > 1 m/s
        const now = Date.now();
        if (prevPosRef.current && speed && speed > 1) {
          const dLng = longitude - prevPosRef.current.lng;
          const dLat = latitude - prevPosRef.current.lat;
          const angle = (Math.atan2(dLng, dLat) * 180) / Math.PI;
          setHeading((h) => {
            // Only use delta heading if no compass heading recently
            if (now - headingThrottleRef.current > 2000) {
              return (angle + 360) % 360;
            }
            return h;
          });
        }
        prevPosRef.current = { lat: latitude, lng: longitude, time: now };
      },
      (err) => {
        setError(err.message);
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 },
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [active]);

  // Compass heading (DeviceOrientationEvent)
  useEffect(() => {
    if (!active) return;

    function handleOrientation(e: DeviceOrientationEvent) {
      const now = Date.now();
      // Throttle to 500ms
      if (now - headingThrottleRef.current < 500) return;
      headingThrottleRef.current = now;

      // iOS: webkitCompassHeading (degrees from north, 0-360)
      // Android: alpha (degrees, but reversed)
      const evt = e as DeviceOrientationEvent & { webkitCompassHeading?: number };
      if (typeof evt.webkitCompassHeading === "number") {
        setHeading(evt.webkitCompassHeading);
      } else if (typeof e.alpha === "number") {
        setHeading((360 - e.alpha) % 360);
      }
    }

    window.addEventListener("deviceorientation", handleOrientation, true);
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation, true);
    };
  }, [active]);

  const toggle = useCallback(() => {
    setActive((a) => !a);
    setError(null);
  }, []);

  return {
    lat: position.lat,
    lng: position.lng,
    heading,
    accuracy: position.accuracy,
    speed: position.speed,
    active,
    error,
    toggle,
  };
}
