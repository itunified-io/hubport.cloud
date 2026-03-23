import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../auth/useAuth";
import { getApiUrl } from "../../../lib/config";

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
    parts: WorkbookPart[];
  };
  assignments: Assignment[];
}

interface Assignment {
  id: string;
  status: string;
  slotTemplate: { slotKey: string; label: string; category: string };
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
}

export function MidweekPlanner() {
  const { user } = useAuth();
  const [periods, setPeriods] = useState<MeetingPeriod[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<MeetingPeriod | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTimeline, setShowTimeline] = useState(false);
  const [availableEditions, setAvailableEditions] = useState<AvailableEdition[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [importLanguage, setImportLanguage] = useState("de");
  const [importingMonth, setImportingMonth] = useState<string | null>(null);
  const [importError, setImportError] = useState("");

  const apiUrl = getApiUrl();
  const headers = {
    Authorization: `Bearer ${user?.access_token}`,
    "Content-Type": "application/json",
  };

  const loadPeriods = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/meeting-periods?type=midweek_workbook`, { headers });
      if (res.ok) setPeriods(await res.json());
    } finally {
      setLoading(false);
    }
  }, [apiUrl, user?.access_token]);

  const loadPeriodDetail = useCallback(async (id: string) => {
    const res = await fetch(`${apiUrl}/meeting-periods/${id}`, { headers });
    if (res.ok) setSelectedPeriod(await res.json());
  }, [apiUrl, user?.access_token]);

  const loadTimeline = useCallback(async () => {
    setTimelineLoading(true);
    setImportError("");
    try {
      const res = await fetch(
        `${apiUrl}/workbooks/available?language=${importLanguage}`,
        { headers },
      );
      if (res.ok) {
        setAvailableEditions(await res.json());
      } else {
        const err = await res.json().catch(() => ({ error: "Failed to load" }));
        setImportError(err.error || "Failed to check availability");
      }
    } catch {
      setImportError("Network error — could not reach server");
    } finally {
      setTimelineLoading(false);
    }
  }, [apiUrl, user?.access_token, importLanguage]);

  useEffect(() => { loadPeriods(); }, [loadPeriods]);

  const openTimeline = () => {
    setShowTimeline(true);
    loadTimeline();
  };

  const handleImport = async (yearMonth: string) => {
    setImportingMonth(yearMonth);
    setImportError("");
    try {
      const res = await fetch(`${apiUrl}/workbooks/import/commit`, {
        method: "POST",
        headers,
        body: JSON.stringify({ language: importLanguage, yearMonth }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Import failed" }));
        setImportError(err.error || "Import failed");
        return;
      }
      const result = await res.json();
      setShowTimeline(false);
      await loadPeriods();
      await loadPeriodDetail(result.periodId);
    } catch {
      setImportError("Network error during import");
    } finally {
      setImportingMonth(null);
    }
  };

  const handlePublish = async (periodId: string) => {
    await fetch(`${apiUrl}/meeting-periods/${periodId}/publish`, { method: "POST", headers });
    await loadPeriodDetail(periodId);
  };

  const handleLock = async (periodId: string) => {
    await fetch(`${apiUrl}/meeting-periods/${periodId}/lock`, { method: "POST", headers });
    await loadPeriodDetail(periodId);
  };

  if (loading) {
    return <div className="p-6 text-[var(--text-muted)]">Loading...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--text)]">Midweek Meeting Planner</h1>
        <button
          onClick={openTimeline}
          className="px-4 py-2 bg-[var(--amber)] text-black font-semibold rounded-[var(--radius)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer"
        >
          Import Workbook
        </button>
      </div>

      {/* Timeline / Import Panel */}
      {showTimeline && (
        <div className="bg-[var(--bg-1)] rounded-[var(--radius)] border border-[var(--border)] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[var(--text)]">Available Workbook Editions</h2>
            <div className="flex items-center gap-3">
              <select
                value={importLanguage}
                onChange={(e) => {
                  setImportLanguage(e.target.value);
                  setTimeout(() => loadTimeline(), 0);
                }}
                className="px-3 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm text-[var(--text)]"
              >
                <option value="de">Deutsch</option>
                <option value="en">English</option>
                <option value="es">Español</option>
                <option value="fr">Français</option>
                <option value="it">Italiano</option>
                <option value="pt">Português</option>
                <option value="ru">Русский</option>
              </select>
              <button
                onClick={() => setShowTimeline(false)}
                className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>

          {importError && (
            <p className="text-red-400 text-sm">{importError}</p>
          )}

          {timelineLoading ? (
            <div className="text-center py-8 text-[var(--text-muted)]">
              Checking JW.org for available editions...
            </div>
          ) : (
            <div className="grid gap-2">
              {availableEditions.map((edition) => {
                const isCurrent = edition.yearMonth === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
                return (
                  <div
                    key={edition.yearMonth}
                    className={`flex items-center justify-between p-3 rounded-[var(--radius-sm)] border transition-colors ${
                      isCurrent
                        ? "border-[var(--amber)] bg-[var(--amber)]/5"
                        : "border-[var(--border)] bg-[var(--bg)]"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-2.5 h-2.5 rounded-full ${
                        edition.available ? "bg-green-500" : "bg-gray-500"
                      }`} />
                      <div>
                        <span className={`text-sm font-medium ${
                          isCurrent ? "text-[var(--amber)]" : "text-[var(--text)]"
                        }`}>
                          {edition.label}
                        </span>
                        {isCurrent && (
                          <span className="ml-2 text-xs text-[var(--amber)]">current</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {edition.imported && (
                        <span className="px-2 py-0.5 text-xs bg-blue-600/20 text-blue-400 rounded-full">
                          Imported
                        </span>
                      )}
                      {edition.available && !edition.imported && (
                        <button
                          onClick={() => handleImport(edition.yearMonth)}
                          disabled={importingMonth !== null}
                          className="px-3 py-1.5 text-xs bg-[var(--amber)] text-black font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] disabled:opacity-50 cursor-pointer"
                        >
                          {importingMonth === edition.yearMonth ? "Importing..." : "Import"}
                        </button>
                      )}
                      {edition.available && edition.imported && (
                        <button
                          onClick={() => handleImport(edition.yearMonth)}
                          disabled={importingMonth !== null}
                          className="px-3 py-1.5 text-xs border border-[var(--border)] text-[var(--text-muted)] rounded-[var(--radius-sm)] hover:bg-[var(--bg-2)] disabled:opacity-50 cursor-pointer"
                        >
                          {importingMonth === edition.yearMonth ? "Reimporting..." : "Reimport"}
                        </button>
                      )}
                      {!edition.available && (
                        <span className="text-xs text-[var(--text-muted)]">Not available</span>
                      )}
                      {edition.url && (
                        <a
                          href={edition.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-[var(--amber)] hover:underline"
                        >
                          JW.org →
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Period List */}
      {!selectedPeriod && !showTimeline && (
        <div className="space-y-3">
          {periods.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-muted)]">
              <p className="text-lg">No planning periods yet</p>
              <p className="mt-2">Import a workbook to create your first midweek planning period.</p>
            </div>
          ) : (
            periods.map((period) => (
              <button
                key={period.id}
                onClick={() => loadPeriodDetail(period.id)}
                className="w-full text-left p-4 bg-[var(--bg-1)] rounded-[var(--radius)] border border-[var(--border)] hover:border-[var(--amber)] transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-[var(--text)]">
                      {new Date(period.startDate).toLocaleDateString()} – {new Date(period.endDate).toLocaleDateString()}
                    </span>
                    <span className="ml-3 text-sm text-[var(--text-muted)]">
                      {period.meetings?.length ?? 0} meetings
                    </span>
                  </div>
                  <StatusBadge status={period.status} />
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {/* Period Detail View */}
      {selectedPeriod && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSelectedPeriod(null)}
              className="text-[var(--amber)] hover:underline cursor-pointer"
            >
              ← Back
            </button>
            <StatusBadge status={selectedPeriod.status} />
            <div className="flex-1" />
            {selectedPeriod.status === "open" && (
              <button
                onClick={() => handlePublish(selectedPeriod.id)}
                className="px-3 py-1.5 bg-green-600 text-white rounded-[var(--radius-sm)] hover:bg-green-700 cursor-pointer"
              >
                Publish All
              </button>
            )}
            {selectedPeriod.status === "published" && (
              <button
                onClick={() => handleLock(selectedPeriod.id)}
                className="px-3 py-1.5 bg-red-600 text-white rounded-[var(--radius-sm)] hover:bg-red-700 cursor-pointer"
              >
                Lock Period
              </button>
            )}
          </div>

          {selectedPeriod.meetings.map((meeting) => (
            <MeetingCard
              key={meeting.id}
              meeting={meeting}
              apiUrl={apiUrl}
              headers={headers}
              onRefresh={() => loadPeriodDetail(selectedPeriod.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: "bg-gray-600",
    open: "bg-blue-600",
    published: "bg-green-600",
    locked: "bg-red-600",
    archived: "bg-gray-500",
  };
  return (
    <span className={`px-2 py-0.5 text-xs font-medium text-white rounded-full ${colors[status] ?? "bg-gray-600"}`}>
      {status}
    </span>
  );
}

function MeetingCard({
  meeting,
  apiUrl,
  headers,
  onRefresh,
}: {
  meeting: PeriodMeeting;
  apiUrl: string;
  headers: Record<string, string>;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const programAssignments = meeting.assignments?.filter((a) => a.slotTemplate.category === "program") ?? [];
  const dutyAssignments = meeting.assignments?.filter((a) => a.slotTemplate.category === "duty") ?? [];
  const unassignedCount = meeting.assignments?.filter((a) => !a.assignee).length ?? 0;

  return (
    <div className="bg-[var(--bg-1)] rounded-[var(--radius)] border border-[var(--border)] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-4 hover:bg-[var(--bg-2)] transition-colors cursor-pointer"
      >
        <div className="flex items-center justify-between">
          <div>
            <span className="font-semibold text-[var(--text)]">
              {new Date(meeting.date).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}
            </span>
            {meeting.workbookWeek?.theme && (
              <span className="ml-3 text-sm text-[var(--text-muted)]">{meeting.workbookWeek.theme}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unassignedCount > 0 && (
              <span className="text-xs text-[var(--amber)]">{unassignedCount} unassigned</span>
            )}
            <StatusBadge status={meeting.status} />
            <span className="text-[var(--text-muted)]">{expanded ? "▲" : "▼"}</span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[var(--border)] p-4 space-y-4">
          {programAssignments.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-[var(--amber)] mb-2">Program</h4>
              <div className="space-y-2">
                {programAssignments.map((assignment) => (
                  <AssignmentRow
                    key={assignment.id}
                    assignment={assignment}
                    apiUrl={apiUrl}
                    headers={headers}
                    meetingType="midweek"
                    onRefresh={onRefresh}
                    locked={meeting.status === "locked"}
                  />
                ))}
              </div>
            </div>
          )}

          {dutyAssignments.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-[var(--text-muted)] mb-2">Duties</h4>
              <div className="space-y-2">
                {dutyAssignments.map((assignment) => (
                  <AssignmentRow
                    key={assignment.id}
                    assignment={assignment}
                    apiUrl={apiUrl}
                    headers={headers}
                    meetingType="midweek"
                    onRefresh={onRefresh}
                    locked={meeting.status === "locked"}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AssignmentRow({
  assignment,
  apiUrl,
  headers,
  meetingType,
  onRefresh,
  locked,
}: {
  assignment: Assignment;
  apiUrl: string;
  headers: Record<string, string>;
  meetingType: string;
  onRefresh: () => void;
  locked: boolean;
}) {
  const [eligiblePublishers, setEligiblePublishers] = useState<
    { id: string; firstName: string; lastName: string; displayName: string | null }[] | null
  >(null);
  const [showPicker, setShowPicker] = useState(false);

  const loadEligible = async () => {
    const res = await fetch(
      `${apiUrl}/meeting-assignments/eligible?slotKey=${assignment.slotTemplate.slotKey}&meetingType=${meetingType}`,
      { headers },
    );
    if (res.ok) {
      setEligiblePublishers(await res.json());
      setShowPicker(true);
    }
  };

  const assignPublisher = async (publisherId: string) => {
    await fetch(`${apiUrl}/meeting-assignments/${assignment.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ assigneePublisherId: publisherId }),
    });
    setShowPicker(false);
    onRefresh();
  };

  const displayName = assignment.assignee
    ? assignment.assignee.displayName || `${assignment.assignee.firstName} ${assignment.assignee.lastName}`
    : null;

  const partTitle = assignment.workbookPart?.title ?? assignment.slotTemplate.label;

  return (
    <div className="flex items-center gap-3 p-2 rounded-[var(--radius-sm)] bg-[var(--bg)]">
      <div className="flex-1 min-w-0">
        <span className="text-sm text-[var(--text)]">{partTitle}</span>
        {assignment.workbookPart?.durationMinutes && (
          <span className="ml-2 text-xs text-[var(--text-muted)]">
            ({assignment.workbookPart.durationMinutes} min)
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {displayName ? (
          <span className="text-sm font-medium text-[var(--amber)]">{displayName}</span>
        ) : (
          <span className="text-sm text-[var(--text-muted)] italic">Unassigned</span>
        )}
        {!locked && (
          <button
            onClick={loadEligible}
            className="px-2 py-1 text-xs border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-2)] cursor-pointer"
          >
            {displayName ? "Change" : "Assign"}
          </button>
        )}
      </div>

      {showPicker && eligiblePublishers && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-[var(--bg-1)] rounded-[var(--radius)] p-4 w-full max-w-sm border border-[var(--border)] max-h-96 overflow-y-auto">
            <h3 className="font-semibold text-[var(--text)] mb-3">
              Assign: {partTitle}
            </h3>
            {eligiblePublishers.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No eligible publishers found</p>
            ) : (
              <div className="space-y-1">
                {eligiblePublishers.map((pub) => (
                  <button
                    key={pub.id}
                    onClick={() => assignPublisher(pub.id)}
                    className="w-full text-left px-3 py-2 rounded-[var(--radius-sm)] hover:bg-[var(--bg-2)] text-[var(--text)] cursor-pointer"
                  >
                    {pub.displayName || `${pub.firstName} ${pub.lastName}`}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => setShowPicker(false)}
              className="mt-3 w-full px-3 py-1.5 border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-2)] cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
