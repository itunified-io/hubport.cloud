import type { ServiceGroupMeeting } from "@/lib/field-service-api";

const DAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

interface WeekCalendarProps {
  weekDates: Date[];
  meetings: ServiceGroupMeeting[];
  onMeetingClick: (meeting: ServiceGroupMeeting) => void;
}

export function WeekCalendar({ weekDates, meetings, onMeetingClick }: WeekCalendarProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function getMeetingsForDate(date: Date): ServiceGroupMeeting[] {
    const dateStr = date.toISOString().split("T")[0];
    return meetings.filter((m) => {
      const mDate = new Date(m.date).toISOString().split("T")[0];
      return mDate === dateStr;
    });
  }

  function isToday(date: Date): boolean {
    return date.toDateString() === today.toDateString();
  }

  return (
    <div className="grid grid-cols-7 gap-1">
      {/* Day headers */}
      {weekDates.map((date, i) => (
        <div
          key={`header-${i}`}
          className={`text-center text-xs font-medium py-2 ${
            isToday(date) ? "text-[var(--amber)]" : "text-[var(--text-muted)]"
          }`}
        >
          <div>{DAY_LABELS[i]}</div>
          <div className={`text-lg ${isToday(date) ? "font-bold" : ""}`}>
            {date.getDate()}
          </div>
        </div>
      ))}

      {/* Day cells */}
      {weekDates.map((date, i) => {
        const dayMeetings = getMeetingsForDate(date);
        return (
          <div
            key={`cell-${i}`}
            className={`min-h-[100px] bg-[var(--glass)] rounded-[var(--radius-sm)] p-2 ${
              isToday(date) ? "border border-[var(--amber)]" : "border border-[var(--border)]"
            }`}
          >
            {dayMeetings.length === 0 && (
              <div className="text-xs text-[var(--text-muted)] opacity-30 text-center mt-6">—</div>
            )}
            {dayMeetings.map((m) => (
              <button
                key={m.id}
                onClick={() => onMeetingClick(m)}
                className={`w-full text-left mb-1 px-2 py-1.5 rounded text-xs border-l-2 transition-colors cursor-pointer ${
                  m.status === "active"
                    ? "bg-green-500/15 border-green-500 text-green-400 hover:bg-green-500/25"
                    : m.status === "completed"
                    ? "bg-[var(--glass)] border-[var(--text-muted)] text-[var(--text-muted)] hover:bg-[var(--glass-2)]"
                    : m.campaignId
                    ? "bg-orange-500/10 border-orange-500 text-orange-400 hover:bg-orange-500/20"
                    : "bg-[var(--amber)]/10 border-[var(--amber)] text-[var(--amber)] hover:bg-[var(--amber)]/20"
                }`}
              >
                <div className="font-semibold">{m.time}</div>
                <div className="truncate opacity-80">
                  {m.meetingPoint?.name ?? "Treffpunkt"}
                </div>
                {m.campaignId && (
                  <div className="text-[9px] opacity-60 mt-0.5">Aktion</div>
                )}
                {m.signupCount != null && m.signupCount > 0 && (
                  <div className="opacity-60 mt-0.5">{m.signupCount} Teiln.</div>
                )}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
