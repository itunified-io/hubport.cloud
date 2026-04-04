/**
 * Smart Resolve section — building-centric resolution.
 *
 * Finds uncovered residential buildings, clusters them by nearest territory,
 * and offers one-click "Include in #X" expansion per cluster.
 *
 * Manages its own dock/undock state internally via portal so the
 * component never unmounts and analysis results are preserved.
 */
import { useState, useCallback } from "react";
import { FormattedMessage } from "react-intl";
import {
  Sparkles, Loader2, MapPin,
  ArrowUpRight, CheckCircle2, AlertCircle,
  PanelRightClose, PanelRightOpen,
} from "lucide-react";
import {
  fetchSmartResolveAnalysis,
  resolveCluster,
  type BuildingCluster,
  type SmartResolveAnalysis,
} from "@/lib/territory-api";
import { FloatingWindow } from "@/components/ui/FloatingWindow";

export interface ClusterHighlightData {
  cluster: BuildingCluster | null;
}

interface GapResolutionSectionProps {
  token: string;
  onHighlightCluster: (data: ClusterHighlightData) => void;
  onResolved: () => void;
}

export function GapResolutionSection({
  token,
  onHighlightCluster,
  onResolved,
}: GapResolutionSectionProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SmartResolveAnalysis | null>(null);
  const [undocked, setUndocked] = useState(false);

  // Threshold
  const [maxDistance, setMaxDistance] = useState(200);

  // Per-cluster state
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const handleAnalyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelectedId(null);
    setConfirmingId(null);
    try {
      const data = await fetchSmartResolveAnalysis(token, maxDistance);
      setResult(data);
      setResolvedIds(new Set());
      if (data.clusters.length > 0) {
        setSelectedId(data.clusters[0]!.territoryId);
        onHighlightCluster({ cluster: data.clusters[0]! });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }, [token, maxDistance, onHighlightCluster]);

  const handleSelectCluster = useCallback((cluster: BuildingCluster) => {
    setSelectedId(cluster.territoryId);
    onHighlightCluster({ cluster });
    setConfirmingId(null);
  }, [onHighlightCluster]);

  const handleExpand = useCallback(async (cluster: BuildingCluster) => {
    setResolvingId(cluster.territoryId);
    setConfirmingId(null);
    setError(null);
    try {
      await resolveCluster(token, {
        action: "expand_cluster",
        territoryId: cluster.territoryId,
        buildingCoords: cluster.buildings.map((b) => [b.lng, b.lat]),
      });
      setResolvedIds((prev) => new Set([...prev, cluster.territoryId]));
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to expand territory");
    } finally {
      setResolvingId(null);
    }
  }, [token, onResolved]);

  const unresolvedCount = result
    ? result.clusters.filter((c) => !resolvedIds.has(c.territoryId)).length
    : 0;

  // ─── Content (shared between docked and undocked) ────────────────
  const content = (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="px-4 pt-3 pb-3 space-y-3 flex-shrink-0">
        <div>
          <label className="block text-[10px] font-medium text-[var(--text-muted)] mb-1">
            <FormattedMessage id="resolve.maxDistance" defaultMessage="Max. distance (m)" />
          </label>
          <input
            type="number"
            value={maxDistance}
            onChange={(e) => setMaxDistance(Math.max(10, parseInt(e.target.value) || 10))}
            min={10}
            max={1000}
            step={50}
            className="w-full px-2.5 py-2 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
          />
        </div>

        <button
          onClick={handleAnalyze}
          disabled={loading}
          className="w-full py-2.5 text-sm font-semibold text-black bg-[var(--amber)] rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              <FormattedMessage id="resolve.analyzing" defaultMessage="Finding uncovered..." />
            </>
          ) : (
            <>
              <Sparkles size={16} />
              <FormattedMessage id="resolve.findUncovered" defaultMessage="Find Uncovered" />
            </>
          )}
        </button>

        {error && (
          <div className="px-3 py-2.5 rounded-[var(--radius-sm)] bg-[#ef444414] text-xs text-[var(--red)] flex items-start gap-2">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}
      </div>

      {/* Empty state */}
      {result && result.clusters.length === 0 && result.unassigned.length === 0 && (
        <div className="flex flex-col items-center py-8 text-[var(--green)]">
          <CheckCircle2 size={28} strokeWidth={1.2} className="mb-2" />
          <p className="text-sm font-medium">
            <FormattedMessage id="resolve.allCovered" defaultMessage="All residential buildings are covered!" />
          </p>
        </div>
      )}

      {/* Cluster cards */}
      {result && result.clusters.length > 0 && (
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
          {result.clusters.map((cluster) => {
            const isResolved = resolvedIds.has(cluster.territoryId);
            const isResolving = resolvingId === cluster.territoryId;
            const isSelected = selectedId === cluster.territoryId;
            const isConfirming = confirmingId === cluster.territoryId;

            return (
              <div
                key={cluster.territoryId}
                className={`rounded-[var(--radius)] border p-4 space-y-3 transition-all cursor-pointer ${
                  isResolved
                    ? "border-[var(--green)]/30 bg-[#22c55e08]"
                    : isSelected
                      ? "border-[#3b82f6] bg-[#3b82f6]/5 shadow-sm ring-1 ring-[#3b82f6]/20"
                      : "border-[var(--border)] bg-[var(--bg)] hover:border-[#3b82f6]/40"
                }`}
                onClick={() => handleSelectCluster(cluster)}
                onMouseEnter={() => !isSelected && onHighlightCluster({ cluster })}
                onMouseLeave={() => {
                  if (isSelected) return;
                  const sel = selectedId ? result.clusters.find((c) => c.territoryId === selectedId) : null;
                  onHighlightCluster({ cluster: sel ?? null });
                }}
              >
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MapPin size={14} className={isSelected ? "text-[#3b82f6]" : "text-[var(--text-muted)]"} />
                    <span className="text-sm font-semibold text-[var(--text)]">
                      #{cluster.territoryNumber} {cluster.territoryName}
                    </span>
                  </div>
                  {isResolved && (
                    <span className="text-xs text-[var(--green)] font-medium flex items-center gap-1">
                      <CheckCircle2 size={12} />
                      <FormattedMessage id="resolve.resolved" defaultMessage="Resolved" />
                    </span>
                  )}
                </div>

                {/* Stats */}
                <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-[#ef4444] inline-block" />
                    <span className="font-semibold text-[var(--text)]">{cluster.buildings.length}</span>
                    {" "}
                    <FormattedMessage id="resolve.buildings" defaultMessage="buildings" />
                  </span>
                  <span className="text-[var(--border)]">|</span>
                  <span>{cluster.maxDistanceM}m <FormattedMessage id="resolve.away" defaultMessage="away" /></span>
                </div>

                {/* Building addresses — show when selected */}
                {isSelected && !isResolved && cluster.buildings.some((b) => b.streetAddress) && (
                  <div className="text-xs text-[var(--text-muted)] space-y-0.5 bg-[var(--glass)] rounded-[var(--radius-sm)] p-2.5">
                    {cluster.buildings
                      .filter((b) => b.streetAddress)
                      .map((b) => (
                        <div key={b.osmId} className="flex items-center justify-between">
                          <span>{b.streetAddress}</span>
                          <span className="text-[10px] font-mono">{b.distanceM}m</span>
                        </div>
                      ))}
                    {cluster.buildings.filter((b) => !b.streetAddress).length > 0 && (
                      <div className="text-[10px] text-[var(--text-muted)] pt-0.5">
                        +{cluster.buildings.filter((b) => !b.streetAddress).length}{" "}
                        <FormattedMessage id="resolve.withoutAddress" defaultMessage="without address" />
                      </div>
                    )}
                  </div>
                )}

                {/* Action button */}
                {!isResolved && !isResolving && isSelected && (
                  <div onClick={(e) => e.stopPropagation()}>
                    {!isConfirming ? (
                      <button
                        onClick={() => setConfirmingId(cluster.territoryId)}
                        className="w-full py-2.5 text-xs font-semibold text-white bg-[#3b82f6] rounded-[var(--radius-sm)] hover:bg-[#2563eb] cursor-pointer flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <ArrowUpRight size={12} />
                        <FormattedMessage
                          id="resolve.includeIn"
                          defaultMessage="Include in #{number}"
                          values={{ number: cluster.territoryNumber }}
                        />
                      </button>
                    ) : (
                      <div className="space-y-2 pt-1">
                        <div className="text-xs text-[var(--amber)] font-medium">
                          <FormattedMessage
                            id="resolve.confirmExpand"
                            defaultMessage="Expand #{number} to include {count} buildings?"
                            values={{ number: cluster.territoryNumber, count: cluster.buildings.length }}
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setConfirmingId(null)}
                            className="flex-1 py-2 text-xs text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer"
                          >
                            <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
                          </button>
                          <button
                            onClick={() => handleExpand(cluster)}
                            className="flex-1 py-2 text-xs font-semibold text-white bg-[#3b82f6] rounded-[var(--radius-sm)] hover:bg-[#2563eb] cursor-pointer flex items-center justify-center gap-1.5"
                          >
                            <ArrowUpRight size={12} />
                            <FormattedMessage id="resolve.apply" defaultMessage="Apply" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {isResolving && (
                  <div className="flex items-center justify-center py-3 text-[#3b82f6]">
                    <Loader2 size={16} className="animate-spin mr-2" />
                    <span className="text-sm">
                      <FormattedMessage id="resolve.expanding" defaultMessage="Expanding..." />
                    </span>
                  </div>
                )}
              </div>
            );
          })}

          {/* Unassigned buildings */}
          {result.unassigned.length > 0 && (
            <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <AlertCircle size={14} />
                <span className="font-semibold">
                  <FormattedMessage
                    id="resolve.unassigned"
                    defaultMessage="{count} buildings too far from any territory"
                    values={{ count: result.unassigned.length }}
                  />
                </span>
              </div>
              <p className="text-[10px] text-[var(--text-muted)]">
                <FormattedMessage
                  id="resolve.unassignedHint"
                  defaultMessage="These buildings are over {maxDist}m from any territory. Manual territory creation needed."
                  values={{ maxDist: maxDistance }}
                />
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ─── Undocked: FloatingWindow portal ─────────────────────────────
  if (undocked) {
    return (
      <>
        <div className="flex flex-col items-center justify-center py-8 text-[var(--text-muted)] space-y-3">
          <PanelRightClose size={24} strokeWidth={1.2} />
          <p className="text-xs">
            <FormattedMessage id="resolve.undockedHint" defaultMessage="Smart Resolve is undocked" />
          </p>
          <button
            onClick={() => setUndocked(false)}
            className="text-xs text-[var(--amber)] hover:text-[var(--amber-light)] flex items-center gap-1 cursor-pointer"
          >
            <PanelRightOpen size={12} />
            <FormattedMessage id="resolve.dock" defaultMessage="Dock back" />
          </button>
        </div>

        <FloatingWindow
          title={
            <span className="flex items-center gap-2">
              <FormattedMessage id="resolve.smartResolve" defaultMessage="Smart Resolve" />
              {result && unresolvedCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--amber)]/10 text-[var(--amber)] font-medium">
                  {unresolvedCount}
                </span>
              )}
            </span>
          }
          icon={<Sparkles size={14} className="text-[var(--amber)]" />}
          onClose={() => setUndocked(false)}
          initialWidth={460}
          initialHeight={480}
          minWidth={360}
          minHeight={300}
        >
          {content}
        </FloatingWindow>
      </>
    );
  }

  // ─── Docked: inline in sidebar ───────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-3 pb-1 flex items-center gap-2 flex-shrink-0">
        <Sparkles size={16} className="text-[var(--amber)]" />
        <span className="text-sm font-semibold text-[var(--text)]">
          <FormattedMessage id="resolve.smartResolve" defaultMessage="Smart Resolve" />
        </span>
        {result && unresolvedCount > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--amber)]/10 text-[var(--amber)] font-medium">
            {unresolvedCount}
          </span>
        )}
        <button
          onClick={() => setUndocked(true)}
          className="ml-auto text-[10px] text-[var(--text-muted)] hover:text-[var(--text)] flex items-center gap-1 cursor-pointer"
          title="Undock to floating window"
        >
          <PanelRightClose size={12} />
          <FormattedMessage id="resolve.undock" defaultMessage="Undock" />
        </button>
      </div>
      {content}
    </div>
  );
}
