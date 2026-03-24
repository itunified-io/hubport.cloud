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
    return <div className="text-sm text-[var(--text-muted)] text-center py-2">Checking JW.org...</div>;
  }

  const now = new Date();
  const currentMonth = now.getFullYear() * 100 + (now.getMonth() + 1);

  return (
    <div>
      {error && <p className="text-[var(--red)] text-sm mb-2 text-center">{error}</p>}
      <div className="flex gap-2 overflow-x-auto pb-1.5 justify-center" style={{ scrollbarWidth: "thin" }}>
        {editions.map((ed) => {
          const parts = ed.yearMonth.split("-").map(Number);
          const y = parts[0] ?? 0;
          const m = parts[1] ?? 0;
          const edMonth = y * 100 + m;
          // Bimonthly: current if edMonth matches current or previous month
          const isCurrent = edMonth === currentMonth || edMonth === currentMonth - 1
            || (currentMonth % 100 === 1 && edMonth === (y - 1) * 100 + 12);
          const isActive = ed.yearMonth === activeYearMonth;

          return (
            <button
              key={ed.yearMonth}
              onClick={() => ed.imported ? onSelect(ed.yearMonth) : undefined}
              className={[
                "shrink-0 w-20 rounded-[6px] border overflow-hidden cursor-default transition-transform",
                "bg-[var(--bg-1)]",
                isActive ? "border-[#4a6da7] shadow-[0_0_0_1px_rgba(74,109,167,0.4)] -translate-y-0.5"
                  : isCurrent ? "border-[var(--amber)] shadow-[0_0_0_1px_rgba(245,158,11,0.15)]"
                  : ed.available ? "border-[var(--border)]"
                  : "border-[var(--border)] opacity-30",
                ed.imported ? "cursor-pointer" : "",
              ].join(" ")}
            >
              <div className="relative h-[90px] bg-[var(--bg-2)] overflow-hidden">
                {ed.thumbnailUrl ? (
                  <img
                    src={ed.thumbnailUrl}
                    alt={ed.label}
                    className="w-full h-full object-cover block"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-600 text-[9px]">—</div>
                )}
                {isCurrent && (
                  <span className="absolute top-[3px] right-[3px] px-1 py-px text-[7px] font-bold bg-[var(--amber)] text-black rounded-sm">
                    Now
                  </span>
                )}
                {ed.imported && (
                  <span className="absolute top-[3px] left-[3px] px-1 py-px text-[7px] font-bold bg-[#2563eb] text-white rounded-sm">
                    ✓
                  </span>
                )}
              </div>
              <div className="px-1 py-[3px]">
                <span className="text-[8px] font-medium text-[var(--text-muted)] leading-tight block">{ed.label}</span>
                {ed.available && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onImport(ed.yearMonth); }}
                    disabled={importingMonth !== null}
                    className={[
                      "w-full mt-0.5 px-1 py-px text-[8px] font-bold rounded disabled:opacity-50 cursor-pointer",
                      ed.imported
                        ? "bg-transparent border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-2)]"
                        : "bg-[var(--amber)] text-black hover:bg-[var(--amber-light)]",
                    ].join(" ")}
                  >
                    {importingMonth === ed.yearMonth ? "..." : ed.imported ? "↻" : "Import"}
                  </button>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
