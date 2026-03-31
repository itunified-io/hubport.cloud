/**
 * Gap Detection page.
 * Run detection (120s max), show results as markers,
 * click marker for popover with territory picker,
 * bulk actions (add to territory, ignore, override),
 * run history sidebar.
 */
import { useState, useEffect, useCallback } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  AlertTriangle, Play, Loader2, Clock, CheckCircle2, XCircle,
  MapPin, EyeOff, ChevronRight,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import {
  runGapDetection,
  getGapRuns,
  ignoreBuildings,
  type GapDetectionRun,
  type GeoJsonFeatureCollection,
  type GeoJsonFeature,
} from "@/lib/territory-api";

const STATUS_META: Record<string, { icon: React.ElementType; color: string }> = {
  pending: { icon: Clock, color: "text-[var(--text-muted)]" },
  running: { icon: Loader2, color: "text-[var(--amber)]" },
  completed: { icon: CheckCircle2, color: "text-[var(--green)]" },
  failed: { icon: XCircle, color: "text-[var(--red)]" },
};

interface GapDetectionProps {
  onShowResults?: (geoJson: GeoJsonFeatureCollection) => void;
}

export function GapDetection({ onShowResults }: GapDetectionProps) {
  const { user } = useAuth();
  const intl = useIntl();
  const token = user?.access_token ?? "";

  const [runs, setRuns] = useState<GapDetectionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedGaps, setSelectedGaps] = useState<Set<string>>(new Set());
  const [showIgnoreDialog, setShowIgnoreDialog] = useState(false);
  const [ignoreReason, setIgnoreReason] = useState("not_a_residence");
  const [ignoreEvidence, setIgnoreEvidence] = useState("satellite");

  const fetchRuns = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getGapRuns(token);
      setRuns(data);
      if (data.length > 0 && !selectedRunId) {
        setSelectedRunId(data[0]!.runId);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [token, selectedRunId]);

  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns]);

  // ─── Run detection ────────────────────────────────────────────

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    try {
      const run = await runGapDetection(token);
      setSelectedRunId(run.runId);
      await fetchRuns();
      if (run.resultGeoJson) {
        onShowResults?.(run.resultGeoJson);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({ id: "common.error", defaultMessage: "An error occurred" }),
      );
    } finally {
      setRunning(false);
    }
  };

  // ─── Show results on map ──────────────────────────────────────

  const selectedRun = runs.find((r) => r.runId === selectedRunId);

  const handleShowOnMap = (run: GapDetectionRun) => {
    setSelectedRunId(run.runId);
    if (run.resultGeoJson) {
      onShowResults?.(run.resultGeoJson);
    }
  };

  // ─── Bulk ignore ──────────────────────────────────────────────

  const handleBulkIgnore = async () => {
    if (selectedGaps.size === 0 || !selectedRun?.resultGeoJson) return;

    const buildings = selectedRun.resultGeoJson.features
      .filter((f: GeoJsonFeature) => selectedGaps.has(f.properties?.osmId as string))
      .map((f: GeoJsonFeature) => ({
        osmId: f.properties?.osmId as string,
        reason: ignoreReason,
        evidence: ignoreEvidence,
        latitude: f.geometry.type === "Point" ? (f.geometry.coordinates as number[])[1] : undefined,
        longitude: f.geometry.type === "Point" ? (f.geometry.coordinates as number[])[0] : undefined,
        streetAddress: f.properties?.streetAddress as string | undefined,
        buildingType: f.properties?.buildingType as string | undefined,
      }));

    try {
      await ignoreBuildings(buildings, token);
      setSelectedGaps(new Set());
      setShowIgnoreDialog(false);
      await fetchRuns();
    } catch {
      // handle silently
    }
  };

  const toggleGapSelection = (osmId: string) => {
    setSelectedGaps((prev) => {
      const next = new Set(prev);
      if (next.has(osmId)) next.delete(osmId);
      else next.add(osmId);
      return next;
    });
  };

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-[var(--border)] space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--text)] flex items-center gap-2">
            <AlertTriangle size={16} className="text-[var(--amber)]" />
            <FormattedMessage id="territories.gapDetection" defaultMessage="Gap Detection" />
          </h2>
        </div>

        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={running}
          className="w-full py-2.5 text-sm font-semibold text-black bg-[var(--amber)] rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {running ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              <FormattedMessage
                id="territories.gapRunning"
                defaultMessage="Detecting gaps... (up to 2 min)"
              />
            </>
          ) : (
            <>
              <Play size={16} />
              <FormattedMessage id="territories.gapRun" defaultMessage="Run Detection" />
            </>
          )}
        </button>

        {error && (
          <div className="px-3 py-2 rounded-[var(--radius-sm)] bg-[#ef444414] text-xs text-[var(--red)]">
            {error}
          </div>
        )}
      </div>

      {/* Results for selected run */}
      {selectedRun && selectedRun.status === "completed" && (
        <div className="p-4 border-b border-[var(--border)] space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 rounded-[var(--radius-sm)] bg-[var(--glass)]">
              <div className="text-lg font-bold text-[var(--text)]">
                {selectedRun.totalBuildings ?? 0}
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">Buildings</div>
            </div>
            <div className="p-2 rounded-[var(--radius-sm)] bg-[#22c55e14]">
              <div className="text-lg font-bold text-[var(--green)]">
                {selectedRun.coveredCount ?? 0}
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">Covered</div>
            </div>
            <div className="p-2 rounded-[var(--radius-sm)] bg-[#f9731614]">
              <div className="text-lg font-bold text-[var(--amber)]">
                {selectedRun.gapCount ?? 0}
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">Gaps</div>
            </div>
          </div>

          {/* Bulk actions */}
          {selectedGaps.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-muted)]">
                {selectedGaps.size} selected
              </span>
              <button
                onClick={() => setShowIgnoreDialog(true)}
                className="px-3 py-1 text-xs text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer flex items-center gap-1"
              >
                <EyeOff size={12} />
                <FormattedMessage id="territories.gapIgnore" defaultMessage="Ignore" />
              </button>
            </div>
          )}

          {/* Gap list */}
          {selectedRun.resultGeoJson && selectedRun.resultGeoJson.features.length > 0 && (
            <ul className="max-h-48 overflow-y-auto space-y-0.5">
              {selectedRun.resultGeoJson.features.map((feature: GeoJsonFeature) => {
                const osmId = feature.properties?.osmId as string;
                const isSelected = selectedGaps.has(osmId);
                return (
                  <li key={osmId}>
                    <button
                      onClick={() => toggleGapSelection(osmId)}
                      className={`w-full text-left px-3 py-2 text-xs rounded-[var(--radius-sm)] flex items-center gap-2 transition-colors cursor-pointer ${
                        isSelected
                          ? "bg-[var(--glass-2)] text-[var(--text)]"
                          : "text-[var(--text-muted)] hover:bg-[var(--glass)]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        readOnly
                        className="accent-[var(--amber)]"
                      />
                      <MapPin size={12} className="text-[var(--amber)]" />
                      <span className="truncate">
                        {(feature.properties?.streetAddress as string) ?? osmId}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Ignore dialog */}
      {showIgnoreDialog && (
        <div className="p-4 border-b border-[var(--border)] bg-[var(--bg-1)] space-y-3">
          <h3 className="text-xs font-semibold text-[var(--text)]">
            <FormattedMessage
              id="territories.gapIgnoreTitle"
              defaultMessage="Ignore {count} buildings"
              values={{ count: selectedGaps.size }}
            />
          </h3>
          <div>
            <label className="block text-[10px] font-medium text-[var(--text-muted)] mb-1">Reason</label>
            <select
              value={ignoreReason}
              onChange={(e) => setIgnoreReason(e.target.value)}
              className="w-full px-2 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] cursor-pointer"
            >
              <option value="garage_carport">Garage / Carport</option>
              <option value="shed_barn">Shed / Barn</option>
              <option value="commercial_industrial">Commercial / Industrial</option>
              <option value="church_public">Church / Public building</option>
              <option value="unoccupied_ruins">Unoccupied / Ruins</option>
              <option value="not_a_residence">Not a residence</option>
              <option value="duplicate">Duplicate</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-[var(--text-muted)] mb-1">Evidence</label>
            <select
              value={ignoreEvidence}
              onChange={(e) => setIgnoreEvidence(e.target.value)}
              className="w-full px-2 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] cursor-pointer"
            >
              <option value="satellite">Satellite imagery</option>
              <option value="local_visit">Local visit</option>
              <option value="osm_tags">OSM tags</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowIgnoreDialog(false)}
              className="flex-1 py-1.5 text-xs text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer"
            >
              <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
            </button>
            <button
              onClick={handleBulkIgnore}
              className="flex-1 py-1.5 text-xs font-semibold text-black bg-[var(--amber)] rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] cursor-pointer flex items-center justify-center gap-1"
            >
              <EyeOff size={12} />
              <FormattedMessage id="territories.gapIgnoreConfirm" defaultMessage="Ignore" />
            </button>
          </div>
        </div>
      )}

      {/* Run history */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-2 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
          <FormattedMessage id="territories.gapHistory" defaultMessage="Run History" />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--glass-2)] border-t-[var(--amber)]" />
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-[var(--text-muted)]">
            <AlertTriangle size={24} strokeWidth={1.2} className="mb-2" />
            <p className="text-xs">
              <FormattedMessage
                id="territories.gapNoRuns"
                defaultMessage="No detection runs yet"
              />
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {runs.map((run) => {
              const meta = STATUS_META[run.status] ?? STATUS_META.pending!;
              const Icon = meta.icon;
              const isActive = run.runId === selectedRunId;

              return (
                <li key={run.runId}>
                  <button
                    onClick={() => handleShowOnMap(run)}
                    className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors cursor-pointer ${
                      isActive ? "bg-[var(--glass-2)]" : "hover:bg-[var(--glass)]"
                    }`}
                  >
                    <Icon
                      size={16}
                      className={`${meta.color} ${run.status === "running" ? "animate-spin" : ""}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-[var(--text)]">
                        {new Date(run.startedAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      {run.status === "completed" && (
                        <div className="text-[10px] text-[var(--text-muted)]">
                          {run.gapCount ?? 0} gaps / {run.totalBuildings ?? 0} buildings
                        </div>
                      )}
                      {run.status === "failed" && (
                        <div className="text-[10px] text-[var(--red)]">Failed</div>
                      )}
                    </div>
                    <ChevronRight size={14} className="text-[var(--text-muted)]" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
