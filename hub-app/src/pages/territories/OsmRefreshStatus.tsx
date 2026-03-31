/**
 * Per-territory OSM refresh button with queue status polling.
 * Polls queue every 3s while active, shows status + counters.
 * Disabled during cooldown (if already queued/processing).
 */
import { useState, useEffect, useRef } from "react";
import { FormattedMessage } from "react-intl";
import {
  RefreshCw, CheckCircle2, XCircle, Clock, Loader2,
  Building, Plus, Pencil,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { refreshOsm, getOsmQueue, type OsmRefreshJob } from "@/lib/territory-api";

interface OsmRefreshStatusProps {
  territoryId: string;
}

export function OsmRefreshStatus({ territoryId }: OsmRefreshStatusProps) {
  const { user } = useAuth();
  const token = user?.access_token ?? "";

  const [job, setJob] = useState<OsmRefreshJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isActive = job?.status === "queued" || job?.status === "processing";

  // ─── Fetch latest job for this territory ──────────────────────

  const fetchStatus = async () => {
    if (!token) return;
    try {
      const queue = await getOsmQueue(token);
      const latest = queue.find((j) => j.territoryId === territoryId);
      setJob(latest ?? null);
    } catch {
      // silently fail
    }
  };

  useEffect(() => {
    void fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, territoryId]);

  // ─── Polling while active ─────────────────────────────────────

  useEffect(() => {
    if (isActive) {
      pollingRef.current = setInterval(() => void fetchStatus(), 3000);
    } else if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  // ─── Trigger refresh ──────────────────────────────────────────

  const handleRefresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const newJob = await refreshOsm(territoryId, token);
      setJob(newJob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start refresh");
    } finally {
      setLoading(false);
    }
  };

  // ─── Status rendering ─────────────────────────────────────────

  const renderStatus = () => {
    if (!job) return null;

    switch (job.status) {
      case "queued":
        return (
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
            <Clock size={12} />
            <FormattedMessage id="territories.osmQueued" defaultMessage="Queued..." />
          </div>
        );
      case "processing":
        return (
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--amber)]">
            <Loader2 size={12} className="animate-spin" />
            <FormattedMessage id="territories.osmProcessing" defaultMessage="Processing..." />
          </div>
        );
      case "completed":
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--green)]">
              <CheckCircle2 size={12} />
              <FormattedMessage id="territories.osmCompleted" defaultMessage="Completed" />
            </div>
            {(job.buildingsFound !== null || job.addressesCreated !== null) && (
              <div className="flex items-center gap-3 text-[9px] text-[var(--text-muted)]">
                {job.buildingsFound !== null && (
                  <span className="flex items-center gap-0.5">
                    <Building size={9} />
                    {job.buildingsFound}
                  </span>
                )}
                {job.addressesCreated !== null && (
                  <span className="flex items-center gap-0.5">
                    <Plus size={9} />
                    {job.addressesCreated} new
                  </span>
                )}
                {job.addressesUpdated !== null && (
                  <span className="flex items-center gap-0.5">
                    <Pencil size={9} />
                    {job.addressesUpdated} updated
                  </span>
                )}
              </div>
            )}
            {job.lastRefreshed && (
              <div className="text-[9px] text-[var(--text-muted)]">
                {new Date(job.lastRefreshed).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            )}
          </div>
        );
      case "failed":
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--red)]">
              <XCircle size={12} />
              <FormattedMessage id="territories.osmFailed" defaultMessage="Failed" />
            </div>
            {job.error && (
              <div className="text-[9px] text-[var(--red)] opacity-70 truncate max-w-[180px]">
                {job.error}
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)]">
      {/* Refresh button */}
      <button
        onClick={handleRefresh}
        disabled={loading || isActive}
        className="p-2 rounded-[var(--radius-sm)] text-[var(--amber)] hover:bg-[var(--glass)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        title={
          isActive
            ? "Refresh already in progress"
            : "Refresh OSM data"
        }
      >
        <RefreshCw size={18} className={isActive ? "animate-spin" : ""} />
      </button>

      {/* Status */}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-[var(--text)]">
          <FormattedMessage id="territories.osmRefresh" defaultMessage="OSM Refresh" />
        </div>
        {renderStatus()}
      </div>

      {/* Error */}
      {error && (
        <div className="text-[9px] text-[var(--red)] max-w-[120px] truncate">
          {error}
        </div>
      )}
    </div>
  );
}
