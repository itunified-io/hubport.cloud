/**
 * MyDevices — user-facing page listing all devices registered to the current user.
 *
 * - Highlights the current device with an amber border and "← this device" label
 * - Shows active count / 3
 * - Allows revoking non-current devices
 * - Device icon based on platform (Smartphone vs Monitor)
 * - Status badge (Active / Revoked)
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

function statusLabel(status: RegisteredDevice["status"]): {
  label: string;
  className: string;
} {
  switch (status) {
    case "approved":
      return {
        label: "Active",
        className: "bg-[#22c55e20] text-[var(--green)]",
      };
    case "revoked":
      return {
        label: "Revoked",
        className: "bg-[var(--glass)] text-[var(--text-muted)]",
      };
    default:
      return {
        label: "Pending",
        className: "bg-[var(--amber)]/20 text-[var(--amber)]",
      };
  }
}

export function MyDevices() {
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
      const data = await listDevices(token);
      setDevices(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load devices");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRemove(deviceId: string) {
    if (!token || removingId) return;
    setRemovingId(deviceId);
    try {
      await removeDevice(token, deviceId);
      setDevices((prev) => prev.filter((d) => d.id !== deviceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove device");
    } finally {
      setRemovingId(null);
    }
  }

  const activeCount = devices.filter((d) => d.status === "approved").length;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[var(--text)]">My Devices</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Registered devices for offline access.{" "}
          <span
            className={
              activeCount >= MAX_DEVICES
                ? "text-[var(--red)]"
                : "text-[var(--text-muted)]"
            }
          >
            {activeCount} / {MAX_DEVICES} active
          </span>
        </p>
      </div>

      {error && (
        <div className="rounded-[var(--radius-sm)] border border-[var(--red)]/40 bg-[var(--red)]/10 px-4 py-3 text-sm text-[var(--red)]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
        </div>
      ) : devices.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-muted)] text-sm">
          No devices registered yet.
        </div>
      ) : (
        <ul className="space-y-3">
          {devices.map((device) => {
            const isCurrent = device.deviceUuid === currentUuid;
            const isMobile = isMobilePlatform(device.platform);
            const { label, className: badgeClass } = statusLabel(device.status);
            const isRemoving = removingId === device.id;

            return (
              <li
                key={device.id}
                className={`flex items-center gap-4 rounded-[var(--radius)] border px-4 py-3 bg-[var(--bg-1)] transition-colors ${
                  isCurrent
                    ? "border-[var(--amber)]"
                    : "border-[var(--border)]"
                }`}
              >
                {/* Icon */}
                <div className="shrink-0 w-9 h-9 rounded-[var(--radius-sm)] bg-[var(--glass)] flex items-center justify-center text-[var(--text-muted)]">
                  {isMobile ? <Smartphone size={18} /> : <Monitor size={18} />}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-[var(--text)] truncate">
                      {device.platform}
                    </span>
                    {isCurrent && (
                      <span className="text-xs text-[var(--amber)] font-semibold">
                        ← this device
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">
                    {device.userAgent}
                  </p>
                  {device.lastSeenAt && (
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Last seen:{" "}
                      {new Date(device.lastSeenAt).toLocaleString()}
                    </p>
                  )}
                </div>

                {/* Status badge */}
                <span
                  className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${badgeClass}`}
                >
                  {label}
                </span>

                {/* Remove button — not shown for current device */}
                {!isCurrent && device.status !== "revoked" && (
                  <button
                    onClick={() => handleRemove(device.id)}
                    disabled={!!removingId}
                    title="Remove device"
                    className="shrink-0 p-1.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--red)] hover:bg-[var(--glass)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    aria-label="Remove device"
                  >
                    {isRemoving ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
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
