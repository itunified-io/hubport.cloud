// hub-app/src/pages/meetings/planner/MidweekPlanner.tsx
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../auth/useAuth";
import { getApiUrl } from "../../../lib/config";
import type { MeetingPeriod, PeriodMeeting, AvailableEdition } from "./midweek/types";
import { WorkbookStrip } from "./midweek/WorkbookStrip";
import { WeekNavigator } from "./midweek/WeekNavigator";
import { ProgramCard } from "./midweek/ProgramCard";
import { DutySidebar } from "./midweek/DutySidebar";
import { AssignmentPicker } from "./midweek/AssignmentPicker";

export function MidweekPlanner() {
  const { user } = useAuth();
  const apiUrl = getApiUrl();
  const headers = { Authorization: `Bearer ${user?.access_token}`, "Content-Type": "application/json" };

  // Edition state
  const [editions, setEditions] = useState<AvailableEdition[]>([]);
  const [editionsLoading, setEditionsLoading] = useState(true);
  const [importError, setImportError] = useState("");
  const [importingMonth, setImportingMonth] = useState<string | null>(null);

  // Period/meeting state
  const [periods, setPeriods] = useState<MeetingPeriod[]>([]);
  const [activePeriod, setActivePeriod] = useState<MeetingPeriod | null>(null);
  const [weekIndex, setWeekIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  // Picker state
  const [picker, setPicker] = useState<{ assignmentId: string; slotKey: string; title: string } | null>(null);

  // ---- Data loading ----

  const loadEditions = useCallback(async () => {
    setEditionsLoading(true);
    setImportError("");
    try {
      // TODO: read from global language context once navbar language selector is wired
      const res = await fetch(`${apiUrl}/workbooks/available?language=de`, { headers });
      if (res.ok) setEditions(await res.json());
      else {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        setImportError(err.error);
      }
    } catch { setImportError("Network error"); }
    finally { setEditionsLoading(false); }
  }, [apiUrl, user?.access_token]);

  const loadPeriods = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/meeting-periods?type=midweek_workbook`, { headers });
      if (res.ok) setPeriods(await res.json());
    } finally { setLoading(false); }
  }, [apiUrl, user?.access_token]);

  const loadPeriodDetail = useCallback(async (id: string) => {
    const res = await fetch(`${apiUrl}/meeting-periods/${id}`, { headers });
    if (res.ok) {
      const period: MeetingPeriod = await res.json();
      setActivePeriod(period);
      return period;
    }
    return null;
  }, [apiUrl, user?.access_token]);

  useEffect(() => { loadEditions(); loadPeriods(); }, [loadEditions, loadPeriods]);

  // Auto-select first period when periods load
  useEffect(() => {
    if (periods.length > 0 && !activePeriod) {
      const first = periods[0];
      if (first) loadPeriodDetail(first.id);
    }
  }, [periods, activePeriod, loadPeriodDetail]);

  // ---- Actions ----

  const handleImport = async (yearMonth: string) => {
    setImportingMonth(yearMonth);
    setImportError("");
    try {
      const res = await fetch(`${apiUrl}/workbooks/import/commit`, {
        method: "POST", headers,
        body: JSON.stringify({ language: "de", yearMonth }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Import failed" }));
        setImportError(err.error || "Import failed");
        return;
      }
      const result = await res.json();
      await loadPeriods();
      await loadEditions();
      await loadPeriodDetail(result.periodId);
      setWeekIndex(0);
    } catch { setImportError("Network error"); }
    finally { setImportingMonth(null); }
  };

  const handleSelectEdition = async (yearMonth: string) => {
    // Find the period whose date range overlaps the edition's month range
    const parts = yearMonth.split("-").map(Number);
    const y = parts[0] ?? 2026;
    const m = parts[1] ?? 1;
    const editionStart = new Date(y, m - 1, 1);
    const editionEnd = new Date(y, m + 1, 0); // bimonthly: end of next month
    const period = periods.find((p) => {
      const pStart = new Date(p.startDate);
      return pStart >= editionStart && pStart <= editionEnd;
    });
    if (period) {
      await loadPeriodDetail(period.id);
      setWeekIndex(0);
    }
  };

  const handleAssign = async (assignmentId: string, publisherId: string) => {
    await fetch(`${apiUrl}/meeting-assignments/${assignmentId}`, {
      method: "PUT", headers, body: JSON.stringify({ assigneePublisherId: publisherId }),
    });
    setPicker(null);
    if (activePeriod) await loadPeriodDetail(activePeriod.id);
  };

  const handlePublish = async () => {
    if (!activePeriod) return;
    await fetch(`${apiUrl}/meeting-periods/${activePeriod.id}/publish`, { method: "POST", headers });
    await loadPeriodDetail(activePeriod.id);
  };

  const handlePrint = () => {
    window.print();
  };

  // ---- Derived state ----

  const meetings = activePeriod?.meetings ?? [];
  const currentMeeting: PeriodMeeting | undefined = meetings[weekIndex];
  // Derive active edition from active period's date range
  const activeYearMonth = (() => {
    if (!activePeriod) return null;
    const pStart = new Date(activePeriod.startDate);
    const ym = `${pStart.getFullYear()}-${String(pStart.getMonth() + 1).padStart(2, "0")}`;
    // Bimonthly editions: round month down to odd month (Jan/Feb→01, Mar/Apr→03, etc.)
    const month = pStart.getMonth() + 1;
    const edMonth = month % 2 === 0 ? month - 1 : month;
    const edYm = `${pStart.getFullYear()}-${String(edMonth).padStart(2, "0")}`;
    return editions.find((e) => e.yearMonth === edYm)?.yearMonth ?? editions.find((e) => e.yearMonth === ym)?.yearMonth ?? null;
  })();

  // Count all assignments across current meeting
  const allAssignments = currentMeeting?.assignments ?? [];
  const dutyAssignments = allAssignments.filter((a) => a.slotTemplate.category === "duty");
  const assignedCount = allAssignments.filter((a) => a.assignee).length;
  const openCount = allAssignments.length - assignedCount;

  // ---- Render ----

  if (loading && !activePeriod) {
    return <div className="p-6 text-[var(--text-muted)]">Loading...</div>;
  }

  return (
    <div className="max-w-[1280px] mx-auto px-6 py-4 space-y-3">
      {/* Week Navigator */}
      {meetings.length > 0 && (
        <WeekNavigator
          meetings={meetings}
          currentIndex={weekIndex}
          onNavigate={setWeekIndex}
        />
      )}

      {/* Two-column layout: Program + Sidebar (editions + duties) */}
      {currentMeeting ? (
        <div className="grid grid-cols-[1fr_240px] gap-4 max-[1000px]:grid-cols-1">
          <ProgramCard
            meeting={currentMeeting}
            locked={currentMeeting.status === "locked"}
            onEditAssignment={(id, slotKey, title) => setPicker({ assignmentId: id, slotKey, title })}
          />
          <div className="flex flex-col gap-2.5">
            {/* Workbook editions — dock-style in sidebar */}
            <WorkbookStrip
              editions={editions}
              activeYearMonth={activeYearMonth}
              importingMonth={importingMonth}
              loading={editionsLoading}
              error={importError}
              onSelect={handleSelectEdition}
              onImport={handleImport}
            />
            <DutySidebar
              assignments={dutyAssignments}
              assignedCount={assignedCount}
              openCount={openCount}
              status={activePeriod?.status ?? "draft"}
              locked={currentMeeting.status === "locked"}
              onEditAssignment={(id, slotKey, title) => setPicker({ assignmentId: id, slotKey, title })}
              onPublish={handlePublish}
              onPrint={handlePrint}
            />
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-[var(--text-muted)]">
          <WorkbookStrip
            editions={editions}
            activeYearMonth={activeYearMonth}
            importingMonth={importingMonth}
            loading={editionsLoading}
            error={importError}
            onSelect={handleSelectEdition}
            onImport={handleImport}
          />
          <p className="mt-6">No meetings yet</p>
          <p className="text-sm mt-1">Import a workbook above to start planning.</p>
        </div>
      )}

      {/* Assignment picker modal */}
      {picker && (
        <AssignmentPicker
          title={picker.title}
          assignmentId={picker.assignmentId}
          slotKey={picker.slotKey}
          meetingType="midweek"
          apiUrl={apiUrl}
          headers={headers}
          onAssign={handleAssign}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
