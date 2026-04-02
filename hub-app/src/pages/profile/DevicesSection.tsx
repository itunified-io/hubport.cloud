/**
 * DevicesSection — profile card showing registered devices for offline sync.
 *
 * Compact card format matching other profile sections.
 * Lists devices with current-device highlighting, status badges, and revoke.
 */
import { useState, useEffect, useCallback } from "react";
import { Smartphone, Monitor, Trash2, Loader2 } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import {
  listDevices,
  removeDevice,
  getCurrentDeviceUuid,
  type RegisteredDevice,
} from "@/lib/device-manager";

const MAX_DEVICES = 3;

function isMobilePlatform(platform: string): boolean {
  return /android|ios|iphone|ipad|mobile/i.test(platform);
}

function statusBadge(status: RegisteredDevice["status"]): {
  label: string;
  className: string;
} {
  switch (status) {
    case "approved":
      return { label: "Aktiv", className: "bg-[#22c55e20] text-[var(--green)]" };
    case "revoked":
      return { label: "Widerrufen", className: "bg-[var(--glass)] text-[var(--text-muted)]" };
    default:
      return { label: "Ausstehend", className: "bg-[var(--amber)]/20 text-[var(--amber)]" };
  }
}

export function DevicesSection() {
  const { user } = useAuth();
  const token = user?.access_token ?? null;
  const currentUuid = getCurrentDeviceUuid();

  const [devices, setDevices] = useState<RegisteredDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setDevices(await listDevices(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  async function handleRemove(deviceId: string) {
    if (!token || removingId) return;
    setRemovingId(deviceId);
    try {
      await removeDevice(token, deviceId);
      setDevices((prev) => prev.filter((d) => d.id !== deviceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Entfernen");
    } finally {
      setRemovingId(null);
    }
  }

  const activeCount = devices.filter((d) => d.status === "approved").length;

  return (
    <div className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-[var(--text)] flex items-center gap-2">
          <Monitor size={14} className="text-[var(--text-muted)]" />
          Geräte
        </h2>
        <span
          className={`text-xs font-medium ${
            activeCount >= MAX_DEVICES ? "text-[var(--red)]" : "text-[var(--text-muted)]"
          }`}
        >
          {activeCount} / {MAX_DEVICES}
        </span>
      </div>

      {error && (
        <p className="text-xs text-[var(--red)]">{error}</p>
      )}

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 size={18} className="animate-spin text-[var(--text-muted)]" />
        </div>
      ) : devices.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] py-4 text-center">
          Keine Geräte registriert.
        </p>
      ) : (
        <ul className="space-y-2">
          {devices.map((device) => {
            const isCurrent = device.deviceUuid === currentUuid;
            const isMobile = isMobilePlatform(device.platform);
            const { label, className: badgeClass } = statusBadge(device.status);
            const isRemoving = removingId === device.id;

            return (
              <li
                key={device.id}
                className={`flex items-center gap-3 rounded-[var(--radius-sm)] border px-3 py-2.5 transition-colors ${
                  isCurrent ? "border-[var(--amber)] bg-[#d9770608]" : "border-[var(--border)]"
                }`}
              >
                <div className="shrink-0 w-8 h-8 rounded-[var(--radius-sm)] bg-[var(--glass)] flex items-center justify-center text-[var(--text-muted)]">
                  {isMobile ? <Smartphone size={15} /> : <Monitor size={15} />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-[var(--text)] truncate">
                      {device.platform}
                    </span>
                    {isCurrent && (
                      <span className="text-[10px] text-[var(--amber)] font-semibold">
                        ← dieses Gerät
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)] truncate">
                    {device.screenSize}
                    {device.lastSeenAt &&
                      ` · ${new Date(device.lastSeenAt).toLocaleDateString("de-DE")}`}
                  </p>
                </div>

                <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${badgeClass}`}>
                  {label}
                </span>

                {!isCurrent && device.status !== "revoked" && (
                  <button
                    onClick={() => handleRemove(device.id)}
                    disabled={!!removingId}
                    title="Gerät entfernen"
                    className="shrink-0 p-1 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--red)] hover:bg-[var(--glass)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {isRemoving ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Trash2 size={13} />
                    )}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
