/**
 * SyncStatusBar — compact header component showing sync health.
 *
 * Displays:
 *  - Online / offline indicator (Cloud / CloudOff icon)
 *  - Pending changes badge (amber)
 *  - Sync error indicator (red dot)
 *  - Sync button (RefreshCw, animated as Loader2 while syncing)
 */
import { Cloud, CloudOff, RefreshCw, Loader2 } from "lucide-react";
import { useSyncStatus } from "@/hooks/useSyncStatus";

export function SyncStatusBar() {
  const { syncState, pendingCount, isOnline, syncNow } = useSyncStatus();

  const isSyncing = syncState === "pulling" || syncState === "pushing";
  const hasError = syncState === "error";

  return (
    <div className="flex items-center gap-1.5">
      {/* Online / offline indicator */}
      <div
        title={isOnline ? "Online" : "Offline"}
        className={`flex items-center justify-center w-6 h-6 rounded-full transition-colors ${
          isOnline
            ? "bg-[#22c55e14] text-[var(--green)]"
            : "bg-[var(--glass)] text-[var(--text-muted)]"
        }`}
      >
        {isOnline ? <Cloud size={13} /> : <CloudOff size={13} />}
      </div>

      {/* Pending changes badge */}
      {pendingCount > 0 && (
        <span
          title={`${pendingCount} pending change${pendingCount === 1 ? "" : "s"}`}
          className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold bg-[var(--amber)] text-black leading-none"
        >
          {pendingCount > 99 ? "99+" : pendingCount}
        </span>
      )}

      {/* Error indicator */}
      {hasError && !isSyncing && (
        <span
          title="Sync error — tap to retry"
          className="w-2 h-2 rounded-full bg-[var(--red)] shrink-0"
        />
      )}

      {/* Sync button */}
      <button
        onClick={syncNow}
        disabled={isSyncing || !isOnline}
        title={isSyncing ? "Syncing…" : "Sync now"}
        className="p-1.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        aria-label="Sync now"
      >
        {isSyncing ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <RefreshCw size={14} />
        )}
      </button>
    </div>
  );
}
