/**
 * Client-side device manager.
 *
 * Handles device registration, status checks, encryption salt retrieval,
 * and wraps key derivation with the current device UUID.
 *
 * Device UUID is persisted in localStorage under "hubport-device-id".
 * API calls use relative URLs (reverse-proxy pattern; same-origin).
 */
import { deriveEncryptionKey } from "./crypto";
import { getApiUrl } from "./config";

// ─── Constants ───────────────────────────────────────────────────

const DEVICE_ID_KEY = "hubport-device-id";

// ─── Types ───────────────────────────────────────────────────────

export interface DeviceInfo {
  deviceUuid: string;
  userAgent: string;
  platform: string;
  screenSize: string;
}

export interface RegisteredDevice {
  id: string;
  deviceUuid: string;
  displayName: string;
  platform: string;
  screenSize: string;
  status: "active" | "revoked";
  lastSyncAt: string | null;
  registeredAt: string;
}

export interface DeviceStatusResult {
  deviceUuid: string;
  status: "active" | "revoked";
  encryptionEnabled: boolean;
}

export interface EncryptionSaltResult {
  encSalt: string; // base64-encoded
}

// ─── UUID helpers ────────────────────────────────────────────────

/** Returns the device UUID, creating and persisting one if not yet set. */
export function getCurrentDeviceUuid(): string {
  let uuid = localStorage.getItem(DEVICE_ID_KEY);
  if (!uuid) {
    uuid = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, uuid);
  }
  return uuid;
}

/** Clear the device UUID from localStorage (e.g. on logout). */
export function clearDeviceIdentity(): void {
  localStorage.removeItem(DEVICE_ID_KEY);
}

/** Returns true if a device UUID is stored in localStorage. */
export function hasDeviceRegistration(): boolean {
  return localStorage.getItem(DEVICE_ID_KEY) !== null;
}

// ─── Device Info ─────────────────────────────────────────────────

/**
 * Collect device metadata for registration.
 * Uses navigator.userAgentData for modern browsers, falls back to userAgent.
 */
export function collectDeviceInfo(): DeviceInfo {
  const deviceUuid = getCurrentDeviceUuid();
  const userAgent = navigator.userAgent;

  // userAgentData is available in modern Chromium-based browsers
  const uaData = (
    navigator as Navigator & {
      userAgentData?: { platform?: string };
    }
  ).userAgentData;

  const platform = uaData?.platform ?? navigator.platform ?? "unknown";
  const screenSize = `${screen.width}x${screen.height}`;

  return { deviceUuid, userAgent, platform, screenSize };
}

// ─── API calls ───────────────────────────────────────────────────

/**
 * Register this device with the backend.
 * Returns the newly created device record.
 */
export async function registerDevice(token: string): Promise<RegisteredDevice> {
  const info = collectDeviceInfo();
  const res = await fetch(`${getApiUrl()}/devices/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(info),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(
      (body.message as string) ?? (body.error as string) ?? res.statusText,
    );
  }
  return res.json() as Promise<RegisteredDevice>;
}

/**
 * Check the registration status of the current device.
 */
export async function checkDeviceStatus(
  token: string,
): Promise<DeviceStatusResult> {
  const deviceUuid = getCurrentDeviceUuid();
  const res = await fetch(
    `${getApiUrl()}/devices/me?deviceUuid=${encodeURIComponent(deviceUuid)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(
      (body.message as string) ?? (body.error as string) ?? res.statusText,
    );
  }
  return res.json() as Promise<DeviceStatusResult>;
}

/**
 * Retrieve the encryption salt for the current device from the server.
 * The salt is unique per device and is used in PBKDF2 key derivation.
 */
export async function getEncryptionSalt(
  token: string,
): Promise<EncryptionSaltResult> {
  const deviceUuid = getCurrentDeviceUuid();
  const res = await fetch(
    `${getApiUrl()}/devices/encryption-salt?deviceUuid=${encodeURIComponent(deviceUuid)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(
      (body.message as string) ?? (body.error as string) ?? res.statusText,
    );
  }
  return res.json() as Promise<EncryptionSaltResult>;
}

/**
 * List all devices registered to the current user.
 */
export async function listDevices(token: string): Promise<RegisteredDevice[]> {
  const res = await fetch(`${getApiUrl()}/devices`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(
      (body.message as string) ?? (body.error as string) ?? res.statusText,
    );
  }
  return res.json() as Promise<RegisteredDevice[]>;
}

/**
 * Remove (revoke) a device by ID.
 */
export async function removeDevice(
  token: string,
  deviceId: string,
): Promise<void> {
  const res = await fetch(`${getApiUrl()}/devices/${encodeURIComponent(deviceId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(
      (body.message as string) ?? (body.error as string) ?? res.statusText,
    );
  }
}

// ─── Key Derivation ──────────────────────────────────────────────

/**
 * Derive the AES-256-GCM offline encryption key for the current device.
 *
 * @param sub  - Keycloak subject (user ID)
 * @param salt - Base64-encoded salt from the server (from getEncryptionSalt)
 */
export async function deriveDeviceKey(
  sub: string,
  salt: string,
): Promise<CryptoKey> {
  const deviceId = getCurrentDeviceUuid();
  return deriveEncryptionKey(sub, deviceId, salt);
}
