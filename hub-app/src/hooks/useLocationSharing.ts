import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/auth/useAuth";
import { updateLocationShare } from "../lib/territory-api";
import type { GpsState } from "./useGpsTracker";

interface UseLocationSharingOptions {
  fieldGroupId: string | null;
  publisherId: string | null;
  gps: GpsState;
  intervalMs?: number;
}

interface UseLocationSharingReturn {
  sharing: boolean;
  error: string | null;
}

/**
 * Polls location updates to the server while GPS is active and
 * the publisher is in a field group with location sharing enabled.
 */
export function useLocationSharing({
  fieldGroupId,
  publisherId,
  gps,
  intervalMs = 10000,
}: UseLocationSharingOptions): UseLocationSharingReturn {
  const { user } = useAuth();
  const token = user?.access_token ?? "";
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sendUpdate = useCallback(async () => {
    if (!fieldGroupId || !publisherId || !token || gps.lat == null || gps.lng == null) return;

    try {
      await updateLocationShare(fieldGroupId, {
        publisherId,
        latitude: gps.lat,
        longitude: gps.lng,
        heading: gps.heading,
        accuracy: gps.accuracy,
      }, token);
      setSharing(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
      if (err instanceof Error && err.message.includes("410")) {
        setSharing(false);
      }
    }
  }, [fieldGroupId, publisherId, token, gps.lat, gps.lng, gps.heading, gps.accuracy]);

  useEffect(() => {
    if (!fieldGroupId || !publisherId || !gps.active) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setSharing(false);
      return;
    }

    sendUpdate();
    timerRef.current = setInterval(sendUpdate, intervalMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [fieldGroupId, publisherId, gps.active, intervalMs, sendUpdate]);

  return { sharing, error };
}
