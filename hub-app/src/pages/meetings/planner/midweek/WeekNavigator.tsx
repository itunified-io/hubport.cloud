// hub-app/src/pages/meetings/planner/midweek/WeekNavigator.tsx
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PeriodMeeting } from "./types";

interface WeekNavigatorProps {
  meetings: PeriodMeeting[];
  currentIndex: number;
  onNavigate: (index: number) => void;
}

export function WeekNavigator({ meetings, currentIndex, onNavigate }: WeekNavigatorProps) {
  const meeting = meetings[currentIndex];
  if (!meeting) return null;

  const date = new Date(meeting.date);
  const dateStr = date.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const theme = meeting.workbookWeek?.theme;
  const dateRange = meeting.workbookWeek?.dateRange;
  const isThisWeek = isCurrentWeek(date);

  return (
    <div>
      {/* Arrow nav */}
      <div className="flex items-center justify-center gap-5 mb-3.5">
        <button
          onClick={() => onNavigate(currentIndex - 1)}
          disabled={currentIndex === 0}
          className="w-9 h-9 rounded-full border border-[var(--border)] bg-[var(--bg-1)] text-[var(--text-muted)] flex items-center justify-center hover:bg-[var(--bg-2)] hover:text-[var(--text)] hover:border-[var(--border-2)] disabled:opacity-30 disabled:cursor-default cursor-pointer transition-all"
        >
          <ChevronLeft size={18} />
        </button>

        <div className="text-center">
          <div className="text-base font-bold tracking-tight">{dateStr}</div>
          <div className="text-[11px] text-[var(--text-muted)] mt-px">
            {theme && <>{theme} · </>}
            {dateRange && <>{dateRange}</>}
            {isThisWeek && <> · <span className="text-[var(--amber)] font-semibold">Diese Woche</span></>}
          </div>
        </div>

        <button
          onClick={() => onNavigate(currentIndex + 1)}
          disabled={currentIndex >= meetings.length - 1}
          className="w-9 h-9 rounded-full border border-[var(--border)] bg-[var(--bg-1)] text-[var(--text-muted)] flex items-center justify-center hover:bg-[var(--bg-2)] hover:text-[var(--text)] hover:border-[var(--border-2)] disabled:opacity-30 disabled:cursor-default cursor-pointer transition-all"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Dot indicators */}
      <div className="flex gap-1 justify-center mb-4">
        {meetings.map((m, i) => (
          <button
            key={m.id}
            onClick={() => onNavigate(i)}
            title={new Date(m.date).toLocaleDateString("de-DE", { day: "numeric", month: "short" })}
            className={[
              "h-1.5 rounded-full cursor-pointer transition-all",
              i === currentIndex
                ? "w-5 bg-[var(--amber)]"
                : "w-1.5 bg-zinc-800 hover:bg-zinc-600",
            ].join(" ")}
          />
        ))}
      </div>
    </div>
  );
}

function isCurrentWeek(date: Date): boolean {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay() + 1); // Monday
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);
  return date >= startOfWeek && date <= endOfWeek;
}
