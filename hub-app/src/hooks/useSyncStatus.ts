/**
 * useSyncStatus — React hook that tracks the offline sync state.
 *
 * - Subscribes to sync engine state via onSyncStateChange
 * - Tracks pendingCount, lastSyncAt, and navigator.onLine
 * - Auto-syncs on tab visibility restore (if last sync > 5 min ago)
 * - Auto-syncs on reconnect via connectivity probe
 * - Exposes syncNow() for manual triggering
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/auth/useAuth";
import {
  onSyncStateChange,
  fullSync,
  getPendingCount,
  checkConnectivity,
  type SyncState,
} from "@/lib/sync-engine";
import { getCurrentDeviceUuid } from "@/lib/device-manager";
import { isOfflineReady, getOfflineDB } from "@/lib/offline-db";

const STALE_THRESHOLD_MS = 5 * 60 * 1_000; // 5 minutes

export interface SyncStatusResult {
  syncState: SyncState;
  pendingCount: number;
  lastSyncAt: string | null;
  isOnline: boolean;
  syncNow: () => void;
}

export function useSyncStatus(): SyncStatusResult {
  const { user } = useAuth();
  const token = user?.access_token ?? null;

  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Ref to track whether a sync is already in-flight (avoids double-firing)
  const syncing = useRef(false);

  // ─── Read lastSyncAt from Dexie syncMeta ───────────────────────

  const refreshMeta = useCallback(async () => {
    try {
      const db = getOfflineDB();
      const entry = await db.syncMeta.get("lastSyncAt");
      setLastSyncAt(entry?.value ?? null);
    } catch {
      // DB not yet initialised — ignore
    }
    try {
      const count = await getPendingCount();
      setPendingCount(count);
    } catch {
      // ignore
    }
  }, []);

  // ─── Subscribe to sync engine state ───────────────────────────

  useEffect(() => {
    const unsub = onSyncStateChange((s) => {
      setSyncState(s);
      if (s === "idle") {
        void refreshMeta();
      }
    });
    void refreshMeta();
    return unsub;
  }, [refreshMeta]);

  // ─── Core sync trigger ─────────────────────────────────────────

  const triggerSync = useCallback(async () => {
    if (!token || syncing.current) return;
    // Guard: don't attempt sync if offline DB is not yet initialised
    // (OfflineProvider init is async — auto-sync events can fire before it completes)
    if (!isOfflineReady()) return;
    const online = await checkConnectivity(token);
    if (!online) return;
    syncing.current = true;
    try {
      await fullSync(token, getCurrentDeviceUuid());
    } catch {
      // errors are reported via syncState ("error")
    } finally {
      syncing.current = false;
    }
  }, [token]);

  // ─── Auto-sync on tab visibility change ───────────────────────

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      const last = lastSyncAt ? new Date(lastSyncAt).getTime() : 0;
      if (now - last > STALE_THRESHOLD_MS) {
        void triggerSync();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [lastSyncAt, triggerSync]);

  // ─── Auto-sync on reconnect ────────────────────────────────────

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      void triggerSync();
    }
    function handleOffline() {
      setIsOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [triggerSync]);

  // ─── Public syncNow ────────────────────────────────────────────

  const syncNow = useCallback(() => {
    void triggerSync();
  }, [triggerSync]);

  return { syncState, pendingCount, lastSyncAt, isOnline, syncNow };
}
