import { useState, useEffect } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { ClipboardCheck, Plus, Download, Check } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { usePermissions } from "@/auth/PermissionProvider";
import { getApiUrl } from "@/lib/config";
import { PreventiveForm } from "./PreventiveForm";

interface Task {
  id: string; name: string; description: string | null; category: string; frequency: string;
  assignee: { id: string; firstName: string; lastName: string } | null;
  lastDone: string | null; nextDue: string | null; isDefault: boolean;
  _count: { entries: number };
}

function urgencyClass(nextDue: string | null): { color: string; label: string } {
  if (!nextDue) return { color: "text-[var(--text-muted)]", label: "facilities.preventive.onTrack" };
  const diff = new Date(nextDue).getTime() - Date.now();
  const days = diff / (1000 * 60 * 60 * 24);
  if (days < 0) return { color: "text-red-400", label: "facilities.preventive.overdue" };
  if (days < 30) return { color: "text-yellow-400", label: "facilities.preventive.dueSoon" };
  return { color: "text-[var(--green)]", label: "facilities.preventive.onTrack" };
}

export function PreventiveTab() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const intl = useIntl();
  const apiUrl = getApiUrl();
  const headers = { Authorization: `Bearer ${user?.access_token}`, "Content-Type": "application/json" };
  const canManage = can("manage:facilities.preventive");

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const fetchTasks = async () => {
    try {
      const res = await fetch(`${apiUrl}/facilities/preventive`, { headers });
      if (res.ok) {
        const data = await res.json() as { data: Task[] };
        setTasks(data.data);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTasks(); }, [user?.access_token]);

  const seedDefaults = async () => {
    await fetch(`${apiUrl}/facilities/preventive/seed`, { method: "POST", headers, body: "{}" });
    fetchTasks();
  };

  const markComplete = async (taskId: string) => {
    await fetch(`${apiUrl}/facilities/preventive/${taskId}/complete`, {
      method: "POST", headers, body: JSON.stringify({ doneAt: new Date().toISOString() }),
    });
    fetchTasks();
  };

  const downloadICal = () => {
    window.open(`${apiUrl}/facilities/preventive/calendar.ics`, "_blank");
  };

  // Stats
  const overdue = tasks.filter((t) => t.nextDue && new Date(t.nextDue).getTime() < Date.now()).length;
  const dueSoon = tasks.filter((t) => {
    if (!t.nextDue) return false;
    const diff = (new Date(t.nextDue).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff < 30;
  }).length;
  const onTrack = tasks.length - overdue - dueSoon;

  if (loading) {
    return <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
        <ClipboardCheck size={40} className="text-[var(--text-muted)] mb-3" strokeWidth={1.2} />
        <p className="text-sm text-[var(--text-muted)] mb-4"><FormattedMessage id="facilities.preventive.empty" /></p>
        {canManage && (
          <button onClick={seedDefaults} className="px-4 py-2 bg-[var(--amber)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer">
            <FormattedMessage id="facilities.preventive.seed" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--bg-1)]">
          <div className="text-2xl font-bold text-red-400">{overdue}</div>
          <div className="text-xs text-[var(--text-muted)]"><FormattedMessage id="facilities.preventive.overdue" /></div>
        </div>
        <div className="p-3 border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--bg-1)]">
          <div className="text-2xl font-bold text-yellow-400">{dueSoon}</div>
          <div className="text-xs text-[var(--text-muted)]"><FormattedMessage id="facilities.preventive.dueSoon" /></div>
        </div>
        <div className="p-3 border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--bg-1)]">
          <div className="text-2xl font-bold text-[var(--green)]">{onTrack}</div>
          <div className="text-xs text-[var(--text-muted)]"><FormattedMessage id="facilities.preventive.onTrack" /></div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <button onClick={downloadICal} className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer">
          <Download size={14} />
          <FormattedMessage id="facilities.preventive.ical" />
        </button>
        {canManage && (
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 bg-[var(--amber)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] cursor-pointer">
            <Plus size={14} />
            <FormattedMessage id="facilities.preventive.create" />
          </button>
        )}
      </div>

      {showForm && <PreventiveForm onClose={() => setShowForm(false)} onCreated={() => { setShowForm(false); fetchTasks(); }} />}

      {/* Task List */}
      <div className="space-y-2">
        {tasks.map((task) => {
          const urg = urgencyClass(task.nextDue);
          return (
            <div key={task.id} className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--text)]">{task.name}</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/20 text-blue-400">
                    {intl.formatMessage({ id: `facilities.category.${task.category}` })}
                  </span>
                </div>
                <div className="text-xs text-[var(--text-muted)] mt-1">
                  {intl.formatMessage({ id: `facilities.frequency.${task.frequency}` })}
                  {task.assignee && ` · ${task.assignee.firstName} ${task.assignee.lastName}`}
                  {task.lastDone && ` · Last: ${new Date(task.lastDone).toLocaleDateString()}`}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className={`text-xs font-medium ${urg.color}`}><FormattedMessage id={urg.label} /></div>
                  {task.nextDue && <div className="text-[10px] text-[var(--text-muted)]">{new Date(task.nextDue).toLocaleDateString()}</div>}
                </div>
                {canManage && (
                  <button onClick={() => markComplete(task.id)} className="p-2 text-[var(--green)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer" title={intl.formatMessage({ id: "facilities.preventive.complete" })}>
                    <Check size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
