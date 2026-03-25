// hub-app/src/pages/meetings/planner/WeekendPlanner.tsx
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../auth/useAuth";
import { getApiUrl } from "../../../lib/config";
import { Headphones, Shield, Sparkles, Send, Printer } from "lucide-react";
import type { WeekendMeeting, StudyEdition, PublicTalk, Assignment } from "./weekend/types";
import type { PeriodMeeting } from "./midweek/types";
import { WeekNavigator } from "./midweek/WeekNavigator";
import { AssignmentPicker } from "./midweek/AssignmentPicker";
import { StudyStrip } from "./weekend/StudyStrip";
import { ProgramCard } from "./weekend/ProgramCard";
import { TalkPicker } from "./weekend/TalkPicker";
import { SpeakerPicker } from "./weekend/SpeakerPicker";
import { DUTY_COLORS, WEEKEND_DUTY_GROUPS, SLOT_LABELS } from "./weekend/constants";

export function WeekendPlanner() {
  const { user } = useAuth();
  const apiUrl = getApiUrl();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${user?.access_token}`,
    "Content-Type": "application/json",
  };

  // Meeting state
  const [meetings, setMeetings] = useState<WeekendMeeting[]>([]);
  const [weekIndex, setWeekIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  // Study edition state
  const [editions, setEditions] = useState<StudyEdition[]>([]);
  const [editionsLoading, setEditionsLoading] = useState(true);
  const [importError, setImportError] = useState("");
  const [importingMonth, setImportingMonth] = useState<string | null>(null);

  // Picker state
  const [picker, setPicker] = useState<{ assignmentId: string; slotKey: string; title: string } | null>(null);

  // Talk/speaker picker state
  const [showTalkPicker, setShowTalkPicker] = useState(false);
  const [selectedTalk, setSelectedTalk] = useState<PublicTalk | null>(null);

  // ---- Data loading ----

  const loadMeetings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/meetings?type=weekend`, { headers });
      if (res.ok) {
        const data: { id: string }[] = await res.json();
        // Load full details for first 12
        const detailed = await Promise.all(
          data.slice(0, 12).map(async (m) => {
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

  const loadEditions = useCallback(async () => {
    setEditionsLoading(true);
    setImportError("");
    try {
      const res = await fetch(`${apiUrl}/weekend-study/available?language=de`, { headers });
      if (res.ok) setEditions(await res.json());
      else {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        setImportError(err.error);
      }
    } catch {
      setImportError("Network error");
    } finally {
      setEditionsLoading(false);
    }
  }, [apiUrl, user?.access_token]);

  useEffect(() => {
    loadMeetings();
    loadEditions();
  }, [loadMeetings, loadEditions]);

  // ---- Actions ----

  const handleImport = async (yearMonth: string) => {
    setImportingMonth(yearMonth);
    setImportError("");
    try {
      const res = await fetch(`${apiUrl}/weekend-study/import/commit`, {
        method: "POST",
        headers,
        body: JSON.stringify({ language: "de", issueKey: yearMonth.replace("-", "") }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Import failed" }));
        setImportError(err.error || "Import failed");
        return;
      }
      await loadMeetings();
      await loadEditions();
    } catch {
      setImportError("Network error");
    } finally {
      setImportingMonth(null);
    }
  };

  const handleSelectEdition = async (_yearMonth: string) => {
    // For weekend, selecting an edition navigates to the first meeting in that edition's range
    const parts = _yearMonth.split("-").map(Number);
    const y = parts[0] ?? 2026;
    const m = parts[1] ?? 1;
    const edStart = new Date(y, m - 1, 1);
    const edEnd = new Date(y, m + 1, 0);
    const idx = meetings.findIndex((mtg) => {
      const d = new Date(mtg.date);
      return d >= edStart && d <= edEnd;
    });
    if (idx >= 0) setWeekIndex(idx);
  };

  const handleAssign = async (assignmentId: string, publisherId: string) => {
    await fetch(`${apiUrl}/meeting-assignments/${assignmentId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ assigneePublisherId: publisherId }),
    });
    setPicker(null);
    await loadMeetings();
  };

  const handleTalkSelect = (talk: PublicTalk) => {
    setShowTalkPicker(false);
    setSelectedTalk(talk);
  };

  const handleSpeakerScheduled = async () => {
    setSelectedTalk(null);
    await loadMeetings();
  };

  const handlePublish = async () => {
    const current = meetings[weekIndex];
    if (!current) return;
    await fetch(`${apiUrl}/meetings/${current.id}/publish`, { method: "POST", headers });
    await loadMeetings();
  };

  const handlePrint = () => {
    window.print();
  };

  // ---- Derived state ----

  const currentMeeting = meetings[weekIndex];

  // Adapt weekend meetings to PeriodMeeting shape for WeekNavigator
  const navMeetings: PeriodMeeting[] = meetings.map((m) => ({
    id: m.id,
    title: m.title,
    date: m.date,
    status: m.status,
    assignments: [],
  }));

  // Derive active edition yearMonth from current meeting date
  const activeYearMonth = (() => {
    if (!currentMeeting) return null;
    const d = new Date(currentMeeting.date);
    const month = d.getMonth() + 1;
    // Bimonthly editions: round month down to odd month
    const edMonth = month % 2 === 0 ? month - 1 : month;
    const ym = `${d.getFullYear()}-${String(edMonth).padStart(2, "0")}`;
    return editions.find((e) => e.yearMonth === ym)?.yearMonth ?? null;
  })();

  // Count assignments
  const allAssignments = currentMeeting?.assignments ?? [];
  const dutyAssignments = allAssignments.filter((a: Assignment) => a.slotTemplate.category === "duty");
  const assignedCount = allAssignments.filter((a: Assignment) => a.assignee).length;
  const openCount = allAssignments.length - assignedCount;

  // ---- Render ----

  if (loading && meetings.length === 0) {
    return <div className="p-6 text-[var(--text-muted)]">Loading...</div>;
  }

  return (
    <div className="max-w-[1280px] mx-auto px-6 py-4 space-y-3">
      {/* Week Navigator */}
      {navMeetings.length > 0 && (
        <WeekNavigator
          meetings={navMeetings}
          currentIndex={weekIndex}
          onNavigate={setWeekIndex}
        />
      )}

      {/* Two-column layout: Program + Sidebar */}
      {currentMeeting ? (
        <div className="grid grid-cols-[1fr_240px] gap-4 max-[1000px]:grid-cols-1">
          {/* Program Card */}
          <ProgramCard
            meeting={currentMeeting}
            locked={currentMeeting.status === "locked"}
            onEditAssignment={(id, slotKey, title) => setPicker({ assignmentId: id, slotKey, title })}
            onEditTalk={() => setShowTalkPicker(true)}
          />

          {/* Sidebar */}
          <div className="flex flex-col gap-2.5">
            {/* WT Study Edition Strip */}
            <StudyStrip
              editions={editions}
              activeYearMonth={activeYearMonth}
              importingMonth={importingMonth}
              loading={editionsLoading}
              error={importError}
              onSelect={handleSelectEdition}
              onImport={handleImport}
            />

            {/* Duty Groups */}
            <DutySidebar
              assignments={dutyAssignments}
              locked={currentMeeting.status === "locked"}
              onEditAssignment={(id, slotKey, title) => setPicker({ assignmentId: id, slotKey, title })}
            />

            {/* Stats */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius-sm)] p-2 text-center">
                <div className="text-[9px] text-[var(--text-muted)]">Zugewiesen</div>
                <div className="text-lg font-bold text-[var(--green)]">{assignedCount}</div>
              </div>
              <div className="bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius-sm)] p-2 text-center">
                <div className="text-[9px] text-[var(--text-muted)]">Offen</div>
                <div className="text-lg font-bold text-[var(--amber)]">{openCount}</div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-1.5">
              <button
                onClick={handlePublish}
                disabled={currentMeeting.status === "locked" || currentMeeting.status === "published"}
                className="flex-1 py-[7px] text-[11px] font-semibold bg-[var(--green)] text-black border-none rounded-[var(--radius-sm)] cursor-pointer flex items-center justify-center gap-[5px] disabled:opacity-50"
              >
                <Send size={14} />
                Veroffentlichen
              </button>
              <button
                onClick={handlePrint}
                className="py-[7px] px-3 text-[11px] border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--radius-sm)] cursor-pointer flex items-center justify-center gap-[5px]"
              >
                <Printer size={14} />
                Drucken
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-[var(--text-muted)]">
          <StudyStrip
            editions={editions}
            activeYearMonth={activeYearMonth}
            importingMonth={importingMonth}
            loading={editionsLoading}
            error={importError}
            onSelect={handleSelectEdition}
            onImport={handleImport}
          />
          <p className="mt-6">No upcoming weekend meetings</p>
          <p className="text-sm mt-1">Import a study edition above or create weekend meetings to start planning.</p>
        </div>
      )}

      {/* Assignment picker modal */}
      {picker && (
        <AssignmentPicker
          title={picker.title}
          assignmentId={picker.assignmentId}
          slotKey={picker.slotKey}
          meetingType="weekend"
          apiUrl={apiUrl}
          headers={headers}
          onAssign={handleAssign}
          onClose={() => setPicker(null)}
        />
      )}

      {/* Talk picker modal */}
      {showTalkPicker && (
        <TalkPicker
          apiUrl={apiUrl}
          headers={headers}
          onSelect={handleTalkSelect}
          onClose={() => setShowTalkPicker(false)}
        />
      )}

      {/* Speaker picker modal */}
      {selectedTalk && currentMeeting && (
        <SpeakerPicker
          talk={selectedTalk}
          meetingId={currentMeeting.id}
          apiUrl={apiUrl}
          headers={headers}
          onScheduled={handleSpeakerScheduled}
          onClose={() => setSelectedTalk(null)}
        />
      )}
    </div>
  );
}

/* ---- Weekend Duty Sidebar (local, adapted from midweek) ---- */

function DutySidebar({
  assignments, locked, onEditAssignment,
}: {
  assignments: Assignment[];
  locked: boolean;
  onEditAssignment: (assignmentId: string, slotKey: string, title: string) => void;
}) {
  const dutyMap = new Map(assignments.map((a) => [a.slotTemplate.slotKey, a]));

  return (
    <>
      {WEEKEND_DUTY_GROUPS.map((group) => {
        const colors = DUTY_COLORS[group.color];
        const Icon = group.color === "technik" ? Headphones : group.color === "ordnung" ? Shield : Sparkles;
        return (
          <div key={group.key} className="rounded-[var(--radius)] overflow-hidden border border-[var(--border)] bg-[var(--bg-1)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
            <div className={`px-3 py-[5px] flex items-center gap-1.5 ${colors.header}`}>
              <Icon size={11} className="text-white/70" />
              <span className="text-[10px] font-bold uppercase tracking-wide text-white/90">{group.label}</span>
            </div>
            {group.slots.map((slotKey, i) => {
              const a = dutyMap.get(slotKey);
              const name = a?.assignee
                ? (a.assignee.displayName || `${a.assignee.firstName[0]}. ${a.assignee.lastName}`)
                : null;
              return (
                <div key={slotKey} className={`flex items-center justify-between px-3 py-[5px] ${i > 0 ? "border-t border-white/[0.03]" : ""}`}>
                  <span className="text-[11px] text-[var(--text-muted)]">{SLOT_LABELS[slotKey] ?? slotKey}</span>
                  <div className="flex items-center gap-1">
                    <span className={`text-[11px] font-medium ${name ? "" : "text-zinc-600 italic"}`}>
                      {name ?? "\u2014"}
                    </span>
                    {!locked && a && (
                      <button
                        onClick={() => onEditAssignment(a.id, slotKey, SLOT_LABELS[slotKey] ?? slotKey)}
                        className={`text-[8px] px-[5px] py-px border border-[var(--border)] rounded-[3px] bg-transparent cursor-pointer ${name ? "text-zinc-600" : "text-[var(--amber)]"}`}
                      >
                        {name ? "\u270E" : "+"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
