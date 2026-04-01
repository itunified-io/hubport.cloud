import webpush from "web-push";

// ─── Types ────────────────────────────────────────────────────────────

export type PushNotificationType =
  | "territory_assignment"
  | "meeting_update"
  | "sync_conflict"
  | "device_revoked";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  type: PushNotificationType;
}

export interface PushSubscriptionData {
  endpoint: string;
  p256dh: string;
  auth: string;
}

// ─── VAPID Configuration ──────────────────────────────────────────────

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY ?? "";
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY ?? "";
const vapidSubject =
  process.env.VAPID_SUBJECT ?? "mailto:admin@hubport.cloud";

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Returns the VAPID public key for client-side push subscription.
 */
export function getVapidPublicKey(): string {
  return vapidPublicKey;
}

/**
 * Send a push notification to a single subscription.
 *
 * Returns `true` on success.
 * Returns `false` for expired/invalid subscriptions (HTTP 410 or 404) —
 * the caller should delete these from the database.
 * Throws for other errors.
 */
export async function sendPushNotification(
  subscription: PushSubscriptionData,
  payload: PushPayload,
): Promise<boolean> {
  if (!vapidPublicKey || !vapidPrivateKey) {
    // VAPID not configured — skip silently (dev/test environments)
    return false;
  }

  const pushSubscription: webpush.PushSubscription = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    },
  };

  try {
    await webpush.sendNotification(
      pushSubscription,
      JSON.stringify(payload),
    );
    return true;
  } catch (err: unknown) {
    const statusCode =
      err && typeof err === "object" && "statusCode" in err
        ? (err as { statusCode: number }).statusCode
        : undefined;

    // 410 Gone or 404 Not Found — subscription expired or invalid
    if (statusCode === 410 || statusCode === 404) {
      return false;
    }

    throw err;
  }
}
