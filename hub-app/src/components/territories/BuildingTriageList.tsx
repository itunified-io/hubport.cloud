/**
 * BuildingTriageList — Triage workflow list for gap detection buildings.
 *
 * Shows buildings with inline triage actions (confirm, ignore, needs visit),
 * clickable type chip for reclassification, and inline address editing.
 * Supports bulk select with batch toolbar.
 */
import { useState, useCallback, useMemo } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  CheckCircle2, XCircle, Eye, ChevronDown,
  Pencil,
} from "lucide-react";
import {
  upsertBuildingOverride,
  type GeoJsonFeature,
  type BuildingOverride,
  type TriageStatus,
} from "@/lib/territory-api";

// ─── Severity classification (mirrors backend) ─────────────────────

const RESIDENTIAL_TYPES = new Set([
  "house", "apartments", "residential", "detached", "semidetached_house", "terrace", "cabin",
]);
const MIXED_TYPES = new Set(["farm", "farm_auxiliary"]);
const IGNORABLE_TYPES = new Set([
  "garage", "garages", "commercial", "industrial", "retail",
  "shed", "barn", "church", "public",
  "warehouse", "office", "school", "hospital", "hotel", "supermarket",
  "service", "construction", "boathouse", "cowshed", "ruins",
  "roof", "hut", "transformer_tower", "bridge", "bunker",
  "carport", "kiosk", "toilets", "pavilion", "greenhouse",
]);

const ALLOWED_BUILDING_TYPES = [
  // Residential
  "house", "apartments", "residential", "detached", "semidetached_house", "terrace", "cabin",
  // Mixed
  "farm", "farm_auxiliary",
  // Non-residential
  "garage", "garages", "commercial", "industrial", "retail",
  "shed", "barn", "church", "public",
  "warehouse", "office", "school", "hospital", "hotel", "supermarket",
  "service", "construction", "boathouse", "cowshed", "ruins",
  "roof", "hut", "transformer_tower", "bridge", "bunker",
  "carport", "kiosk", "toilets", "pavilion", "greenhouse",
  // Uncertain
  "yes", "unknown",
];

const SEVERITY_COLORS = {
  high: "#ef4444",
  medium: "#f97316",
  low: "#eab308",
  ignorable: "#9ca3af",
} as const;

type SeverityLevel = keyof typeof SEVERITY_COLORS;

function classifySeverity(type: string | undefined, hasAddress: boolean): SeverityLevel {
  if (!type || type === "unknown") return "low";
  if (RESIDENTIAL_TYPES.has(type)) return "high";
  if (MIXED_TYPES.has(type)) return "medium";
  if (type === "yes") return hasAddress ? "medium" : "low";
  if (IGNORABLE_TYPES.has(type)) return "ignorable";
  return "low";
}

// ─── Sort priority by triage status ─────────────────────────────────

function triageSortOrder(status: TriageStatus | undefined, severity: SeverityLevel): number {
  // Unreviewed uncertain (yellow) first
  if ((!status || status === "unreviewed") && severity === "low") return 0;
  // Unreviewed non-uncertain
  if (!status || status === "unreviewed") return 1;
  // Confirmed
  if (status === "confirmed_residential") return 2;
  // Needs visit
  if (status === "needs_visit") return 3;
  // Ignored (bottom)
  if (status === "ignored") return 4;
  return 5;
}

// ─── Props ──────────────────────────────────────────────────────────

interface BuildingTriageListProps {
  features: GeoJsonFeature[];
  overrides: Map<string, BuildingOverride>;
  token: string;
  onOverrideChange: (osmId: string, override: BuildingOverride) => void;
  onBatchOverride: (osmIds: string[], triageStatus: TriageStatus) => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
}

// ─── Component ──────────────────────────────────────────────────────

