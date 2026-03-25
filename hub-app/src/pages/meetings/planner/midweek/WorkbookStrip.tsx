// hub-app/src/pages/meetings/planner/midweek/WorkbookStrip.tsx
import type { AvailableEdition } from "./types";

interface WorkbookStripProps {
  editions: AvailableEdition[];
  activeYearMonth: string | null;
  importingMonth: string | null;
  loading: boolean;
  error: string;
  onSelect: (yearMonth: string) => void;
  onImport: (yearMonth: string) => void;
}

export function WorkbookStrip({
  editions, activeYearMonth, importingMonth, loading, error, onSelect, onImport,
}: WorkbookStripProps) {
  if (loading) {
    return <div className="text-[10px] text-[var(--text-muted)] text-center py-1">Loading...</div>;
  }

  const now = new Date();
  const currentMonth = now.getFullYear() * 100 + (now.getMonth() + 1);

  return (
    <div>
      {error && <p className="text-[var(--red)] text-[9px] mb-1 text-center">{error}</p>}
      <div className="flex gap-1.5 overflow-x-auto justify-center items-end" style={{ scrollbarWidth: "none" }}>
        {editions.map((ed) => {
          const parts = ed.yearMonth.split("-").map(Number);
          const y = parts[0] ?? 0;
          const m = parts[1] ?? 0;
          const edMonth = y * 100 + m;
          const isCurrent = edMonth === currentMonth || edMonth === currentMonth - 1
            || (currentMonth % 100 === 1 && edMonth === (y - 1) * 100 + 12);
          const isActive = ed.yearMonth === activeYearMonth;

          return (
            <button
              key={ed.yearMonth}
              onClick={() => ed.imported ? onSelect(ed.yearMonth) : undefined}
              className={[
                "shrink-0 rounded-[5px] border overflow-hidden cursor-default transition-all duration-200",
                "bg-[var(--bg-1)]",
                // Active (selected) = larger, lifted, blue glow — dock-style highlight
                isActive ? "w-[52px] border-[#4a6da7] shadow-[0_0_8px_rgba(74,109,167,0.35)] -translate-y-px scale-105"
                  : isCurrent ? "w-[44px] border-[var(--amber)]/40"
                  : ed.available ? "w-[44px] border-[var(--border)]"
                  : "w-[38px] border-[var(--border)] opacity-25",
                ed.imported ? "cursor-pointer" : "",
              ].join(" ")}
              title={ed.label}
            >
              <div className={`relative bg-[var(--bg-2)] overflow-hidden ${isActive ? "h-[62px]" : "h-[52px]"}`}>
                {ed.thumbnailUrl ? (
                  <img
                    src={ed.thumbnailUrl}
                    alt={ed.label}
                    className="w-full h-full object-cover block"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-600 text-[7px]">—</div>
                )}
                {isCurrent && (
                  <span className="absolute top-[2px] right-[2px] px-0.5 py-px text-[6px] font-bold bg-[var(--amber)] text-black rounded-sm leading-none">
                    Now
                  </span>
                )}
                {ed.imported && (
                  <span className="absolute top-[2px] left-[2px] w-3 h-3 flex items-center justify-center text-[6px] font-bold bg-[#2563eb] text-white rounded-sm leading-none">
                    ✓
                  </span>
                )}
              </div>
              <div className="px-0.5 py-[2px] flex items-center justify-between gap-0.5">
                <span className={`text-[7px] font-medium text-[var(--text-muted)] leading-tight truncate ${isActive ? "" : "opacity-70"}`}>
                  {shortLabel(ed.label)}
                </span>
                {ed.available && ed.imported && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onImport(ed.yearMonth); }}
                    disabled={importingMonth !== null}
                    className="text-[7px] text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-50 cursor-pointer leading-none"
                    title="Reimport"
                  >
                    {importingMonth === ed.yearMonth ? "…" : "↻"}
                  </button>
                )}
                {ed.available && !ed.imported && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onImport(ed.yearMonth); }}
                    disabled={importingMonth !== null}
                    className="text-[7px] font-bold text-[var(--amber)] hover:text-[var(--amber-light)] disabled:opacity-50 cursor-pointer leading-none"
                  >
                    {importingMonth === ed.yearMonth ? "…" : "+"}
                  </button>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {/* Active indicator dot below the strip */}
      <div className="flex justify-center mt-1">
        <div className="w-1 h-1 rounded-full bg-[#4a6da7]" />
      </div>
    </div>
  );
}

/** Shorten "März/April 2026" → "Mär/Apr" */
function shortLabel(label: string): string {
  return label
    .replace(/\s*\d{4}$/, "") // Remove year
    .replace(/([A-Za-zÄÖÜäöü]{3})[a-zäöü]*/g, "$1"); // Truncate month names to 3 chars
}
