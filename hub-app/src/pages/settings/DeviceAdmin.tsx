/**
 * DeviceAdmin — admin view of all tenant devices, grouped by userId.
 *
 * - Fetches from GET /api/admin/devices
 * - Allows revoking devices with a reason prompt
 * - Shows status badges per device
 */
import { useState, useEffect, useCallback } from "react";
import { Monitor, Smartphone, Trash2, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { useAuth } from "@/auth/useAuth";

// ─── Types ────────────────────────────────────────────────────────

interface AdminDevice {
  id: string;
  deviceUuid: string;
  userId: string;
  userDisplayName?: string;
  userAgent: string;
  platform: string;
  screenSize: string;
  status: "pending" | "approved" | "revoked";
  lastSeenAt: string | null;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────

function isMobilePlatform(platform: string): boolean {
  return /android|ios|iphone|ipad|mobile/i.test(platform);
}

function statusBadge(status: AdminDevice["status"]): {
  label: string;
  className: string;
} {
  switch (status) {
    case "approved":
      return { label: "Active", className: "bg-[#22c55e20] text-[var(--green)]" };
    case "revoked":
      return { label: "Revoked", className: "bg-[var(--glass)] text-[var(--text-muted)]" };
    default:
      return { label: "Pending", className: "bg-[var(--amber)]/20 text-[var(--amber)]" };
  }
}

// ─── API helpers ──────────────────────────────────────────────────

async function fetchAdminDevices(token: string): Promise<AdminDevice[]> {
  const res = await fetch("/api/admin/devices", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(
      (body.message as string) ?? (body.error as string) ?? res.statusText,
    );
  }
  return res.json() as Promise<AdminDevice[]>;
}

async function revokeDevice(
  token: string,
  deviceId: string,
  reason: string,
): Promise<void> {
  const res = await fetch(`/api/admin/devices/${encodeURIComponent(deviceId)}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(
      (body.message as string) ?? (body.error as string) ?? res.statusText,
    );
  }
}

// ─── Component ────────────────────────────────────────────────────

export function DeviceAdmin() {
  const { user } = useAuth();
  const token = user?.access_token ?? null;

  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminDevices(token);
      setDevices(data);
      // Expand all user groups by default
      const userIds = new Set(data.map((d) => d.userId));
      setExpandedUsers(userIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load devices");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleUser(userId: string) {
    setExpandedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }

  async function handleRevoke(device: AdminDevice) {
    if (!token || removingId) return;
    const reason = window.prompt(
      `Reason for revoking device "${device.platform}" (${device.deviceUuid.slice(0, 8)}…)?`,
    );
    if (reason == null) return; // cancelled
    setRemovingId(device.id);
    try {
      await revokeDevice(token, device.id, reason);
      setDevices((prev) =>
        prev.map((d) =>
          d.id === device.id ? { ...d, status: "revoked" as const } : d,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke device");
    } finally {
      setRemovingId(null);
    }
  }

  // Group devices by userId
  const grouped = devices.reduce<Map<string, AdminDevice[]>>((acc, d) => {
    const existing = acc.get(d.userId) ?? [];
    existing.push(d);
    acc.set(d.userId, existing);
    return acc;
  }, new Map());

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[var(--text)]">Device Administration</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          All registered devices across the congregation, grouped by user.
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
      ) : grouped.size === 0 ? (
        <div className="text-center py-12 text-[var(--text-muted)] text-sm">
          No devices found.
        </div>
      ) : (
        <div className="space-y-3">
          {Array.from(grouped.entries()).map(([userId, userDevices]) => {
            const isExpanded = expandedUsers.has(userId);
            const displayName =
              userDevices[0]?.userDisplayName ?? userId.slice(0, 12) + "…";

            return (
              <div
                key={userId}
                className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-1)] overflow-hidden"
              >
                {/* User header row */}
                <button
                  onClick={() => toggleUser(userId)}
                  className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-[var(--glass)] transition-colors cursor-pointer"
                >
                  {isExpanded ? (
                    <ChevronDown size={14} className="text-[var(--text-muted)] shrink-0" />
                  ) : (
                    <ChevronRight size={14} className="text-[var(--text-muted)] shrink-0" />
                  )}
                  <span className="text-sm font-medium text-[var(--text)]">
                    {displayName}
                  </span>
                  <span className="text-xs text-[var(--text-muted)] ml-auto">
                    {userDevices.length} device{userDevices.length === 1 ? "" : "s"}
                  </span>
                </button>

                {/* Device list */}
                {isExpanded && (
                  <ul className="border-t border-[var(--border)] divide-y divide-[var(--border)]">
                    {userDevices.map((device) => {
                      const isMobile = isMobilePlatform(device.platform);
                      const { label, className: badgeClass } = statusBadge(device.status);
                      const isRemoving = removingId === device.id;

                      return (
                        <li
                          key={device.id}
                          className="flex items-center gap-4 px-4 py-3"
                        >
                          {/* Icon */}
                          <div className="shrink-0 w-8 h-8 rounded-[var(--radius-sm)] bg-[var(--glass)] flex items-center justify-center text-[var(--text-muted)]">
                            {isMobile ? (
                              <Smartphone size={15} />
                            ) : (
                              <Monitor size={15} />
                            )}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-[var(--text)] truncate">
                              {device.platform}
                            </p>
                            <p className="text-xs text-[var(--text-muted)] truncate">
                              {device.deviceUuid}
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

                          {/* Revoke button */}
                          {device.status !== "revoked" && (
                            <button
                              onClick={() => handleRevoke(device)}
                              disabled={!!removingId}
                              title="Revoke device"
                              className="shrink-0 p-1.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--red)] hover:bg-[var(--glass)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                              aria-label="Revoke device"
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
          })}
        </div>
      )}
    </div>
  );
}
