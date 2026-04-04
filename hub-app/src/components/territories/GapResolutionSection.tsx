/**
 * Smart Gap Resolution section — analyzes uncovered areas between
 * territory polygons and proposes resolution actions.
 *
 * Renders directly inside the Gaps tab (no collapsible wrapper).
 * Gap cards highlight on the map when hovered/selected.
 * Expand action shows preview and requires confirmation.
 */
import { useState, useCallback } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  Sparkles, Loader2, Map as MapIcon,
  Plus, ArrowUpRight, CheckCircle2, AlertCircle, Eye,
} from "lucide-react";
import {
  fetchGapAnalysis,
  resolveGap,
  type GapAnalysisItem,
  type GapAnalysisResponse,
  type BuildingOverride,
} from "@/lib/territory-api";

interface GapResolutionSectionProps {
  token: string;
  onGapPolygonsChange: (polygons: object[]) => void;
  onResolved: () => void;
  onHighlightGap: (polygon: object | null) => void;
  overrides: Map<string, BuildingOverride>;
}

export function GapResolutionSection({
  token,
  onGapPolygonsChange,
  onResolved,
  onHighlightGap,
}: GapResolutionSectionProps) {
  const intl = useIntl();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GapAnalysisResponse | null>(null);

  // Threshold controls
  const [minBuildings, setMinBuildings] = useState(8);
  const [minArea, setMinArea] = useState(5000);

  // Per-gap resolution state
  const [resolvingGapId, setResolvingGapId] = useState<string | null>(null);
  const [resolvedGapIds, setResolvedGapIds] = useState<Set<string>>(new Set());

  // Selected gap for preview
  const [selectedGapId, setSelectedGapId] = useState<string | null>(null);

  // Expand confirmation state
  const [confirmingExpand, setConfirmingExpand] = useState<string | null>(null);

  // New territory form state (per gap)
  const [newTerritoryForm, setNewTerritoryForm] = useState<{
    gapId: string;
    name: string;
    number: string;
  } | null>(null);

  const handleAnalyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelectedGapId(null);
    setConfirmingExpand(null);
    try {
      const data = await fetchGapAnalysis(token, minBuildings, minArea);
      setResult(data);
      setResolvedGapIds(new Set());
      onGapPolygonsChange(data.gaps.map((g) => g.gapPolygon));
      // Auto-select first gap
      if (data.gaps.length > 0) {
        setSelectedGapId(data.gaps[0]!.gapId);
        onHighlightGap(data.gaps[0]!.gapPolygon);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }, [token, minBuildings, minArea, onGapPolygonsChange, onHighlightGap]);

  const handleSelectGap = useCallback((gap: GapAnalysisItem) => {
    setSelectedGapId(gap.gapId);
    onHighlightGap(gap.gapPolygon);
    setConfirmingExpand(null);
    setNewTerritoryForm(null);
  }, [onHighlightGap]);

  const handleCreateTerritory = useCallback(async (gap: GapAnalysisItem) => {
    if (!newTerritoryForm || newTerritoryForm.gapId !== gap.gapId) return;
    setResolvingGapId(gap.gapId);
    setError(null);
    try {
      await resolveGap(token, {
        gapPolygon: gap.gapPolygon,
        action: "new_territory",
        newTerritoryName: newTerritoryForm.name,
        newTerritoryNumber: newTerritoryForm.number,
      });
      setResolvedGapIds((prev) => new Set([...prev, gap.gapId]));
      setNewTerritoryForm(null);
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create territory");
    } finally {
      setResolvingGapId(null);
    }
  }, [token, newTerritoryForm, onResolved]);

  const handleExpandNeighbors = useCallback(async (gap: GapAnalysisItem) => {
    if (gap.neighborAssignments.length === 0) return;
    setResolvingGapId(gap.gapId);
    setConfirmingExpand(null);
    setError(null);
    try {
      await resolveGap(token, {
        gapPolygon: gap.gapPolygon,
        action: "expand_neighbors",
        neighborAssignments: gap.neighborAssignments.map((a) => ({
          territoryId: a.territoryId,
          buildingCoords: a.buildingCoords,
        })),
      });
      setResolvedGapIds((prev) => new Set([...prev, gap.gapId]));
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to expand neighbors");
    } finally {
      setResolvingGapId(null);
    }
  }, [token, onResolved]);

  const formatArea = (m2: number): string => {
    if (m2 >= 10_000) return `${(m2 / 10_000).toFixed(1)} ha`;
    return `${Math.round(m2).toLocaleString()} m\u00B2`;
  };

  const unresolvedCount = result ? result.gaps.filter(g => !resolvedGapIds.has(g.gapId)).length : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header + controls */}
      <div className="px-4 pt-3 pb-2 space-y-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-[var(--amber)]" />
          <span className="text-xs font-semibold text-[var(--text)]">
            <FormattedMessage id="gap.smartResolve" defaultMessage="Smart Resolve" />
          </span>
          {result && unresolvedCount > 0 && (
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--amber)]/10 text-[var(--amber)]">
              {unresolvedCount} <FormattedMessage id="gap.remaining" defaultMessage="remaining" />
            </span>
          )}
        </div>

        {/* Threshold controls */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[9px] font-medium text-[var(--text-muted)] mb-0.5">
              <FormattedMessage id="gap.minBuildings" defaultMessage="Min. residential" />
            </label>
            <input
              type="number"
              value={minBuildings}
              onChange={(e) => setMinBuildings(Math.max(1, parseInt(e.target.value) || 1))}
              min={1}
              max={100}
              className="w-full px-2 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
            />
          </div>
          <div>
            <label className="block text-[9px] font-medium text-[var(--text-muted)] mb-0.5">
              <FormattedMessage id="gap.minArea" defaultMessage="Min. area (m\u00B2)" />
            </label>
            <input
              type="number"
              value={minArea}
              onChange={(e) => setMinArea(Math.max(100, parseInt(e.target.value) || 100))}
              min={100}
              step={500}
              className="w-full px-2 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
            />
          </div>
        </div>

        <button
          onClick={handleAnalyze}
          disabled={loading}
          className="w-full py-2 text-xs font-semibold text-black bg-[var(--amber)] rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              <FormattedMessage id="gap.analyzing" defaultMessage="Analyzing gaps..." />
            </>
          ) : (
            <>
              <Sparkles size={14} />
              <FormattedMessage id="gap.analyzeGaps" defaultMessage="Analyze Gaps" />
            </>
          )}
        </button>

        {error && (
          <div className="px-3 py-2 rounded-[var(--radius-sm)] bg-[#ef444414] text-xs text-[var(--red)] flex items-start gap-2">
            <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}
      </div>

      {/* Gap cards */}
      {result && result.gaps.length === 0 && (
        <div className="flex flex-col items-center py-6 text-[var(--green)]">
          <CheckCircle2 size={24} strokeWidth={1.2} className="mb-2" />
          <p className="text-xs font-medium">
            <FormattedMessage id="gap.noGaps" defaultMessage="No significant gaps found!" />
          </p>
        </div>
      )}

      {result && result.gaps.length > 0 && (
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
          {result.gaps.map((gap, index) => {
            const isResolved = resolvedGapIds.has(gap.gapId);
            const isResolving = resolvingGapId === gap.gapId;
            const isSelected = selectedGapId === gap.gapId;
            const showForm = newTerritoryForm?.gapId === gap.gapId;
            const isConfirmingExpand = confirmingExpand === gap.gapId;

            return (
              <div
                key={gap.gapId}
                className={`rounded-[var(--radius)] border p-3 space-y-2 transition-all cursor-pointer ${
                  isResolved
                    ? "border-[var(--green)]/30 bg-[#22c55e08]"
                    : isSelected
                      ? "border-[var(--amber)] bg-[var(--amber)]/5 shadow-sm"
                      : "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--amber)]/40"
                }`}
                onClick={() => handleSelectGap(gap)}
                onMouseEnter={() => !isSelected && onHighlightGap(gap.gapPolygon)}
                onMouseLeave={() => !isSelected && onHighlightGap(selectedGapId ? (result.gaps.find(g => g.gapId === selectedGapId)?.gapPolygon ?? null) : null)}
              >
                {/* Gap header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <MapIcon size={12} className={isSelected ? "text-[var(--amber)]" : "text-[var(--text-muted)]"} />
                    <span className="text-[10px] font-medium text-[var(--text)]">
                      <FormattedMessage id="gap.gapLabel" defaultMessage="Gap {index}" values={{ index: index + 1 }} />
                    </span>
                  </div>
                  {isResolved && (
                    <span className="text-[10px] text-[var(--green)] font-medium flex items-center gap-1">
                      <CheckCircle2 size={10} />
                      <FormattedMessage id="gap.resolved" defaultMessage="Resolved" />
                    </span>
                  )}
                  {isSelected && !isResolved && (
                    <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-[var(--amber)]/10 text-[var(--amber)]">
                      <Eye size={8} className="inline mr-0.5" />
                      <FormattedMessage id="gap.preview" defaultMessage="Preview on map" />
                    </span>
                  )}
                </div>

                {/* Stats */}
                <div className="text-[10px] text-[var(--text-muted)]">
                  <span className="font-medium text-[var(--text)]">{gap.residentialCount}</span>
                  {" "}
                  <FormattedMessage id="gap.residential" defaultMessage="residential" />
                  {" / "}
                  {gap.totalBuildingCount}{" "}
                  <FormattedMessage id="gap.total" defaultMessage="total" />
                  {" \u00B7 "}
                  {formatArea(gap.areaMeter2)}
                </div>

                {/* Recommendation badge */}
                {!isResolved && (
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                        gap.recommendation === "new_territory"
                          ? "bg-[#3b82f614] text-[#3b82f6]"
                          : "bg-[#22c55e14] text-[var(--green)]"
                      }`}
                    >
                      {gap.recommendation === "new_territory" ? (
                        <FormattedMessage id="gap.recommendNew" defaultMessage="Recommended: New Territory" />
                      ) : (
                        <FormattedMessage id="gap.recommendExpand" defaultMessage="Recommended: Expand Neighbors" />
                      )}
                    </span>
                  </div>
                )}

                {/* Triage gate warning */}
                {gap.unreviewedCount > 0 && !isResolved && (
                  <div className="text-[9px] text-[var(--amber)] flex items-center gap-1 px-1.5 py-1 rounded bg-[var(--amber)]/5">
                    <AlertCircle size={10} />
                    <FormattedMessage
                      id="gap.unreviewedRemaining"
                      defaultMessage="{count} uncertain buildings remaining"
                      values={{ count: gap.unreviewedCount }}
                    />
                  </div>
                )}

                {/* Neighbor assignments preview — always show when selected */}
                {!isResolved && gap.neighborAssignments.length > 0 && isSelected && !showForm && (
                  <div className="text-[9px] text-[var(--text-muted)] space-y-0.5 bg-[var(--glass)] rounded-[var(--radius-sm)] p-2">
                    <div className="text-[8px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">
                      <FormattedMessage id="gap.neighborPreview" defaultMessage="Neighbor expansion preview" />
                    </div>
                    {gap.neighborAssignments.map((a) => (
                      <div key={a.territoryId} className="flex items-center justify-between">
                        <span>#{a.territoryNumber} {a.territoryName}</span>
                        <span className="font-mono text-[var(--text)]">+{a.buildingCount}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Action buttons — show when selected and no unreviewed */}
                {!isResolved && !isResolving && isSelected && (
                  <>
                    {/* Primary actions */}
                    {gap.unreviewedCount === 0 && !isConfirmingExpand && (
                      <div className="flex gap-1.5 pt-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => {
                            if (showForm) {
                              setNewTerritoryForm(null);
                            } else {
                              setNewTerritoryForm({ gapId: gap.gapId, name: "", number: "" });
                              setConfirmingExpand(null);
                            }
                          }}
                          className={`flex-1 py-1.5 text-[10px] font-medium rounded-[var(--radius-sm)] flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                            gap.recommendation === "new_territory"
                              ? "bg-[#3b82f6] text-white hover:bg-[#2563eb]"
                              : "border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--glass)]"
                          }`}
                        >
                          <Plus size={10} />
                          <FormattedMessage id="gap.createTerritory" defaultMessage="Create Territory" />
                        </button>
                        <button
                          onClick={() => setConfirmingExpand(gap.gapId)}
                          disabled={gap.neighborAssignments.length === 0}
                          className={`flex-1 py-1.5 text-[10px] font-medium rounded-[var(--radius-sm)] flex items-center justify-center gap-1 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                            gap.recommendation === "expand_neighbors"
                              ? "bg-[var(--green)] text-white hover:opacity-90"
                              : "border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--glass)]"
                          }`}
                        >
                          <ArrowUpRight size={10} />
                          <FormattedMessage id="gap.expandNeighbors" defaultMessage="Expand Neighbors" />
                        </button>
                      </div>
                    )}

                    {/* Expand confirmation */}
                    {isConfirmingExpand && (
                      <div className="pt-1 space-y-1.5 border-t border-[var(--glass-border)]" onClick={(e) => e.stopPropagation()}>
                        <div className="text-[9px] text-[var(--amber)] font-medium">
                          <FormattedMessage
                            id="gap.expandConfirm"
                            defaultMessage="Expand {count} territories? This will modify territory boundaries."
                            values={{ count: gap.neighborAssignments.length }}
                          />
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => setConfirmingExpand(null)}
                            className="flex-1 py-1.5 text-[10px] text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer"
                          >
                            <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
                          </button>
                          <button
                            onClick={() => handleExpandNeighbors(gap)}
                            className="flex-1 py-1.5 text-[10px] font-semibold text-white bg-[var(--green)] rounded-[var(--radius-sm)] hover:opacity-90 cursor-pointer flex items-center justify-center gap-1"
                          >
                            <ArrowUpRight size={10} />
                            <FormattedMessage id="gap.applyExpand" defaultMessage="Apply Expand" />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Force resolve — when unreviewed */}
                    {gap.unreviewedCount > 0 && !showForm && !isConfirmingExpand && (
                      <div className="text-center pt-1" onClick={(e) => e.stopPropagation()}>
                        <span className="text-[9px] text-[var(--text-muted)]">
                          <FormattedMessage
                            id="gap.forceResolve"
                            defaultMessage="Force resolve ({count} unreviewed):"
                            values={{ count: gap.unreviewedCount }}
                          />
                        </span>
                        <div className="flex gap-1.5 mt-1">
                          <button
                            onClick={() => { setNewTerritoryForm({ gapId: gap.gapId, name: "", number: "" }); setConfirmingExpand(null); }}
                            className="flex-1 py-1 text-[9px] text-[var(--text-muted)] hover:text-[var(--text)] border border-[var(--border)] rounded-[var(--radius-sm)] cursor-pointer"
                          >
                            <Plus size={8} className="inline mr-0.5" />
                            <FormattedMessage id="gap.forceNew" defaultMessage="New" />
                          </button>
                          <button
                            onClick={() => setConfirmingExpand(gap.gapId)}
                            disabled={gap.neighborAssignments.length === 0}
                            className="flex-1 py-1 text-[9px] text-[var(--text-muted)] hover:text-[var(--text)] border border-[var(--border)] rounded-[var(--radius-sm)] cursor-pointer disabled:opacity-40"
                          >
                            <ArrowUpRight size={8} className="inline mr-0.5" />
                            <FormattedMessage id="gap.forceExpand" defaultMessage="Expand" />
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Resolving spinner */}
                {isResolving && (
                  <div className="flex items-center justify-center py-2 text-[var(--amber)]">
                    <Loader2 size={14} className="animate-spin mr-2" />
                    <span className="text-xs">
                      <FormattedMessage id="gap.resolving" defaultMessage="Resolving..." />
                    </span>
                  </div>
                )}

                {/* New territory inline form */}
                {showForm && !isResolving && (
                  <div className="space-y-1.5 pt-1 border-t border-[var(--glass-border)]" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={newTerritoryForm.number}
                      onChange={(e) =>
                        setNewTerritoryForm({ ...newTerritoryForm, number: e.target.value })
                      }
                      placeholder={intl.formatMessage({ id: "gap.territoryNumber", defaultMessage: "Number (e.g. 301)" })}
                      className="w-full px-2 py-1.5 text-xs bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
                    />
                    <input
                      type="text"
                      value={newTerritoryForm.name}
                      onChange={(e) =>
                        setNewTerritoryForm({ ...newTerritoryForm, name: e.target.value })
                      }
                      placeholder={intl.formatMessage({ id: "gap.territoryName", defaultMessage: "Name (e.g. Gap Area 1)" })}
                      className="w-full px-2 py-1.5 text-xs bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
                    />
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => setNewTerritoryForm(null)}
                        className="flex-1 py-1.5 text-[10px] text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer"
                      >
                        <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
                      </button>
                      <button
                        onClick={() => handleCreateTerritory(gap)}
                        disabled={!newTerritoryForm.name || !newTerritoryForm.number}
                        className="flex-1 py-1.5 text-[10px] font-semibold text-white bg-[#3b82f6] rounded-[var(--radius-sm)] hover:bg-[#2563eb] disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1"
                      >
                        <Plus size={10} />
                        <FormattedMessage id="gap.applyCreate" defaultMessage="Create" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
