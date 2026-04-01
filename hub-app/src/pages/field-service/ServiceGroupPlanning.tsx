import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import {
  CalendarDays,
  List,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  Plus,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { usePermissions } from "@/auth/PermissionProvider";
import { FormattedMessage } from "react-intl";
import {
  listServiceMeetings,
  listMeetingPoints,
  signupForMeeting,
  cancelSignup,
  type ServiceGroupMeeting,
  type FieldServiceMeetingPoint,
} from "@/lib/field-service-api";
import { WeekCalendar } from "./components/WeekCalendar";
import { MeetingListView } from "./components/MeetingListView";
import { CreateMeetingDialog } from "./components/CreateMeetingDialog";

function getISOWeek(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function getWeekDates(date: Date): Date[] {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function formatDateRange(dates: Date[]): string {
  if (dates.length === 0) return "";
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  const opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit" };
  return `${first.toLocaleDateString("de-DE", opts)} — ${last.toLocaleDateString("de-DE", { ...opts, year: "numeric" })}`;
}

export function ServiceGroupPlanning() {
  const { user } = useAuth();
  const token = user?.access_token;
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [meetings, setMeetings] = useState<ServiceGroupMeeting[]>([]);
  const [_meetingPoints, setMeetingPoints] = useState<FieldServiceMeetingPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const weekDates = useMemo(() => getWeekDates(currentDate), [currentDate]);
  const isoWeek = useMemo(() => getISOWeek(currentDate), [currentDate]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      listServiceMeetings(token, { week: isoWeek }),
      listMeetingPoints(token),
    ])
      .then(([m, p]) => {
        setMeetings(m);
        setMeetingPoints(p);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, isoWeek]);

  function prevWeek() {
    setCurrentDate((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() - 7);
      return n;
    });
  }

  function nextWeek() {
    setCurrentDate((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() + 7);
      return n;
    });
  }

  function goToday() {
    setCurrentDate(new Date());
  }

  async function handleSignup(meetingId: string) {
    if (!token) return;
    try {
      await signupForMeeting(meetingId, token);
      // Refresh
      const updated = await listServiceMeetings(token, { week: isoWeek });
      setMeetings(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    }
  }

  async function handleCancelSignup(meetingId: string) {
    if (!token) return;
    try {
      await cancelSignup(meetingId, token);
      const updated = await listServiceMeetings(token, { week: isoWeek });
      setMeetings(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <CalendarDays size={24} className="text-[var(--amber)]" />
          <h1 className="text-xl font-semibold">
            <FormattedMessage id="nav.fieldService.serviceGroups" />
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {can("app:service_meetings.manage") && (
            <button
              onClick={() => setShowCreateDialog(true)}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--amber)] text-black rounded-[var(--radius-sm)] font-medium text-sm hover:opacity-90 transition-opacity cursor-pointer"
            >
              <Plus size={16} />
              Neuer Termin
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 mb-4 bg-red-500/10 border border-red-500/30 rounded-[var(--radius-sm)] text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Navigation + View Toggle */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={prevWeek}
            className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={goToday}
            className="px-3 py-1 text-xs font-medium border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            Heute
          </button>
          <button
            onClick={nextWeek}
            className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            <ChevronRight size={18} />
          </button>
          <span className="text-sm text-[var(--text-muted)] ml-2">
            {formatDateRange(weekDates)}
          </span>
        </div>

        <div className="flex bg-[var(--glass)] border border-[var(--border)] rounded-[var(--radius-sm)] p-0.5">
          <button
            onClick={() => setView("calendar")}
            className={`p-1.5 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
              view === "calendar" ? "bg-[var(--amber)] text-black" : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => setView("list")}
            className={`p-1.5 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
              view === "list" ? "bg-[var(--amber)] text-black" : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            <List size={16} />
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-6 h-6 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : view === "calendar" ? (
        <WeekCalendar
          weekDates={weekDates}
          meetings={meetings}
          onMeetingClick={(m) => navigate(`/field-service/groups/${m.id}`)}
        />
      ) : (
        <MeetingListView
          meetings={meetings}
          currentUserId={user?.profile?.sub}
          onSignup={handleSignup}
          onCancelSignup={handleCancelSignup}
          onMeetingClick={(m) => navigate(`/field-service/groups/${m.id}`)}
        />
      )}

      {/* Create meeting dialog */}
      {showCreateDialog && token && (
        <CreateMeetingDialog
          token={token}
          onClose={() => setShowCreateDialog(false)}
          onCreated={async () => {
            const updated = await listServiceMeetings(token, { week: isoWeek });
            setMeetings(updated);
          }}
        />
      )}
    </div>
  );
}
