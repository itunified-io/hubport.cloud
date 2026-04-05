import { useState, useEffect } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Sparkles, Calendar, RotateCcw, Check, X } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { usePermissions } from "@/auth/PermissionProvider";
import { getApiUrl } from "@/lib/config";

interface CleaningDuty {
  id: string;
  name: string;
  category: string;
  isDefault: boolean;
  _count: { schedules: number };
}

interface Schedule {
  id: string;
  date: string;
  status: string;
  notes: string | null;
  duty: { id: string; name: string; category: string };
  serviceGroup: { id: string; name: string };
}

function statusBadge(status: string) {
  const cls: Record<string, string> = {
    scheduled: "text-[var(--amber)] bg-[#d9770614]",
    completed: "text-[var(--green)] bg-[#22c55e14]",
    skipped: "text-[var(--text-muted)] bg-[var(--glass)]",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${cls[status] ?? cls.scheduled}`}>
      {status === "completed" ? <Check size={10} /> : status === "skipped" ? <X size={10} /> : <Calendar size={10} />}
      {status}
    </span>
  );
}

export function CleaningTab() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const intl = useIntl();
  const apiUrl = getApiUrl();
  const headers = { Authorization: `Bearer ${user?.access_token}`, "Content-Type": "application/json" };
  const canManage = can("manage:facilities.cleaning");

  const [duties, setDuties] = useState<CleaningDuty[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGenerator, setShowGenerator] = useState(false);
  const [genDutyId, setGenDutyId] = useState("");
  const [genFreq, setGenFreq] = useState<"weekly" | "biweekly" | "monthly">("monthly");
  const [genMonths, setGenMonths] = useState(6);

  const fetchAll = async () => {
    try {
      const [dRes, sRes] = await Promise.all([
        fetch(`${apiUrl}/facilities/cleaning/duties`, { headers }),
        fetch(`${apiUrl}/facilities/cleaning/schedules`, { headers }),
      ]);
      if (dRes.ok) setDuties(await dRes.json() as CleaningDuty[]);
      if (sRes.ok) setSchedules(await sRes.json() as Schedule[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, [user?.access_token]);

  const seedDefaults = async () => {
    await fetch(`${apiUrl}/facilities/cleaning/seed`, { method: "POST", headers, body: "{}" });
    await fetch(`${apiUrl}/service-groups/seed`, { headers });
    fetchAll();
  };

  const generateSchedule = async () => {
    if (!genDutyId) return;
    const now = new Date();
    const end = new Date(now);
    end.setMonth(end.getMonth() + genMonths);
    await fetch(`${apiUrl}/facilities/cleaning/schedules/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        dutyId: genDutyId,
        startDate: now.toISOString().split("T")[0],
        endDate: end.toISOString().split("T")[0],
        frequency: genFreq,
      }),
    });
    setShowGenerator(false);
    fetchAll();
  };

  const updateStatus = async (scheduleId: string, status: string) => {
    await fetch(`${apiUrl}/facilities/cleaning/schedules/${scheduleId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ status }),
    });
    fetchAll();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (duties.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
        <Sparkles size={40} className="text-[var(--text-muted)] mb-3" strokeWidth={1.2} />
        <p className="text-sm text-[var(--text-muted)] mb-4">
          <FormattedMessage id="facilities.cleaning.empty" />
        </p>
        {canManage && (
          <button onClick={seedDefaults} className="px-4 py-2 bg-[var(--amber)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer">
            <FormattedMessage id="facilities.cleaning.seed" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Actions */}
      {canManage && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowGenerator(!showGenerator)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            <RotateCcw size={14} />
            <FormattedMessage id="facilities.cleaning.generate" />
          </button>
        </div>
      )}

      {/* Schedule Generator */}
      {showGenerator && canManage && (
        <div className="p-4 border border-[var(--amber)] border-opacity-30 rounded-[var(--radius)] bg-[var(--bg-1)] space-y-3">
          <h3 className="text-sm font-medium text-[var(--text)]">
            <FormattedMessage id="facilities.cleaning.generate" />
          </h3>
          <div className="flex flex-wrap gap-3">
            <select value={genDutyId} onChange={(e) => setGenDutyId(e.target.value)} className="px-3 py-1.5 text-sm bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]">
              <option value="">— Duty —</option>
              {duties.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select value={genFreq} onChange={(e) => setGenFreq(e.target.value as typeof genFreq)} className="px-3 py-1.5 text-sm bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]">
              <option value="weekly">{intl.formatMessage({ id: "facilities.cleaning.frequency.weekly" })}</option>
              <option value="biweekly">{intl.formatMessage({ id: "facilities.cleaning.frequency.biweekly" })}</option>
              <option value="monthly">{intl.formatMessage({ id: "facilities.cleaning.frequency.monthly" })}</option>
            </select>
            <select value={genMonths} onChange={(e) => setGenMonths(Number(e.target.value))} className="px-3 py-1.5 text-sm bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]">
              <option value={3}>3 {intl.formatMessage({ id: "facilities.cleaning.months" })}</option>
              <option value={6}>6 {intl.formatMessage({ id: "facilities.cleaning.months" })}</option>
              <option value={12}>12 {intl.formatMessage({ id: "facilities.cleaning.months" })}</option>
            </select>
            <button onClick={generateSchedule} disabled={!genDutyId} className="px-4 py-1.5 text-sm font-semibold bg-[var(--amber)] text-black rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] disabled:bg-[var(--border)] disabled:text-[var(--text-muted)] transition-colors cursor-pointer">
              <FormattedMessage id="facilities.cleaning.generate.run" />
            </button>
          </div>
        </div>
      )}

      {/* Cleaning Duties Grid */}
      <div className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] space-y-4">
        <h2 className="text-sm font-medium text-[var(--text)] flex items-center gap-2">
          <Sparkles size={14} className="text-[var(--amber)]" />
          <FormattedMessage id="facilities.cleaning.title" />
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {duties.map((d) => (
            <div key={d.id} className="p-3 border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--bg)]">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[var(--text)]">{d.name}</span>
                <span className="text-[10px] text-[var(--text-muted)] bg-[var(--glass)] px-1.5 py-0.5 rounded">{d.category}</span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-1">{d._count.schedules} schedules</p>
            </div>
          ))}
        </div>
      </div>

      {/* Schedule Table */}
      {schedules.length > 0 && (
        <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                <th className="px-4 py-3 font-medium"><FormattedMessage id="facilities.cleaning.schedule.date" /></th>
                <th className="px-4 py-3 font-medium"><FormattedMessage id="facilities.cleaning.schedule.duty" /></th>
                <th className="px-4 py-3 font-medium hidden sm:table-cell"><FormattedMessage id="facilities.cleaning.schedule.group" /></th>
                <th className="px-4 py-3 font-medium"><FormattedMessage id="facilities.cleaning.schedule.status" /></th>
                {canManage && <th className="px-4 py-3 font-medium w-24" />}
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--glass)] transition-colors">
                  <td className="px-4 py-3 text-[var(--text)]">{new Date(s.date).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-[var(--text)]">{s.duty.name}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)] hidden sm:table-cell">{s.serviceGroup.name}</td>
                  <td className="px-4 py-3">{statusBadge(s.status)}</td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {s.status !== "completed" && (
                          <button onClick={() => updateStatus(s.id, "completed")} className="p-1 text-[var(--green)] hover:bg-[var(--glass)] rounded cursor-pointer"><Check size={14} /></button>
                        )}
                        {s.status !== "skipped" && (
                          <button onClick={() => updateStatus(s.id, "skipped")} className="p-1 text-[var(--text-muted)] hover:bg-[var(--glass)] rounded cursor-pointer"><X size={14} /></button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
