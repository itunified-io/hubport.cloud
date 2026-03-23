import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../auth/useAuth";
import { getApiUrl } from "../../../lib/config";

interface WeekendMeeting {
  id: string;
  title: string;
  date: string;
  status: string;
  weekendStudyWeek?: {
    articleTitle: string;
    articleUrl: string | null;
    studyNumber: number | null;
  };
  assignments: Assignment[];
  talkSchedules: TalkSchedule[];
}

interface Assignment {
  id: string;
  status: string;
  slotTemplate: { slotKey: string; label: string; category: string };
  assignee?: { id: string; firstName: string; lastName: string; displayName?: string };
}

interface TalkSchedule {
  id: string;
  mode: string;
  invitationState: string;
  speaker: { firstName: string; lastName: string; congregationName?: string };
  publicTalk?: { talkNumber: number; title: string };
}

export function WeekendPlanner() {
  const { user } = useAuth();
  const [meetings, setMeetings] = useState<WeekendMeeting[]>([]);
  const [loading, setLoading] = useState(true);

  const apiUrl = getApiUrl();
  const headers = { Authorization: `Bearer ${user?.access_token}` };

  const loadMeetings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/meetings?type=weekend`, { headers });
      if (res.ok) {
        const data = await res.json();
        // Load full details for each
        const detailed = await Promise.all(
          data.slice(0, 12).map(async (m: { id: string }) => {
            const r = await fetch(`${apiUrl}/meetings/${m.id}`, { headers });
            return r.ok ? r.json() : m;
          }),
        );
        setMeetings(detailed);
      }
    } finally {
      setLoading(false);
    }
  }, [apiUrl, user?.access_token]);

  useEffect(() => { loadMeetings(); }, [loadMeetings]);

  if (loading) {
    return <div className="p-6 text-[var(--text-muted)]">Loading...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-[var(--text)]">Weekend Meeting Planner</h1>

      {meetings.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-muted)]">
          <p className="text-lg">No upcoming weekend meetings</p>
          <p className="mt-2">Create weekend meetings to start planning duties and public talks.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {meetings.map((meeting) => (
            <div
              key={meeting.id}
              className="bg-[var(--bg-1)] rounded-[var(--radius)] border border-[var(--border)] p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold text-[var(--text)]">
                    {new Date(meeting.date).toLocaleDateString("de-DE", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                  </span>
                </div>
                <span
                  className={`px-2 py-0.5 text-xs font-medium text-white rounded-full ${
                    meeting.status === "published" ? "bg-green-600" : meeting.status === "locked" ? "bg-red-600" : "bg-gray-600"
                  }`}
                >
                  {meeting.status}
                </span>
              </div>

              {/* Study Article */}
              {meeting.weekendStudyWeek && (
                <div className="p-3 bg-[var(--bg)] rounded-[var(--radius-sm)] border border-[var(--border)]">
                  <span className="text-xs text-[var(--text-muted)]">Watchtower Study</span>
                  <p className="text-sm font-medium text-[var(--text)]">
                    {meeting.weekendStudyWeek.articleTitle}
                  </p>
                  {meeting.weekendStudyWeek.articleUrl && (
                    <a
                      href={meeting.weekendStudyWeek.articleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[var(--amber)] hover:underline"
                    >
                      View Article →
                    </a>
                  )}
                </div>
              )}

              {/* Public Talk */}
              {meeting.talkSchedules?.length > 0 && (
                <div className="p-3 bg-[var(--bg)] rounded-[var(--radius-sm)] border border-[var(--border)]">
                  <span className="text-xs text-[var(--text-muted)]">Public Talk</span>
                  {meeting.talkSchedules.map((ts) => (
                    <div key={ts.id} className="flex items-center justify-between mt-1">
                      <div>
                        <span className="text-sm text-[var(--text)]">
                          {ts.speaker.firstName} {ts.speaker.lastName}
                        </span>
                        {ts.speaker.congregationName && ts.mode !== "local" && (
                          <span className="ml-2 text-xs text-[var(--text-muted)]">
                            ({ts.speaker.congregationName})
                          </span>
                        )}
                        {ts.publicTalk && (
                          <span className="ml-2 text-xs text-[var(--text-muted)]">
                            #{ts.publicTalk.talkNumber}: {ts.publicTalk.title}
                          </span>
                        )}
                      </div>
                      <span
                        className={`px-2 py-0.5 text-xs rounded-full ${
                          ts.invitationState === "confirmed"
                            ? "bg-green-600 text-white"
                            : ts.invitationState === "invited"
                              ? "bg-blue-600 text-white"
                              : "bg-gray-600 text-white"
                        }`}
                      >
                        {ts.invitationState}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Duties */}
              {meeting.assignments?.filter((a) => a.slotTemplate.category === "duty").length > 0 && (
                <div>
                  <span className="text-xs text-[var(--text-muted)]">Duties</span>
                  <div className="mt-1 grid grid-cols-2 gap-1">
                    {meeting.assignments
                      .filter((a) => a.slotTemplate.category === "duty")
                      .map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center justify-between px-2 py-1 bg-[var(--bg)] rounded-[var(--radius-sm)] text-sm"
                        >
                          <span className="text-[var(--text-muted)]">{a.slotTemplate.label}</span>
                          <span className={a.assignee ? "text-[var(--amber)]" : "text-[var(--text-muted)] italic"}>
                            {a.assignee
                              ? a.assignee.displayName || `${a.assignee.firstName} ${a.assignee.lastName}`
                              : "—"}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
