/**
 * UpdateBanner — prompts the user to update the app when a new service worker
 * is waiting, or forces an update when the server mandates a minimum client version.
 *
 * Two modes:
 *  - optional  (blue, dismissible) — a new SW is waiting but version is still acceptable
 *  - required  (red, non-dismissible) — server minClientVersion > current __APP_VERSION__
 *
 * Update flow:
 *  1. Push any pending local changes (best-effort; proceeds even on error)
 *  2. Wipe Dexie offline data to avoid stale schema issues
 *  3. Call updateServiceWorker(true) to activate the waiting SW
 *  4. Reload the page
 */
import { useState, useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { wipeOfflineData } from "@/lib/offline-db";
import { pushChanges } from "@/lib/sync-engine";
import { getCurrentDeviceUuid } from "@/lib/device-manager";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import { useAuth } from "@/auth/useAuth";

// Injected at build time by vite.config.ts define
declare const __APP_VERSION__: string;

interface UpdateBannerProps {
  /** Minimum acceptable client version from the server (ISO CalVer string). */
  minClientVersion?: string | null;
}

function isVersionOutdated(current: string, minimum: string): boolean {
  // CalVer comparison: lexicographic works because format is YYYY.MM.DD.TS
  return current < minimum;
}

export function UpdateBanner({ minClientVersion }: UpdateBannerProps) {
  const { user } = useAuth();
  const token = user?.access_token ?? null;
  const { pendingCount, isOnline } = useSyncStatus();
  const [dismissed, setDismissed] = useState(false);
  const [updating, setUpdating] = useState(false);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  // Determine if an update is required due to version enforcement
  const required =
    minClientVersion != null &&
    isVersionOutdated(__APP_VERSION__, minClientVersion);

  const visible = !dismissed && (needRefresh || required);

  // Force-show the banner if the server requires it even if SW has not yet
  // reported needRefresh (e.g. hard reload was blocked)
  useEffect(() => {
    if (required) setDismissed(false);
  }, [required]);

  if (!visible) return null;

  async function handleUpdate() {
    if (updating) return;
    setUpdating(true);
    try {
      // Step 1: push pending changes (best-effort)
      if (token && pendingCount > 0) {
        try {
          await pushChanges(token, getCurrentDeviceUuid());
        } catch {
          // don't block the update on push errors
        }
      }
      // Step 2: wipe Dexie (schema may have changed)
      await wipeOfflineData();
      // Step 3: activate the waiting service worker
      await updateServiceWorker(true);
      // Step 4: reload
      window.location.reload();
    } catch {
      setUpdating(false);
    }
  }

  const isRequired = required;
  const bgClass = isRequired
    ? "bg-[var(--red)] text-white"
    : "bg-[#1e40af] text-white";
  const buttonClass = isRequired
    ? "bg-white text-[var(--red)] hover:bg-white/90"
    : "bg-white text-[#1e40af] hover:bg-white/90";

  return (
    <div
      role="banner"
      className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium ${bgClass}`}
    >
      <span>
        {isRequired
          ? `This version is no longer supported. Please update to continue.`
          : `A new version is available.`}
        {pendingCount > 0 && (
          <span className="ml-1 opacity-80">
            ({pendingCount} pending change{pendingCount === 1 ? "" : "s"} will be pushed first)
          </span>
        )}
      </span>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleUpdate}
          disabled={updating || !isOnline}
          className={`px-3 py-1 rounded text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${buttonClass}`}
        >
          {updating ? "Updating…" : "Update now"}
        </button>

        {/* Dismiss only allowed for optional updates */}
        {!isRequired && (
          <button
            onClick={() => setDismissed(true)}
            className="opacity-70 hover:opacity-100 transition-opacity text-lg leading-none cursor-pointer"
            aria-label="Dismiss update notification"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
