import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/auth/useAuth";
import { getCurrentDeviceUuid } from "@/lib/device-manager";

// ─── Types ────────────────────────────────────────────────────────────

type PermissionState = "default" | "granted" | "denied";

interface UsePushNotificationsResult {
  /** True if the browser supports Web Push (Notification + ServiceWorker + PushManager). */
  supported: boolean;
  /** Current notification permission state. */
  permission: PermissionState;
  /** True if this device has an active push subscription on the server. */
  subscribed: boolean;
  /** Request permission and subscribe this device to push notifications. */
  subscribe: () => Promise<void>;
  /** Unsubscribe this device from push notifications. */
  unsubscribe: () => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function getDeviceDbId(token: string): Promise<string | null> {
  const deviceUuid = getCurrentDeviceUuid();
  const res = await fetch(
    `/api/devices/me?deviceUuid=${encodeURIComponent(deviceUuid)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { id: string };
  return data.id ?? null;
}

// ─── Hook ─────────────────────────────────────────────────────────────

export function usePushNotifications(): UsePushNotificationsResult {
  const { user } = useAuth();
  const token = user?.access_token ?? "";

  const supported =
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window;

  const [permission, setPermission] = useState<PermissionState>(
    supported ? (Notification.permission as PermissionState) : "default",
  );
  const [subscribed, setSubscribed] = useState(false);

  // Check subscription state on mount
  useEffect(() => {
    if (!supported || !token) return;

    void (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        setSubscribed(existing !== null);
      } catch {
        // ignore — SW not yet registered in dev mode
      }
    })();
  }, [supported, token]);

  const subscribe = useCallback(async () => {
    if (!supported || !token) return;

    // 1. Request notification permission
    const perm = await Notification.requestPermission();
    setPermission(perm as PermissionState);
    if (perm !== "granted") return;

    // 2. Get VAPID public key from server
    const keyRes = await fetch("/api/push/vapid-key", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!keyRes.ok) throw new Error("Failed to fetch VAPID key");
    const { publicKey } = (await keyRes.json()) as { publicKey: string };

    // 3. Subscribe via PushManager
    const reg = await navigator.serviceWorker.ready;
    const pushSub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
    });

    // 4. Get device DB id
    const deviceId = await getDeviceDbId(token);
    if (!deviceId) throw new Error("Device not registered");

    // 5. Store subscription on server
    const subJson = pushSub.toJSON();
    const storeRes = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        deviceId,
        endpoint: pushSub.endpoint,
        p256dh: subJson.keys?.p256dh ?? "",
        auth: subJson.keys?.auth ?? "",
      }),
    });
    if (!storeRes.ok) throw new Error("Failed to store push subscription");

    setSubscribed(true);
  }, [supported, token]);

  const unsubscribe = useCallback(async () => {
    if (!supported || !token) return;

    // 1. Unsubscribe locally
    const reg = await navigator.serviceWorker.ready;
    const pushSub = await reg.pushManager.getSubscription();
    if (pushSub) {
      await pushSub.unsubscribe();
    }

    // 2. Get device DB id
    const deviceId = await getDeviceDbId(token);
    if (deviceId) {
      // 3. Remove subscription from server
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ deviceId }),
      });
    }

    setSubscribed(false);
  }, [supported, token]);

  return { supported, permission, subscribed, subscribe, unsubscribe };
}
