import { useState, useEffect, useCallback, useRef } from "react";
import { FileUp } from "lucide-react";
import { useAuth } from "../../../auth/useAuth";
import { getApiUrl } from "../../../lib/config";

interface ScheduleEntry {
  id: string;
  mode: string;
  invitationState: string;
  invitedAt: string | null;
  confirmedAt: string | null;
  notes: string | null;
  speaker: { id: string; firstName: string; lastName: string; congregationName?: string; isLocal: boolean };
  publicTalk?: { talkNumber: number; title: string };
  meeting: { id: string; date: string; title: string };
}

interface Speaker {
  id: string;
  firstName: string;
  lastName: string;
  congregationName?: string;
  isLocal: boolean;
  status: string;
  _count: { schedules: number };
}

export function PublicTalkPlanner() {
  const { user } = useAuth();
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [activeTab, setActiveTab] = useState<"schedule" | "speakers">("schedule");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; updated: number; discontinued: number } | null>(null);
  const [importError, setImportError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [talkCount, setTalkCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const apiUrl = getApiUrl();
  const headers = {
    Authorization: `Bearer ${user?.access_token}`,
    "Content-Type": "application/json",
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [schedRes, speakRes] = await Promise.all([
        fetch(`${apiUrl}/public-talks/schedule?upcoming=true`, { headers }),
        fetch(`${apiUrl}/speakers`, { headers }),
      ]);
      if (schedRes.ok) setSchedule(await schedRes.json());
      if (speakRes.ok) setSpeakers(await speakRes.json());
    } finally {
      setLoading(false);
    }
  }, [apiUrl, user?.access_token]);

  const loadTalkCount = useCallback(async () => {
    const res = await fetch(`${apiUrl}/public-talks`, { headers });
    if (res.ok) {
      const talks = await res.json();
      setTalkCount(Array.isArray(talks) ? talks.length : 0);
    }
  }, [apiUrl, user?.access_token]);

  useEffect(() => { loadData(); loadTalkCount(); }, [loadData, loadTalkCount]);

  const handleImportFile = async (file: File) => {
    if (!file.name.endsWith(".jwpub")) {
      setImportError("Please upload a .jwpub file (S-34)");
      return;
    }
    setImporting(true);
    setImportError("");
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${apiUrl}/public-talks/import`, {
        method: "POST",
        headers: { Authorization: `Bearer ${user?.access_token}` },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Import failed" }));
        setImportError(err.error || "Import failed");
        return;
      }
      const result = await res.json();
      setImportResult({ created: result.created, updated: result.updated, discontinued: result.discontinued });
      loadTalkCount();
    } catch { setImportError("Network error"); }
    finally { setImporting(false); }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleImportFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImportFile(file);
    e.target.value = "";
  };

  const handleInvite = async (id: string) => {
    await fetch(`${apiUrl}/public-talks/schedule/${id}/invite`, { method: "POST", headers });
    loadData();
  };

  const handleConfirm = async (id: string) => {
    await fetch(`${apiUrl}/public-talks/schedule/${id}/confirm`, { method: "POST", headers });
    loadData();
  };

  const handleCancel = async (id: string) => {
    await fetch(`${apiUrl}/public-talks/schedule/${id}/cancel`, { method: "POST", headers });
    loadData();
  };

  if (loading) {
    return <div className="p-6 text-[var(--text-muted)]">Loading...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-[var(--text)]">Public Talk Planner</h1>

      {/* S-34 JWPUB Import */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={[
          "rounded-[var(--radius)] border-2 border-dashed p-4 flex items-center justify-center gap-3 cursor-pointer transition-all",
          dragOver
            ? "border-[var(--amber)] bg-[var(--amber)]/[0.06]"
            : "border-[var(--border)] bg-[var(--bg-1)] hover:border-[var(--border-2)] hover:bg-[var(--bg-2)]",
        ].join(" ")}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".jwpub"
          onChange={handleFileInput}
          className="hidden"
        />
        {importing ? (
          <span className="text-sm text-[var(--text-muted)]">Importing...</span>
        ) : (
          <>
            <FileUp size={20} className={dragOver ? "text-[var(--amber)]" : "text-[var(--text-muted)]"} />
            <div className="text-sm">
              <span className={dragOver ? "text-[var(--amber)] font-medium" : "text-[var(--text-muted)]"}>
                Drop S-34 JWPUB file here
              </span>
              <span className="text-[var(--text-muted)]"> or click to upload</span>
              {talkCount > 0 && (
                <span className="ml-2 text-xs text-[var(--text-muted)]">({talkCount} talks loaded)</span>
              )}
            </div>
          </>
        )}
      </div>
      {importError && <p className="text-sm text-[var(--red)]">{importError}</p>}
      {importResult && (
        <p className="text-sm text-[var(--green)]">
          ✓ {importResult.created} created, {importResult.updated} updated, {importResult.discontinued} discontinued
        </p>
      )}

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)]">
        <button
          onClick={() => setActiveTab("schedule")}
          className={`px-4 py-2 text-sm font-medium cursor-pointer ${
            activeTab === "schedule"
              ? "text-[var(--amber)] border-b-2 border-[var(--amber)]"
              : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          Schedule
        </button>
        <button
          onClick={() => setActiveTab("speakers")}
          className={`px-4 py-2 text-sm font-medium cursor-pointer ${
            activeTab === "speakers"
              ? "text-[var(--amber)] border-b-2 border-[var(--amber)]"
              : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          Speaker Directory
        </button>
      </div>

      {/* Schedule Tab */}
      {activeTab === "schedule" && (
        <div className="space-y-3">
          {schedule.length === 0 ? (
            <p className="text-center py-8 text-[var(--text-muted)]">
              No upcoming public talks scheduled
            </p>
          ) : (
            schedule.map((entry) => (
              <div
                key={entry.id}
                className="bg-[var(--bg-1)] rounded-[var(--radius)] border border-[var(--border)] p-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-[var(--text)]">
                      {new Date(entry.meeting.date).toLocaleDateString("de-DE", {
                        weekday: "short",
                        day: "numeric",
                        month: "long",
                      })}
                    </span>
                    <span className="ml-3 text-sm text-[var(--amber)]">
                      {entry.speaker.firstName} {entry.speaker.lastName}
                    </span>
                    {entry.speaker.congregationName && entry.mode !== "local" && (
                      <span className="ml-2 text-xs text-[var(--text-muted)]">
                        ({entry.speaker.congregationName})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-muted)]">{entry.mode}</span>
                    <InvitationBadge state={entry.invitationState} />
                  </div>
                </div>
                {entry.publicTalk && (
                  <p className="mt-1 text-sm text-[var(--text-muted)]">
                    #{entry.publicTalk.talkNumber}: {entry.publicTalk.title}
                  </p>
                )}
                <div className="mt-2 flex gap-2">
                  {entry.invitationState === "draft" && (
                    <button
                      onClick={() => handleInvite(entry.id)}
                      className="px-3 py-1 text-xs bg-blue-600 text-white rounded-[var(--radius-sm)] hover:bg-blue-700 cursor-pointer"
                    >
                      Send Invitation
                    </button>
                  )}
                  {entry.invitationState === "invited" && (
                    <button
                      onClick={() => handleConfirm(entry.id)}
                      className="px-3 py-1 text-xs bg-green-600 text-white rounded-[var(--radius-sm)] hover:bg-green-700 cursor-pointer"
                    >
                      Confirm
                    </button>
                  )}
                  {entry.invitationState !== "cancelled" && (
                    <button
                      onClick={() => handleCancel(entry.id)}
                      className="px-3 py-1 text-xs border border-red-600 text-red-400 rounded-[var(--radius-sm)] hover:bg-red-600/10 cursor-pointer"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Speakers Tab */}
      {activeTab === "speakers" && (
        <div className="space-y-2">
          {speakers.length === 0 ? (
            <p className="text-center py-8 text-[var(--text-muted)]">No speakers registered</p>
          ) : (
            speakers.map((speaker) => (
              <div
                key={speaker.id}
                className="flex items-center justify-between p-3 bg-[var(--bg-1)] rounded-[var(--radius)] border border-[var(--border)]"
              >
                <div>
                  <span className="font-medium text-[var(--text)]">
                    {speaker.firstName} {speaker.lastName}
                  </span>
                  {speaker.congregationName && (
                    <span className="ml-2 text-sm text-[var(--text-muted)]">
                      ({speaker.congregationName})
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[var(--text-muted)]">
                    {speaker._count.schedules} talks
                  </span>
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full ${
                      speaker.isLocal ? "bg-blue-600/20 text-blue-400" : "bg-purple-600/20 text-purple-400"
                    }`}
                  >
                    {speaker.isLocal ? "Local" : "Guest"}
                  </span>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      speaker.status === "active" ? "bg-green-500" : "bg-gray-500"
                    }`}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function InvitationBadge({ state }: { state: string }) {
  const colors: Record<string, string> = {
    draft: "bg-gray-600",
    invited: "bg-blue-600",
    confirmed: "bg-green-600",
    declined: "bg-red-600",
    cancelled: "bg-gray-500",
  };
  return (
    <span className={`px-2 py-0.5 text-xs font-medium text-white rounded-full ${colors[state] ?? "bg-gray-600"}`}>
      {state}
    </span>
  );
}
