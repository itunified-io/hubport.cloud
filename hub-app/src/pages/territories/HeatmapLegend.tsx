/**
 * Color/icon legend overlay per heatmap mode.
 * Shown when a heatmap mode is active.
 */
import {
  Clock, BarChart3, Ban, Languages, AlertTriangle, CircleDot,
  UserCheck, Home, Truck, Archive,
} from "lucide-react";
import { FormattedMessage } from "react-intl";
import type { HeatmapMode } from "@/lib/territory-api";

interface HeatmapLegendProps {
  mode: HeatmapMode;
  timeRange?: string;
}

export function HeatmapLegend({ mode, timeRange }: HeatmapLegendProps) {
  return (
    <div className="bg-[var(--bg)]/90 backdrop-blur-sm border border-[var(--border)] rounded-[var(--radius)] p-3 shadow-lg text-xs min-w-[180px]">
      {mode === "recency" && <RecencyLegend />}
      {mode === "density" && <DensityLegend timeRange={timeRange} />}
      {mode === "dnc" && <DncLegend />}
      {mode === "language" && <LanguageLegend />}
      {mode === "gaps" && <GapsLegend />}
      {mode === "status" && <StatusLegend />}
    </div>
  );
}

function RecencyLegend() {
  const items = [
    { color: "#22c55e", label: "< 2 months" },
    { color: "#eab308", label: "2-4 months" },
    { color: "#ef4444", label: "> 4 months" },
    { color: "#6b7280", label: "Never worked" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 font-semibold text-[var(--text)]">
        <Clock size={14} />
        <FormattedMessage id="territories.heatmap.recency" defaultMessage="Visit Recency" />
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-2 text-[var(--text-muted)]">
            <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: item.color }} />
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DensityLegend({ timeRange }: { timeRange?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 font-semibold text-[var(--text)]">
        <BarChart3 size={14} />
        <FormattedMessage id="territories.heatmap.density" defaultMessage="Visit Density" />
        {timeRange && (
          <span className="font-normal text-[var(--text-muted)]">({timeRange})</span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[var(--text-muted)]">Sparse</span>
        <div className="flex-1 h-3 rounded-full" style={{
          background: "linear-gradient(to right, rgba(217,119,6,0.1), rgba(217,119,6,0.9))",
        }} />
        <span className="text-[var(--text-muted)]">Dense</span>
      </div>
    </div>
  );
}

function DncLegend() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 font-semibold text-[var(--text)]">
        <Ban size={14} className="text-[var(--red)]" />
        <FormattedMessage id="territories.heatmap.dnc" defaultMessage="Do Not Call" />
      </div>
      <ul className="space-y-1 text-[var(--text-muted)]">
        <li className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-[var(--red)] flex-shrink-0" />
          DNC address
        </li>
        <li className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-[var(--red)] flex-shrink-0 flex items-center justify-center text-white text-[8px] font-bold">N</span>
          Cluster (N addresses)
        </li>
      </ul>
    </div>
  );
}

function LanguageLegend() {
  const colors = [
    { color: "#3b82f6", label: "Language 1" },
    { color: "#22c55e", label: "Language 2" },
    { color: "#f97316", label: "Language 3" },
    { color: "#a855f7", label: "Language 4" },
    { color: "#6b7280", label: "Other / Unknown" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 font-semibold text-[var(--text)]">
        <Languages size={14} />
        <FormattedMessage id="territories.heatmap.language" defaultMessage="Language" />
      </div>
      <ul className="space-y-1 text-[var(--text-muted)]">
        {colors.map((c) => (
          <li key={c.label} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
            {c.label}
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-[var(--text-muted)] opacity-60">
        <FormattedMessage
          id="territories.heatmap.languageHint"
          defaultMessage="Colors assigned dynamically based on languages in view"
        />
      </p>
    </div>
  );
}

function GapsLegend() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 font-semibold text-[var(--text)]">
        <AlertTriangle size={14} className="text-[var(--amber)]" />
        <FormattedMessage id="territories.heatmap.gaps" defaultMessage="Uncovered Gaps" />
      </div>
      <ul className="space-y-1 text-[var(--text-muted)]">
        <li className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-[#f97316] flex-shrink-0" />
          Uncovered building
        </li>
        <li className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-[#6b7280] opacity-40 flex-shrink-0" />
          Ignored building
        </li>
      </ul>
    </div>
  );
}

function StatusLegend() {
  const items: { icon: React.ElementType; color: string; label: string }[] = [
    { icon: UserCheck, color: "text-[var(--green)]", label: "Active" },
    { icon: Ban, color: "text-[var(--red)]", label: "Do Not Call" },
    { icon: Home, color: "text-[var(--amber)]", label: "Not at Home" },
    { icon: Truck, color: "text-[var(--text-muted)]", label: "Moved" },
    { icon: Languages, color: "text-[var(--blue)]", label: "Foreign Language" },
    { icon: Archive, color: "text-[var(--text-muted)]", label: "Archived" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 font-semibold text-[var(--text)]">
        <CircleDot size={14} />
        <FormattedMessage id="territories.heatmap.status" defaultMessage="Address Status" />
      </div>
      <ul className="space-y-1">
        {items.map(({ icon: Icon, color, label }) => (
          <li key={label} className="flex items-center gap-2 text-[var(--text-muted)]">
            <Icon size={12} className={color} />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
