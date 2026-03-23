import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../auth/useAuth";
import { getApiUrl } from "../../../lib/config";

// JW.org official meeting section colors
const SECTION_COLORS: Record<string, { bg: string; header: string; border: string; text: string }> = {
  treasures: { bg: "bg-[#4a6da7]/10", header: "bg-[#4a6da7]", border: "border-l-[#4a6da7]", text: "text-[#4a6da7]" },
  ministry:  { bg: "bg-[#c18626]/10", header: "bg-[#c18626]", border: "border-l-[#c18626]", text: "text-[#c18626]" },
  living:    { bg: "bg-[#961526]/10", header: "bg-[#961526]", border: "border-l-[#961526]", text: "text-[#961526]" },
};

const SECTION_LABELS: Record<string, string> = {
  treasures: "Schätze aus Gottes Wort",
  ministry: "Uns im Dienst verbessern",
  living: "Unser Leben als Christ",
};

interface WorkbookPart {
  id: string;
  section: string;
  partType: string;
  title: string;
  durationMinutes: number | null;
  requiresAssistant: boolean;
}

interface MeetingPeriod {
  id: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  meetings: PeriodMeeting[];
}

interface PeriodMeeting {
  id: string;
  title: string;
  date: string;
  status: string;
  workbookWeek?: {
    theme: string;
    dateRange: string;
    songNumbers: number[];
    parts: WorkbookPart[];
  };
  assignments: Assignment[];
}

interface Assignment {
  id: string;
  status: string;
  slotTemplate: { slotKey: string; label: string; category: string; sortOrder: number };
  workbookPart?: WorkbookPart;
  assignee?: { id: string; firstName: string; lastName: string; displayName?: string };
  assistant?: { id: string; firstName: string; lastName: string; displayName?: string };
}

interface AvailableEdition {
  yearMonth: string;
  label: string;
  available: boolean;
  imported: boolean;
  importedEditionId: string | null;
  url: string | null;
  thumbnailUrl: string | null;
  issueCode: string;
}

