import { MapPin, Clock, Users, Check } from "lucide-react";
import type { ServiceGroupMeeting } from "@/lib/field-service-api";

interface MeetingListViewProps {
  meetings: ServiceGroupMeeting[];
  currentUserId?: string;
  onSignup: (meetingId: string) => void;
  onCancelSignup: (meetingId: string) => void;
  onMeetingClick: (meeting: ServiceGroupMeeting) => void;
}

const STATUS_STYLES: Record<string, string> = {
  planned: "bg-blue-500/20 text-blue-400",
  active: "bg-green-500/20 text-green-400",
  completed: "bg-[var(--glass)] text-[var(--text-muted)]",
  cancelled: "bg-red-500/20 text-red-400",
};

const STATUS_LABELS: Record<string, string> = {
  planned: "Geplant",
  active: "Aktiv",
  completed: "Abgeschlossen",
  cancelled: "Abgesagt",
};

export function MeetingListView({
  meetings,
  currentUserId,
  onSignup,
  onCancelSignup,
  onMeetingClick,
}: MeetingListViewProps) {
  // Group by date
  const grouped = meetings.reduce<Record<string, ServiceGroupMeeting[]>>((acc, m) => {
    const dateStr = new Date(m.date).toISOString().split("T")[0]!;
    if (!acc[dateStr]) acc[dateStr] = [];
    acc[dateStr].push(m);
    return acc;
  }, {});

  const sortedDates = Object.keys(grouped).sort();

  if (meetings.length === 0) {
    return (
      <div className="text-center py-16 text-[var(--text-muted)]">
        <Clock size={48} className="mx-auto mb-4 opacity-30" />
        <p className="text-lg mb-2">Keine Termine diese Woche</p>
        <p className="text-sm">Erstelle einen neuen Termin über den Button oben.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {sortedDates.map((dateStr) => {
        const date = new Date(dateStr + "T00:00:00");
        const dayMeetings = grouped[dateStr]!;
        return (
          <div key={dateStr}>
            <div className="text-xs font-semibold text-[var(--amber)] pb-2 mb-3 border-b border-[var(--border)]">
              {date.toLocaleDateString("de-DE", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </div>
            <div className="space-y-2">
              {dayMeetings.map((m) => {
                const isSignedUp = m.signups?.some(
                  (s) => s.publisherId === currentUserId && !s.cancelledAt,
                );
                return (
                  <div
                    key={m.id}
                    className="flex gap-4 p-4 bg-[var(--glass)] border border-[var(--border)] rounded-[var(--radius)] hover:border-[var(--amber)] transition-colors cursor-pointer"
                    onClick={() => onMeetingClick(m)}
                  >
                    {/* Time */}
                    <div className="text-sm font-semibold text-[var(--amber)] w-12 flex-shrink-0">
                      {m.time}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <MapPin size={13} className="text-[var(--text-muted)]" />
                        <span className="text-sm font-medium truncate">
                          {m.meetingPoint?.name ?? "Treffpunkt"}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_STYLES[m.status] ?? ""}`}>
                          {STATUS_LABELS[m.status] ?? m.status}
                        </span>
                        {m.campaignId && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400">
                            Aktion
                          </span>
                        )}
                      </div>
                      {m.conductorName && (
                        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                          <Users size={12} />
                          <span>Leiter: {m.conductorName}</span>
                        </div>
                      )}
                      {m.signupCount != null && (
                        <div className="text-xs text-[var(--text-muted)] mt-1">
                          {m.signupCount} Anmeldung{m.signupCount !== 1 ? "en" : ""}
                        </div>
                      )}
                    </div>

                    {/* Signup button */}
                    {m.status === "planned" && (
                      <div className="flex items-center">
                        {isSignedUp ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onCancelSignup(m.id);
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] border border-[var(--amber)] text-[var(--amber)] bg-[var(--amber)]/10 hover:bg-[var(--amber)]/20 transition-colors cursor-pointer"
                          >
                            <Check size={12} /> Angemeldet
                          </button>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onSignup(m.id);
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-sm)] border border-green-500 text-green-400 hover:bg-green-500/10 transition-colors cursor-pointer"
                          >
                            Anmelden
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
