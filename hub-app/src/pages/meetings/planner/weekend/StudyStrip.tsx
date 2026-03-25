// hub-app/src/pages/meetings/planner/weekend/StudyStrip.tsx
import type { StudyEdition } from "./types";

interface StudyStripProps {
  editions: StudyEdition[];
  activeYearMonth: string | null;
  importingMonth: string | null;
  loading: boolean;
  error: string;
  onSelect: (yearMonth: string) => void;
  onImport: (yearMonth: string) => void;
}

export function StudyStrip({
  editions, activeYearMonth, importingMonth, loading, error, onSelect, onImport,
}: StudyStripProps) {
  if (loading) {
    return (
      <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-1)] shadow-[0_1px_3px_rgba(0,0,0,0.3)] p-2">
        <div className="text-[10px] text-[var(--text-muted)] text-center py-1">Loading...</div>
      </div>
    );
  }

  const now = new Date();
  const currentMonth = now.getFullYear() * 100 + (now.getMonth() + 1);

  return (
    <div className="rounded-[var(--radius)] overflow-hidden border border-[var(--border)] bg-[var(--bg-1)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
      {error && <p className="text-[var(--red)] text-[9px] px-2 pt-1 text-center">{error}</p>}
      <div className="p-2 flex gap-1.5 justify-center flex-wrap">
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
                "shrink-0 w-14 rounded-[6px] border overflow-hidden cursor-default transition-all duration-200",
                "bg-[var(--bg-1)]",
                isActive
                  ? "border-[#4a6da7] shadow-[0_0_0_1px_rgba(74,109,167,0.4)] -translate-y-0.5"
                  : isCurrent
                    ? "border-[var(--amber)] shadow-[0_0_0_1px_rgba(245,158,11,0.15)]"
                    : ed.available
                      ? "border-[var(--border)]"
                      : "border-[var(--border)] opacity-30",
                ed.imported ? "cursor-pointer" : "",
              ].join(" ")}
              title={ed.label}
            >
              {/* Thumbnail */}
              <div className="relative h-16 bg-[var(--bg-2)] overflow-hidden">
                {ed.thumbnailUrl ? (
                  <img
                    src={ed.thumbnailUrl}
                    alt={ed.label}
                    className="w-full h-full object-cover block"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-600 text-[8px]">
                    —
                  </div>
                )}
                {isCurrent && (
                  <span className="absolute top-[3px] right-[3px] px-1 py-px text-[7px] font-bold bg-[var(--amber)] text-black rounded-sm leading-none">
                    Now
                  </span>
                )}
                {ed.imported && (
                  <span className="absolute top-[3px] left-[3px] px-1 py-px text-[6px] font-bold bg-[#2563eb] text-white rounded-sm leading-none">
                    &#10003;
                  </span>
                )}
              </div>

              {/* Label + reimport */}
              <div className="px-[3px] py-[2px]">
                <div className="text-[7px] font-medium text-[var(--text-muted)] leading-tight truncate">
                  {shortLabel(ed.label)}
                </div>
                {ed.available && ed.imported && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onImport(ed.yearMonth); }}
                    disabled={importingMonth !== null}
                    className="block mt-px mx-auto text-[6px] text-[var(--text-muted)] hover:text-[var(--amber)] disabled:opacity-50 cursor-pointer leading-none"
                    title="Reimport"
                  >
                    {importingMonth === ed.yearMonth ? "..." : "\u21BB"}
                  </button>
                )}
                {ed.available && !ed.imported && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onImport(ed.yearMonth); }}
                    disabled={importingMonth !== null}
                    className="w-full mt-0.5 px-1 py-px text-[7px] bg-[var(--amber)] text-black font-bold rounded hover:bg-[var(--amber-light)] disabled:opacity-50 cursor-pointer leading-tight"
                  >
                    {importingMonth === ed.yearMonth ? "..." : "Import"}
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

/** Shorten "Marz/April 2026" -> "Mar/Apr" */
function shortLabel(label: string): string {
  return label
    .replace(/\s*\d{4}$/, "")
    .replace(/([A-Za-z\u00C4\u00D6\u00DC\u00E4\u00F6\u00FC]{3})[a-z\u00E4\u00F6\u00FC]*/g, "$1");
}