export function BuildingTriageList({
  features,
  overrides,
  token,
  onOverrideChange,
  onBatchOverride,
  statusFilter,
  onStatusFilterChange,
}: BuildingTriageListProps) {
  const intl = useIntl();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingType, setEditingType] = useState<string | null>(null);
  const [editingAddress, setEditingAddress] = useState<string | null>(null);
  const [addressValue, setAddressValue] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  // Build enriched list with effective values
  const enrichedFeatures = useMemo(() => {
    return features
      .map((f) => {
        const osmId = f.properties?.osmId as string;
        const override = overrides.get(osmId);
        const effectiveType = override?.overriddenType ?? (f.properties?.buildingType as string | undefined) ?? "unknown";
        const effectiveHasAddress = (override?.overriddenAddress != null) || !!(f.properties?.streetAddress);
        const severity = classifySeverity(effectiveType, effectiveHasAddress);
        const triageStatus = override?.triageStatus as TriageStatus | undefined;
        return { feature: f, osmId, override, effectiveType, effectiveHasAddress, severity, triageStatus };
      })
      .filter((item) => {
        if (statusFilter === "all") return true;
        const status = item.triageStatus ?? "unreviewed";
        return status === statusFilter;
      })
      .sort((a, b) => {
        const orderA = triageSortOrder(a.triageStatus, a.severity);
        const orderB = triageSortOrder(b.triageStatus, b.severity);
        if (orderA !== orderB) return orderA - orderB;
        return (a.effectiveType ?? "").localeCompare(b.effectiveType ?? "");
      });
  }, [features, overrides, statusFilter]);

  const handleTriageAction = useCallback(async (osmId: string, triageStatus: TriageStatus) => {
    setSaving(osmId);
    try {
      const result = await upsertBuildingOverride(token, osmId, { triageStatus });
      onOverrideChange(osmId, result);
    } catch { /* ignore */ }
    setSaving(null);
  }, [token, onOverrideChange]);

  const handleTypeChange = useCallback(async (osmId: string, newType: string) => {
    setSaving(osmId);
    setEditingType(null);
    try {
      const result = await upsertBuildingOverride(token, osmId, { overriddenType: newType });
      onOverrideChange(osmId, result);
    } catch { /* ignore */ }
    setSaving(null);
  }, [token, onOverrideChange]);

  const handleAddressSave = useCallback(async (osmId: string) => {
    setSaving(osmId);
    setEditingAddress(null);
    try {
      const result = await upsertBuildingOverride(token, osmId, { overriddenAddress: addressValue || undefined });
      onOverrideChange(osmId, result);
    } catch { /* ignore */ }
    setSaving(null);
  }, [token, onOverrideChange, addressValue]);

  const toggleSelect = useCallback((osmId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(osmId)) next.delete(osmId); else next.add(osmId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selected.size === enrichedFeatures.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(enrichedFeatures.map((f) => f.osmId)));
    }
  }, [enrichedFeatures, selected.size]);

  const handleBatchAction = useCallback((triageStatus: TriageStatus) => {
    onBatchOverride(Array.from(selected), triageStatus);
    setSelected(new Set());
  }, [selected, onBatchOverride]);

  return (
    <div className="flex flex-col gap-2 px-3 pb-3">
      {/* Filter bar */}
      <div className="flex items-center gap-2 pt-2">
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
          className="text-[10px] px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--glass)] border border-[var(--border)] text-[var(--text)] cursor-pointer"
        >
          <option value="all">{intl.formatMessage({ id: "gap.filter.all", defaultMessage: "All" })}</option>
          <option value="unreviewed">{intl.formatMessage({ id: "gap.filter.unreviewed", defaultMessage: "Unreviewed" })}</option>
          <option value="confirmed_residential">{intl.formatMessage({ id: "gap.filter.confirmed", defaultMessage: "Confirmed" })}</option>
          <option value="needs_visit">{intl.formatMessage({ id: "gap.filter.needsVisit", defaultMessage: "Needs Visit" })}</option>
          <option value="ignored">{intl.formatMessage({ id: "gap.filter.ignored", defaultMessage: "Ignored" })}</option>
        </select>
        <span className="text-[9px] text-[var(--text-muted)]">
          {enrichedFeatures.length} <FormattedMessage id="gap.buildings" defaultMessage="buildings" />
        </span>
      </div>

      {/* Batch toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-[var(--radius-sm)] bg-[var(--amber)]/5 border border-[var(--amber)]/20">
          <span className="text-[9px] text-[var(--amber)] font-medium mr-auto">
            {selected.size} <FormattedMessage id="gap.selected" defaultMessage="selected" />
          </span>
          <button
            onClick={() => handleBatchAction("confirmed_residential")}
            className="text-[9px] px-2 py-0.5 rounded-[var(--radius-sm)] bg-green-500/10 text-green-400 hover:bg-green-500/20 cursor-pointer"
          >
            <FormattedMessage id="gap.batch.confirm" defaultMessage="Confirm All" />
          </button>
          <button
            onClick={() => handleBatchAction("ignored")}
            className="text-[9px] px-2 py-0.5 rounded-[var(--radius-sm)] bg-red-500/10 text-red-400 hover:bg-red-500/20 cursor-pointer"
          >
            <FormattedMessage id="gap.batch.ignore" defaultMessage="Ignore All" />
          </button>
          <button
            onClick={() => handleBatchAction("needs_visit")}
            className="text-[9px] px-2 py-0.5 rounded-[var(--radius-sm)] bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 cursor-pointer"
          >
            <FormattedMessage id="gap.batch.visit" defaultMessage="Mark for Visit" />
          </button>
        </div>
      )}

      {/* Select all checkbox */}
      {enrichedFeatures.length > 0 && (
        <div className="flex items-center gap-2 px-1">
          <input
            type="checkbox"
            checked={selected.size === enrichedFeatures.length && enrichedFeatures.length > 0}
            onChange={toggleSelectAll}
            className="w-3 h-3 cursor-pointer accent-[var(--amber)]"
          />
          <span className="text-[9px] text-[var(--text-muted)]">
            <FormattedMessage id="gap.selectAll" defaultMessage="Select all" />
          </span>
        </div>
      )}

      {/* Building list */}
      <ul className="space-y-0.5">
        {enrichedFeatures.map((item) => {
          const isIgnored = item.triageStatus === "ignored";
          const isEdited = !!item.override?.overriddenType || !!item.override?.overriddenAddress;
          const displayAddress = item.override?.overriddenAddress ?? (item.feature.properties?.streetAddress as string | null);
          const isSaving = saving === item.osmId;

          return (
            <li
              key={item.osmId}
              className={`flex items-center gap-1.5 px-1.5 py-1 rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors group ${
                isIgnored ? "opacity-40" : ""
              }`}
            >
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={selected.has(item.osmId)}
                onChange={() => toggleSelect(item.osmId)}
                className="w-3 h-3 flex-shrink-0 cursor-pointer accent-[var(--amber)]"
              />

              {/* Severity dot */}
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: SEVERITY_COLORS[item.severity] }}
              />

              {/* Main content */}
              <div className="flex-1 min-w-0 flex flex-col">
                {/* OSM ID + type chip */}
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-[var(--text-muted)] truncate">
                    {item.osmId}
                  </span>
                  {isEdited && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)] flex-shrink-0" title="Edited" />
                  )}

                  {/* Type chip (clickable) */}
                  <div className="relative flex-shrink-0">
                    <button
                      onClick={() => setEditingType(editingType === item.osmId ? null : item.osmId)}
                      className="text-[9px] px-1.5 py-0 rounded-full bg-[var(--glass)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass-hover)] cursor-pointer flex items-center gap-0.5"
                    >
                      {item.effectiveType}
                      <ChevronDown size={8} />
                    </button>

                    {/* Type dropdown */}
                    {editingType === item.osmId && (
                      <div className="absolute top-full left-0 mt-0.5 z-50 max-h-48 overflow-y-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] shadow-lg py-0.5 min-w-[140px]">
                        {ALLOWED_BUILDING_TYPES.map((type) => (
                          <button
                            key={type}
                            onClick={() => handleTypeChange(item.osmId, type)}
                            className={`block w-full text-left text-[9px] px-2 py-0.5 hover:bg-[var(--glass)] cursor-pointer ${
                              type === item.effectiveType ? "text-[var(--amber)] font-medium" : "text-[var(--text)]"
                            }`}
                          >
                            <span
                              className="inline-block w-2 h-2 rounded-full mr-1.5"
                              style={{
                                backgroundColor: SEVERITY_COLORS[classifySeverity(type, item.effectiveHasAddress)],
                              }}
                            />
                            {type}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Address (clickable to edit) */}
                {editingAddress === item.osmId ? (
                  <form
                    onSubmit={(e) => { e.preventDefault(); handleAddressSave(item.osmId); }}
                    className="flex items-center gap-1 mt-0.5"
                  >
                    <input
                      type="text"
                      value={addressValue}
                      onChange={(e) => setAddressValue(e.target.value)}
                      autoFocus
                      placeholder={intl.formatMessage({ id: "gap.addressPlaceholder", defaultMessage: "Enter address..." })}
                      className="flex-1 text-[9px] px-1.5 py-0.5 bg-[var(--glass)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] outline-none focus:border-[var(--amber)]"
                      onBlur={() => handleAddressSave(item.osmId)}
                    />
                  </form>
                ) : (
                  <button
                    onClick={() => {
                      setEditingAddress(item.osmId);
                      setAddressValue(displayAddress ?? "");
                    }}
                    className="text-[9px] text-[var(--text-muted)] hover:text-[var(--text)] truncate text-left cursor-pointer flex items-center gap-0.5 mt-0.5"
                  >
                    {displayAddress || (
                      <span className="italic opacity-50">
                        <Pencil size={8} className="inline mr-0.5" />
                        <FormattedMessage id="gap.noAddress" defaultMessage="no address" />
                      </span>
                    )}
                  </button>
                )}
              </div>

              {/* Triage actions / status badge */}
              <div className="flex items-center gap-0.5 flex-shrink-0">
                {isSaving ? (
                  <span className="text-[9px] text-[var(--text-muted)]">...</span>
                ) : item.triageStatus && item.triageStatus !== "unreviewed" ? (
                  // Show status badge (clickable to cycle back to unreviewed)
                  <button
                    onClick={() => handleTriageAction(item.osmId, "unreviewed")}
                    className={`text-[8px] px-1.5 py-0.5 rounded-full cursor-pointer ${
                      item.triageStatus === "confirmed_residential"
                        ? "bg-green-500/10 text-green-400"
                        : item.triageStatus === "needs_visit"
                          ? "bg-blue-500/10 text-blue-400"
                          : "bg-red-500/10 text-red-400"
                    }`}
                    title={intl.formatMessage({ id: "gap.clickToReset", defaultMessage: "Click to reset" })}
                  >
                    {item.triageStatus === "confirmed_residential" && (
                      <FormattedMessage id="gap.status.confirmed" defaultMessage="confirmed" />
                    )}
                    {item.triageStatus === "needs_visit" && (
                      <FormattedMessage id="gap.status.visit" defaultMessage="visit" />
                    )}
                    {item.triageStatus === "ignored" && (
                      <FormattedMessage id="gap.status.ignored" defaultMessage="ignored" />
                    )}
                  </button>
                ) : (
                  // Triage action icons
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleTriageAction(item.osmId, "confirmed_residential")}
                      className="p-0.5 rounded hover:bg-green-500/10 text-[var(--text-muted)] hover:text-green-400 cursor-pointer"
                      title={intl.formatMessage({ id: "gap.action.confirm", defaultMessage: "Confirm residential" })}
                    >
                      <CheckCircle2 size={12} />
                    </button>
                    <button
                      onClick={() => handleTriageAction(item.osmId, "ignored")}
                      className="p-0.5 rounded hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 cursor-pointer"
                      title={intl.formatMessage({ id: "gap.action.ignore", defaultMessage: "Ignore (not residential)" })}
                    >
                      <XCircle size={12} />
                    </button>
                    <button
                      onClick={() => handleTriageAction(item.osmId, "needs_visit")}
                      className="p-0.5 rounded hover:bg-blue-500/10 text-[var(--text-muted)] hover:text-blue-400 cursor-pointer"
                      title={intl.formatMessage({ id: "gap.action.visit", defaultMessage: "Needs field visit" })}
                    >
                      <Eye size={12} />
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {enrichedFeatures.length === 0 && (
        <p className="text-[10px] text-[var(--text-muted)] text-center py-4 italic">
          <FormattedMessage id="gap.noBuildings" defaultMessage="No buildings match the current filter." />
        </p>
      )}
    </div>
  );
}
