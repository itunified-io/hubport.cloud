/**
 * Toolbar dropdown for heatmap mode selection.
 * Supports 6 modes with time range sub-selector for density mode.
 */
import { useState, useRef, useEffect } from "react";
import { FormattedMessage } from "react-intl";
import {
  Layers, Clock, BarChart3, Ban, Languages, AlertTriangle, CircleDot,
  ChevronDown,
} from "lucide-react";
import type { HeatmapMode } from "@/lib/territory-api";

const HEATMAP_MODES: {
  value: HeatmapMode;
  icon: React.ElementType;
  label: string;
  description: string;
}[] = [
  {
    value: "recency",
    icon: Clock,
    label: "Visit Recency",
    description: "How recently each territory was worked",
  },
  {
    value: "density",
    icon: BarChart3,
    label: "Visit Density",
    description: "Number of visits per territory over time",
  },
  {
    value: "dnc",
    icon: Ban,
    label: "Do Not Call",
    description: "Addresses marked as do-not-call",
  },
  {
    value: "language",
    icon: Languages,
    label: "Language",
    description: "Addresses by language spoken",
  },
  {
    value: "gaps",
    icon: AlertTriangle,
    label: "Uncovered Gaps",
    description: "Buildings not assigned to any territory",
  },
  {
    value: "status",
    icon: CircleDot,
    label: "Address Status",
    description: "Addresses colored by current status",
  },
];

const TIME_RANGES = [
  { value: "3m", label: "3 months" },
  { value: "6m", label: "6 months" },
  { value: "12m", label: "12 months" },
];

interface HeatmapControlProps {
  activeMode: HeatmapMode | null;
  timeRange: string;
  onModeChange: (mode: HeatmapMode | null) => void;
  onTimeRangeChange: (range: string) => void;
}

export function HeatmapControl({
  activeMode,
  timeRange,
  onModeChange,
  onTimeRangeChange,
}: HeatmapControlProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const activeMeta = activeMode
    ? HEATMAP_MODES.find((m) => m.value === activeMode)
    : null;
  const ActiveIcon = activeMeta?.icon ?? Layers;

  return (
    <div ref={dropdownRef} className="relative">
      {/* Toggle button */}
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${
          activeMode
            ? "border-[var(--amber)] bg-[#d9770614] text-[var(--amber)]"
            : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--glass)]"
        }`}
      >
        <ActiveIcon size={16} />
        <span className="hidden sm:inline">
          {activeMeta?.label ?? (
            <FormattedMessage id="territories.heatmap" defaultMessage="Heatmap" />
          )}
        </span>
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius)] shadow-lg z-50 overflow-hidden">
          {/* Off option */}
          <button
            onClick={() => {
              onModeChange(null);
              setOpen(false);
            }}
            className={`w-full text-left px-4 py-2.5 text-sm transition-colors cursor-pointer ${
              !activeMode
                ? "bg-[var(--glass-2)] text-[var(--text)]"
                : "text-[var(--text-muted)] hover:bg-[var(--glass)]"
            }`}
          >
            <div className="flex items-center gap-2">
              <Layers size={16} />
              <span className="font-medium">
                <FormattedMessage id="territories.heatmapOff" defaultMessage="Off" />
              </span>
            </div>
          </button>

          <div className="border-t border-[var(--border)]" />

          {/* Mode options */}
          {HEATMAP_MODES.map(({ value, icon: Icon, label, description }) => (
            <button
              key={value}
              onClick={() => {
                onModeChange(value);
                if (value !== "density") setOpen(false);
              }}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors cursor-pointer ${
                activeMode === value
                  ? "bg-[var(--glass-2)] text-[var(--text)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--glass)]"
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon size={16} className={activeMode === value ? "text-[var(--amber)]" : ""} />
                <div>
                  <span className="font-medium block">{label}</span>
                  <span className="text-[10px] opacity-70">{description}</span>
                </div>
              </div>

              {/* Time range sub-selector for density */}
              {value === "density" && activeMode === "density" && (
                <div className="flex items-center gap-1 mt-2 ml-6">
                  {TIME_RANGES.map((tr) => (
                    <button
                      key={tr.value}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTimeRangeChange(tr.value);
                      }}
                      className={`px-2 py-0.5 text-[10px] rounded-full transition-colors cursor-pointer ${
                        timeRange === tr.value
                          ? "bg-[var(--amber)] text-black font-semibold"
                          : "bg-[var(--glass)] text-[var(--text-muted)] hover:bg-[var(--glass-2)]"
                      }`}
                    >
                      {tr.label}
                    </button>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