export function MidweekPlanner() {
  const { user } = useAuth();
  const [periods, setPeriods] = useState<MeetingPeriod[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<MeetingPeriod | null>(null);
  const [loading, setLoading] = useState(true);
  const [availableEditions, setAvailableEditions] = useState<AvailableEdition[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [importLanguage, setImportLanguage] = useState("de");
  const [importingMonth, setImportingMonth] = useState<string | null>(null);
  const [importError, setImportError] = useState("");

  const apiUrl = getApiUrl();
  const headers = { Authorization: `Bearer ${user?.access_token}`, "Content-Type": "application/json" };

  const loadPeriods = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/meeting-periods?type=midweek_workbook`, { headers });
      if (res.ok) setPeriods(await res.json());
    } finally { setLoading(false); }
  }, [apiUrl, user?.access_token]);

  const loadPeriodDetail = useCallback(async (id: string) => {
    const res = await fetch(`${apiUrl}/meeting-periods/${id}`, { headers });
    if (res.ok) setSelectedPeriod(await res.json());
  }, [apiUrl, user?.access_token]);

  const loadTimeline = useCallback(async () => {
    setTimelineLoading(true);
    setImportError("");
    try {
      const res = await fetch(`${apiUrl}/workbooks/available?language=${importLanguage}`, { headers });
      if (res.ok) setAvailableEditions(await res.json());
      else {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        setImportError(err.error);
      }
    } catch { setImportError("Network error"); }
    finally { setTimelineLoading(false); }
  }, [apiUrl, user?.access_token, importLanguage]);

  useEffect(() => { loadPeriods(); loadTimeline(); }, [loadPeriods, loadTimeline]);

  const handleImport = async (yearMonth: string) => {
    setImportingMonth(yearMonth);
    setImportError("");
    try {
      const res = await fetch(`${apiUrl}/workbooks/import/commit`, {
        method: "POST", headers,
        body: JSON.stringify({ language: importLanguage, yearMonth }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Import failed" }));
        setImportError(err.error || "Import failed");
        return;
      }
      const result = await res.json();
      await loadPeriods();
      await loadTimeline();
      await loadPeriodDetail(result.periodId);
    } catch { setImportError("Network error"); }
    finally { setImportingMonth(null); }
  };

  const handlePublish = async (periodId: string) => {
    await fetch(`${apiUrl}/meeting-periods/${periodId}/publish`, { method: "POST", headers });
    await loadPeriodDetail(periodId);
  };

  const handleLock = async (periodId: string) => {
    await fetch(`${apiUrl}/meeting-periods/${periodId}/lock`, { method: "POST", headers });
    await loadPeriodDetail(periodId);
  };

  const handleCleanup = async () => {
    await fetch(`${apiUrl}/meeting-periods/cleanup`, { method: "POST", headers });
    await loadPeriods();
  };

  if (loading) return <div className="p-6 text-[var(--text-muted)]">Loading...</div>;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--text)]">Midweek Meeting Planner</h1>
        <select
          value={importLanguage}
          onChange={(e) => { setImportLanguage(e.target.value); setTimeout(loadTimeline, 0); }}
          className="px-3 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm text-[var(--text)]"
        >
          <option value="de">Deutsch</option>
          <option value="en">English</option>
          <option value="es">Español</option>
          <option value="fr">Français</option>
        </select>
      </div>

      {/* Workbook Editions Strip */}
      <div>
        {importError && <p className="text-red-400 text-sm mb-2">{importError}</p>}
        {timelineLoading ? (
          <div className="text-sm text-[var(--text-muted)]">Checking JW.org...</div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {availableEditions.map((edition) => {
              const now = new Date();
              const [y, m] = edition.yearMonth.split("-").map(Number);
              const isCurrent = y === now.getFullYear() && (m === now.getMonth() + 1 || m === now.getMonth());
              return (
                <div key={edition.yearMonth} className={`flex-shrink-0 w-28 rounded-[var(--radius)] border overflow-hidden ${
                  isCurrent ? "border-[var(--amber)] ring-1 ring-[var(--amber)]/30" : edition.available ? "border-[var(--border)]" : "border-[var(--border)] opacity-40"
                } bg-[var(--bg)]`}>
                  <div className="relative h-32 bg-[var(--bg-2)] overflow-hidden">
                    {edition.thumbnailUrl ? (
                      <img src={edition.thumbnailUrl} alt={edition.label} className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)] text-xs">—</div>
                    )}
                    {isCurrent && <div className="absolute top-1 right-1 px-1 py-0.5 text-[9px] font-bold bg-[var(--amber)] text-black rounded">Now</div>}
                    {edition.imported && <div className="absolute top-1 left-1 px-1 py-0.5 text-[9px] font-bold bg-blue-600 text-white rounded">✓</div>}
                    {!edition.available && <div className="absolute inset-0 flex items-center justify-center bg-black/40"><span className="text-[9px] text-white/70">—</span></div>}
                  </div>
                  <div className="p-1.5 space-y-1">
                    <span className="text-[10px] font-medium text-[var(--text)] leading-tight block">{edition.label}</span>
                    {edition.available && !edition.imported && (
                      <button onClick={() => handleImport(edition.yearMonth)} disabled={importingMonth !== null}
                        className="w-full px-1 py-0.5 text-[9px] bg-[var(--amber)] text-black font-bold rounded hover:bg-[var(--amber-light)] disabled:opacity-50 cursor-pointer">
                        {importingMonth === edition.yearMonth ? "..." : "Import"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Period List */}
      {!selectedPeriod && (
        <div className="space-y-3">
          {periods.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-muted)]">
              <p>No planning periods yet</p>
              <p className="text-sm mt-1">Import a workbook above to start planning.</p>
            </div>
          ) : (
            <>
              {periods.length > 1 && (
                <button onClick={handleCleanup} className="text-xs text-[var(--text-muted)] hover:text-[var(--amber)] cursor-pointer">
                  Clean up duplicates
                </button>
              )}
              {periods.map((period) => (
                <button key={period.id} onClick={() => loadPeriodDetail(period.id)}
                  className="w-full text-left p-4 bg-[var(--bg-1)] rounded-[var(--radius)] border border-[var(--border)] hover:border-[var(--amber)] transition-colors cursor-pointer">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-[var(--text)]">
                        {new Date(period.startDate).toLocaleDateString()} – {new Date(period.endDate).toLocaleDateString()}
                      </span>
                      <span className="ml-3 text-sm text-[var(--text-muted)]">{period.meetings?.length ?? 0} meetings</span>
                    </div>
                    <StatusBadge status={period.status} />
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* Period Detail — Week-based view with JW section colors */}
      {selectedPeriod && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <button onClick={() => setSelectedPeriod(null)} className="text-[var(--amber)] hover:underline cursor-pointer text-sm">← Back</button>
            <StatusBadge status={selectedPeriod.status} />
            <div className="flex-1" />
            {selectedPeriod.status === "open" && (
              <button onClick={() => handlePublish(selectedPeriod.id)}
                className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-[var(--radius-sm)] hover:bg-green-700 cursor-pointer">Publish</button>
            )}
            {selectedPeriod.status === "published" && (
              <button onClick={() => handleLock(selectedPeriod.id)}
                className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-[var(--radius-sm)] hover:bg-red-700 cursor-pointer">Lock</button>
            )}
          </div>

          {selectedPeriod.meetings.map((meeting) => (
            <WeekCard key={meeting.id} meeting={meeting} apiUrl={apiUrl} headers={headers}
              onRefresh={() => loadPeriodDetail(selectedPeriod.id)} locked={meeting.status === "locked"} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const c: Record<string, string> = { draft: "bg-gray-600", open: "bg-blue-600", published: "bg-green-600", locked: "bg-red-600" };
  return <span className={`px-2 py-0.5 text-[10px] font-medium text-white rounded-full ${c[status] ?? "bg-gray-600"}`}>{status}</span>;
}

function WeekCard({ meeting, apiUrl, headers, onRefresh, locked }: {
  meeting: PeriodMeeting; apiUrl: string; headers: Record<string, string>; onRefresh: () => void; locked: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const parts = meeting.workbookWeek?.parts ?? [];
  const songs = meeting.workbookWeek?.songNumbers ?? [];
  const programAssignments = meeting.assignments?.filter((a) => a.slotTemplate.category === "program") ?? [];
  const dutyAssignments = meeting.assignments?.filter((a) => a.slotTemplate.category === "duty") ?? [];
  const unassigned = meeting.assignments?.filter((a) => !a.assignee).length ?? 0;

  // Group program parts by section
  const sectionGroups: Record<string, { parts: WorkbookPart[]; assignments: Assignment[] }> = {};
  for (const part of parts) {
    if (!sectionGroups[part.section]) sectionGroups[part.section] = { parts: [], assignments: [] };
    sectionGroups[part.section]!.parts.push(part);
  }
  for (const a of programAssignments) {
    const sec = a.workbookPart?.section ?? "treasures";
    if (!sectionGroups[sec]) sectionGroups[sec] = { parts: [], assignments: [] };
    sectionGroups[sec].assignments.push(a);
  }

  return (
    <div className="bg-[var(--bg-1)] rounded-[var(--radius)] border border-[var(--border)] overflow-hidden">
      <button onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-4 hover:bg-[var(--bg-2)] transition-colors cursor-pointer">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-semibold text-[var(--text)]">
              {new Date(meeting.date).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}
            </span>
            {meeting.workbookWeek?.theme && (
              <span className="ml-2 text-sm text-[var(--text-muted)]">{meeting.workbookWeek.theme}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {songs.length > 0 && <span className="text-[10px] text-[var(--text-muted)]">♪ {songs.join(", ")}</span>}
            {unassigned > 0 && <span className="text-[10px] text-[var(--amber)]">{unassigned} open</span>}
            <StatusBadge status={meeting.status} />
            <span className="text-[var(--text-muted)] text-xs">{expanded ? "▲" : "▼"}</span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[var(--border)]">
          {/* Program sections with JW colors */}
          {(["treasures", "ministry", "living"] as const).map((sec) => {
            const group = sectionGroups[sec];
            if (!group || (group.parts.length === 0 && group.assignments.length === 0)) return null;
            const colors = SECTION_COLORS[sec]!;
            return (
              <div key={sec}>
                <div className={`${colors.header} px-4 py-1.5`}>
                  <span className="text-xs font-bold text-white uppercase tracking-wide">
                    {SECTION_LABELS[sec] ?? sec}
                  </span>
                </div>
                <div className={`${colors.bg} divide-y divide-[var(--border)]/30`}>
                  {group.assignments.map((a) => (
                    <AssignmentRow key={a.id} assignment={a} apiUrl={apiUrl} headers={headers}
                      meetingType="midweek" onRefresh={onRefresh} locked={locked} sectionColor={colors.text} />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Duties */}
          {dutyAssignments.length > 0 && (
            <div>
              <div className="bg-[var(--bg-2)] px-4 py-1.5">
                <span className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide">Duties</span>
              </div>
              <div className="divide-y divide-[var(--border)]/30">
                {dutyAssignments.map((a) => (
                  <AssignmentRow key={a.id} assignment={a} apiUrl={apiUrl} headers={headers}
                    meetingType="midweek" onRefresh={onRefresh} locked={locked} sectionColor="text-[var(--text-muted)]" />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AssignmentRow({ assignment, apiUrl, headers, meetingType, onRefresh, locked, sectionColor }: {
  assignment: Assignment; apiUrl: string; headers: Record<string, string>;
  meetingType: string; onRefresh: () => void; locked: boolean; sectionColor: string;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [eligible, setEligible] = useState<{ id: string; firstName: string; lastName: string; displayName: string | null }[] | null>(null);

  const loadEligible = async () => {
    const res = await fetch(`${apiUrl}/meeting-assignments/eligible?slotKey=${assignment.slotTemplate.slotKey}&meetingType=${meetingType}`, { headers });
    if (res.ok) { setEligible(await res.json()); setShowPicker(true); }
  };

  const assign = async (pubId: string) => {
    await fetch(`${apiUrl}/meeting-assignments/${assignment.id}`, {
      method: "PUT", headers, body: JSON.stringify({ assigneePublisherId: pubId }),
    });
    setShowPicker(false);
    onRefresh();
  };

  const name = assignment.assignee
    ? assignment.assignee.displayName || `${assignment.assignee.firstName} ${assignment.assignee.lastName}`
    : null;
  const partTitle = assignment.workbookPart?.title ?? assignment.slotTemplate.label;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="flex-1 min-w-0">
        <span className={`text-sm ${sectionColor}`}>{partTitle}</span>
        {assignment.workbookPart?.durationMinutes && (
          <span className="ml-1.5 text-[10px] text-[var(--text-muted)]">({assignment.workbookPart.durationMinutes} min)</span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {name ? (
          <span className="text-sm font-medium text-[var(--text)]">{name}</span>
        ) : (
          <span className="text-sm text-[var(--text-muted)] italic">—</span>
        )}
        {!locked && (
          <button onClick={loadEligible}
            className="px-2 py-0.5 text-[10px] border border-[var(--border)] rounded text-[var(--text-muted)] hover:bg-[var(--bg-2)] cursor-pointer">
            {name ? "✎" : "+"}
          </button>
        )}
      </div>

      {showPicker && eligible && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-[var(--bg-1)] rounded-[var(--radius)] p-4 w-full max-w-sm border border-[var(--border)] max-h-96 overflow-y-auto">
            <h3 className="font-semibold text-[var(--text)] mb-3 text-sm">{partTitle}</h3>
            {eligible.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No eligible publishers</p>
            ) : (
              <div className="space-y-0.5">
                {eligible.map((pub) => (
                  <button key={pub.id} onClick={() => assign(pub.id)}
                    className="w-full text-left px-3 py-2 rounded text-sm hover:bg-[var(--bg-2)] text-[var(--text)] cursor-pointer">
                    {pub.displayName || `${pub.firstName} ${pub.lastName}`}
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setShowPicker(false)}
              className="mt-3 w-full px-3 py-1.5 border border-[var(--border)] rounded text-sm text-[var(--text-muted)] hover:bg-[var(--bg-2)] cursor-pointer">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
