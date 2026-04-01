import { useState, useEffect } from "react";
import { Bell, BellOff, AlertCircle, ToggleLeft, ToggleRight } from "lucide-react";
import { usePushNotifications } from "@/hooks/usePushNotifications";

// ─── Types ────────────────────────────────────────────────────────────

interface NotificationPrefs {
  territory_assignment: boolean;
  meeting_update: boolean;
  sync_conflict: boolean;
}

const PREFS_KEY = "hubport-notification-prefs";

const DEFAULT_PREFS: NotificationPrefs = {
  territory_assignment: true,
  meeting_update: true,
  sync_conflict: true,
};

function loadPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) } as NotificationPrefs;
  } catch {
    // ignore parse error
  }
  return { ...DEFAULT_PREFS };
}

function savePrefs(prefs: NotificationPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

// ─── Sub-components ───────────────────────────────────────────────────

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}

function ToggleRow({ label, description, checked, disabled, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-[var(--border)] last:border-0">
      <div className="flex-1 pr-4">
        <p className="text-sm font-medium text-[var(--text)]">{label}</p>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--amber)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        aria-pressed={checked}
        aria-label={checked ? "Disable" : "Enable"}
      >
        {checked ? (
          <ToggleRight size={28} className="text-[var(--amber)]" />
        ) : (
          <ToggleLeft size={28} />
        )}
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────

export function NotificationSettings() {
  const { supported, permission, subscribed, subscribe, unsubscribe } =
    usePushNotifications();

  const [prefs, setPrefs] = useState<NotificationPrefs>(loadPrefs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Persist prefs on change
  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  const handleMasterToggle = async () => {
    setError(null);
    setBusy(true);
    try {
      if (subscribed) {
        await unsubscribe();
      } else {
        await subscribe();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setBusy(false);
    }
  };

  const updatePref = (key: keyof NotificationPrefs) => (value: boolean) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
  };

  // ─── Unsupported ────────────────────────────────────────────────

  if (!supported) {
    return (
      <div className="max-w-xl space-y-4">
        <div className="flex items-center gap-3">
          <BellOff size={20} className="text-[var(--text-muted)]" />
          <h1 className="text-xl font-semibold text-[var(--text)]">
            Notifications
          </h1>
        </div>
        <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-5">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="text-[var(--text-muted)] mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-[var(--text)]">
                Push notifications not supported
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Your browser does not support Web Push notifications. To receive
                notifications, install the app as a PWA or use a supported
                browser (Chrome, Edge, Firefox, or Safari 16.4+ on iOS).
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Permission denied ──────────────────────────────────────────

  if (permission === "denied") {
    return (
      <div className="max-w-xl space-y-4">
        <div className="flex items-center gap-3">
          <Bell size={20} className="text-[var(--amber)]" />
          <h1 className="text-xl font-semibold text-[var(--text)]">
            Notifications
          </h1>
        </div>
        <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-5">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="text-red-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-[var(--text)]">
                Notifications blocked
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                You have blocked notifications for this site. To enable push
                notifications, update your browser permissions for this site
                and reload the page.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Main view ──────────────────────────────────────────────────

  return (
    <div className="max-w-xl space-y-6">
      <div className="flex items-center gap-3">
        <Bell size={20} className="text-[var(--amber)]" />
        <h1 className="text-xl font-semibold text-[var(--text)]">
          Notifications
        </h1>
      </div>

      {/* Master toggle */}
      <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
        <div className="flex items-center justify-between p-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-[var(--radius-sm)] bg-[var(--glass-2)]">
              {subscribed ? (
                <Bell size={20} className="text-[var(--amber)]" />
              ) : (
                <BellOff size={20} className="text-[var(--text-muted)]" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--text)]">
                Push notifications
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {subscribed
                  ? "This device will receive push notifications"
                  : "Enable to receive real-time alerts on this device"}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={handleMasterToggle}
            className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--amber)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            aria-pressed={subscribed}
          >
            {subscribed ? (
              <ToggleRight size={32} className="text-[var(--amber)]" />
            ) : (
              <ToggleLeft size={32} />
            )}
          </button>
        </div>

        {error && (
          <div className="px-5 pb-4">
            <p className="text-xs text-red-500 flex items-center gap-1.5">
              <AlertCircle size={13} />
              {error}
            </p>
          </div>
        )}
      </div>

      {/* Per-type toggles — only shown when subscribed */}
      {subscribed && (
        <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] px-5">
          <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide pt-4 pb-2">
            Notification types
          </p>

          <ToggleRow
            label="Territory assignments"
            description="When a territory is assigned to or recalled from you"
            checked={prefs.territory_assignment}
            onChange={updatePref("territory_assignment")}
          />

          <ToggleRow
            label="Meeting updates"
            description="Schedule changes, new assignments, or meeting cancellations"
            checked={prefs.meeting_update}
            onChange={updatePref("meeting_update")}
          />

          <ToggleRow
            label="Sync conflicts"
            description="When offline changes cannot be automatically merged"
            checked={prefs.sync_conflict}
            onChange={updatePref("sync_conflict")}
          />

          <ToggleRow
            label="Device revocation alerts"
            description="Always enabled — you will be notified if this device is revoked by an administrator"
            checked
            disabled
            onChange={() => undefined}
          />
        </div>
      )}
    </div>
  );
}
