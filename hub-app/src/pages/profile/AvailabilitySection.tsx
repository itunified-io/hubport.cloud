import { useState, useEffect, useCallback } from "react";
import { CalendarOff, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";

interface AwayPeriod {
  id: string;
  startDate: string;
  endDate: string;
  reason: string | null;
}

export function AvailabilitySection({ publisherId }: { publisherId: string }) {
  const { user } = useAuth();
  const apiUrl = getApiUrl();
  const headers = { Authorization: `Bearer ${user?.access_token}`, "Content-Type": "application/json" };

  const [periods, setPeriods] = useState<AwayPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/publishers/${publisherId}/away-periods`, { headers });
      if (res.ok) setPeriods(await res.json());
    } finally { setLoading(false); }
  }, [apiUrl, publisherId, user?.access_token]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!startDate || !endDate) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${apiUrl}/publishers/${publisherId}/away-periods`, {
        method: "POST", headers,
        body: JSON.stringify({ startDate, endDate, reason: reason || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        setError(err.error);
        return;
      }
      setShowAdd(false);
      setStartDate(""); setEndDate(""); setReason("");
      await load();
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    await fetch(`${apiUrl}/away-periods/${id}`, { method: "DELETE", headers });
    await load();
  };

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarOff size={16} className="text-[var(--text-muted)]" />
          <h2 className="text-sm font-medium text-[var(--text)]">Availability</h2>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-[var(--amber)] text-black rounded-[var(--radius-sm)] cursor-pointer"
        >
          <Plus size={12} /> Add Away Period
        </button>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Mark dates when you're unavailable. All planners will respect these periods.
      </p>

      {error && <p className="text-xs text-[var(--red)]">{error}</p>}

      {showAdd && (
        <div className="p-3 border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--bg-2)] space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Start</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                className="w-full mt-0.5 px-2 py-1.5 text-sm bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]" />
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">End</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                className="w-full mt-0.5 px-2 py-1.5 text-sm bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]" />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Reason (optional)</label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Vacation, travel, illness..."
              className="w-full mt-0.5 px-2 py-1.5 text-sm bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]" />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className="px-3 py-1 text-xs border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text-muted)] cursor-pointer">Cancel</button>
            <button onClick={handleAdd} disabled={saving || !startDate || !endDate}
              className="px-3 py-1 text-xs bg-[var(--amber)] text-black rounded-[var(--radius-sm)] cursor-pointer disabled:opacity-50">
              {saving ? "..." : "Save"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-[var(--text-muted)]">Loading...</p>
      ) : periods.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] text-center py-3">No away periods. You're available for all assignments.</p>
      ) : (
        <div className="space-y-1">
          {periods.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-3 py-2 border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--bg-2)]">
              <div>
                <span className="text-sm font-medium">{fmt(p.startDate)} — {fmt(p.endDate)}</span>
                {p.reason && <span className="ml-2 text-xs text-[var(--text-muted)]">({p.reason})</span>}
              </div>
              <button onClick={() => handleDelete(p.id)} className="text-[var(--red)] hover:text-red-400 cursor-pointer">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
