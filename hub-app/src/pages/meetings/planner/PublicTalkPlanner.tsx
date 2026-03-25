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
  const [talks, setTalks] = useState<{ id: string; talkNumber: number; title: string; discontinued: boolean }[]>([]);
  const [activeTab, setActiveTab] = useState<"schedule" | "speakers" | "catalog">("schedule");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; updated: number; discontinued: number } | null>(null);
  const [importError, setImportError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [talkSearch, setTalkSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const apiUrl = getApiUrl();
  const headers = {
    Authorization: `Bearer ${user?.access_token}`,
    "Content-Type": "application/json",
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [schedRes, speakRes, talksRes] = await Promise.all([
        fetch(`${apiUrl}/public-talks/schedule?upcoming=true`, { headers }),
        fetch(`${apiUrl}/speakers`, { headers }),
        fetch(`${apiUrl}/public-talks`, { headers }),
      ]);
      if (schedRes.ok) setSchedule(await schedRes.json());
      if (speakRes.ok) setSpeakers(await speakRes.json());
      if (talksRes.ok) {
        const data = await talksRes.json();
        setTalks(Array.isArray(data) ? data : []);
      }
    } finally {
      setLoading(false);
    }
  }, [apiUrl, user?.access_token]);

  useEffect(() => { loadData(); }, [loadData]);

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
      loadData();
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
          "rounded-[var(--radius)] border-2 border-dashed px-6 py-5 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all",
          dragOver
            ? "border-[var(--amber)] bg-[var(--amber)]/[0.06] scale-[1.01]"
            : "border-[var(--border)] bg-[var(--bg-1)] hover:border-[var(--amber)]/40 hover:bg-[var(--bg-2)]",
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
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-[var(--amber)] font-medium">Importing talk catalog...</span>
          </div>
        ) : (
          <>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${dragOver ? "bg-[var(--amber)]/[0.12]" : "bg-[var(--glass-2)]"}`}>
              <FileUp size={18} className={dragOver ? "text-[var(--amber)]" : "text-[var(--text-muted)]"} />
            </div>
            <div className="text-center">
              <p className={`text-sm font-medium ${dragOver ? "text-[var(--amber)]" : "text-[var(--text)]"}`}>
                {talks.length > 0 ? "Update talk catalog" : "Import talk catalog"}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Drop S-34 .jwpub file or click to browse
              </p>
            </div>
            {talks.length > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--green)]/[0.1] text-[var(--green)] font-medium">
                {talks.length} talks loaded
              </span>
            )}
          </>
        )}
      </div>
      {importError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--red)]/[0.08] border border-[var(--red)]/20">
          <span className="text-sm text-[var(--red)]">{importError}</span>
        </div>
      )}
      {importResult && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--green)]/[0.08] border border-[var(--green)]/20">
          <span className="text-sm text-[var(--green)]">
            ✓ {importResult.created} created, {importResult.updated} updated, {importResult.discontinued} discontinued
          </span>
        </div>
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
          onClick={() => setActiveTab("catalog")}
          className={`px-4 py-2 text-sm font-medium cursor-pointer ${
            activeTab === "catalog"
              ? "text-[var(--amber)] border-b-2 border-[var(--amber)]"
              : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          Catalog {talks.length > 0 && <span className="ml-1 text-xs opacity-60">({talks.length})</span>}
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

      {/* Catalog Tab */}
      {activeTab === "catalog" && (
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Search talks..."
            value={talkSearch}
            onChange={(e) => setTalkSearch(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
          />
          {talks.length === 0 ? (
            <p className="text-center py-8 text-[var(--text-muted)]">
              No talks imported. Upload an S-34 JWPUB file above.
            </p>
          ) : (
            <div className="space-y-0.5">
              {talks
                .filter((t) => !talkSearch || t.title.toLowerCase().includes(talkSearch.toLowerCase()) || String(t.talkNumber).includes(talkSearch))
                .map((talk) => (
                  <div
                    key={talk.id}
                    className={`flex items-center gap-3 px-3 py-2 rounded-[var(--radius-sm)] ${talk.discontinued ? "opacity-40" : "hover:bg-[var(--bg-2)]"}`}
                  >
                    <span className="text-xs font-mono text-[var(--amber)] w-8 text-right shrink-0">
                      {talk.talkNumber}
                    </span>
                    <span className={`text-sm ${talk.discontinued ? "line-through text-[var(--text-muted)]" : "text-[var(--text)]"}`}>
                      {talk.title}
                    </span>
                    {talk.discontinued && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-500 ml-auto">discontinued</span>
                    )}
                  </div>
                ))}
            </div>
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
