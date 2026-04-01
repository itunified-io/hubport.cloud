/**
 * Sync engine — delta pull/push with conflict queue and iOS connectivity check.
 *
 * Flow:
 *  fullSync(token, deviceId) → pushChanges → pullChanges
 *
 * Pending changes are stored in the "pendingChanges" Dexie table.
 * Pulled records are encrypted before being stored in Dexie.
 * Pushed payloads are decrypted before being sent to the server.
 */
import {
  getOfflineDB,
  encryptForStorage,
  decryptFromStorage,
  type PendingChange,
} from "./offline-db";

// ─── Types ───────────────────────────────────────────────────────

export type SyncState = "idle" | "pulling" | "pushing" | "error";

export interface SyncStatus {
  lastSyncAt: string | null;
  pendingCount: number;
  conflictCount: number;
  state: SyncState;
}

interface DeltaPage {
  records: Array<{ table: string; id: string; data: Record<string, unknown> | null; deletedAt?: string | null }>;
  cursor: string | null;
  hasMore: boolean;
}

interface PushResult {
  id: string; // pendingChange id (stringified)
  status: "accepted" | "conflict" | "rejected";
  serverData?: Record<string, unknown> | null;
  reason?: string;
}

// ─── State ───────────────────────────────────────────────────────

let _state: SyncState = "idle";
const _listeners: Array<(state: SyncState) => void> = [];

function setState(s: SyncState): void {
  _state = s;
  for (const fn of _listeners) {
    try { fn(s); } catch { /* ignore listener errors */ }
  }
}

// ─── Connectivity ────────────────────────────────────────────────

/**
 * Check real network connectivity via HEAD request with 5-second timeout.
 * Avoids relying solely on navigator.onLine which can lie on iOS.
 */
export async function checkConnectivity(token: string): Promise<boolean> {
  if (!navigator.onLine) return false;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch("/api/sync/status", {
      method: "HEAD",
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res.ok || res.status === 401; // 401 means server is reachable
  } catch {
    return false;
  }
}

// ─── Sync Status ─────────────────────────────────────────────────

/**
 * Fetch sync status from the server (last accepted cursor, server time, etc.).
 */
export async function getSyncStatus(token: string): Promise<Record<string, unknown>> {
  const res = await fetch("/api/sync/status", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(
      (body.message as string) ?? (body.error as string) ?? res.statusText,
    );
  }
  return res.json() as Promise<Record<string, unknown>>;
}

// ─── Pull ────────────────────────────────────────────────────────

/**
 * Delta pull from the server.
 * Pages through all changed records since lastSyncAt cursor.
 * Encrypts each record before storing in Dexie.
 * Updates syncMeta.lastSyncAt on completion.
 */
export async function pullChanges(token: string): Promise<void> {
  setState("pulling");
  try {
    const db = getOfflineDB();

    // Read the last cursor
    const metaEntry = await db.syncMeta.get("lastSyncAt");
    let cursor: string | null = metaEntry?.value ?? null;

    let hasMore = true;
    while (hasMore) {
      const qs = new URLSearchParams();
      if (cursor) qs.set("cursor", cursor);

      const res = await fetch(`/api/sync/pull?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(
          (body.message as string) ?? (body.error as string) ?? res.statusText,
        );
      }

      const page = (await res.json()) as DeltaPage;

      // Process each record
      await db.transaction(
        "rw",
        [
          db.territories, db.addresses, db.visits, db.assignments,
          db.meetingPoints, db.campaignMeetingPoints, db.meetings,
          db.publishers, db.territoryShares,
        ],
        async () => {
          for (const change of page.records) {
            const table = db.table(change.table);
            if (!table) continue;

            if (change.deletedAt || change.data === null) {
              // Record was deleted on server
              await table.delete(change.id);
            } else {
              // Encrypt PII before storing
              const encrypted = await encryptForStorage(
                change.table,
                change.data,
              );
              await table.put(encrypted);
            }
          }
        },
      );

      cursor = page.cursor;
      hasMore = page.hasMore;
    }

    // Persist the new cursor
    const now = new Date().toISOString();
    await db.syncMeta.put({ key: "lastSyncAt", value: cursor ?? now });

    setState("idle");
  } catch (err) {
    setState("error");
    throw err;
  }
}

// ─── Push ────────────────────────────────────────────────────────

/**
 * Push all pending local changes to the server.
 * Marks changes as "pushing", decrypts payloads, sends to server.
 * Handles accepted / conflict / rejected results.
 * Respects the `force` flag from PendingChange for conflict resolution.
 */
export async function pushChanges(
  token: string,
  deviceId: string,
): Promise<void> {
  setState("pushing");
  try {
    const db = getOfflineDB();

    // Fetch all pending changes (not currently in conflict/rejected)
    const pending = await db.pendingChanges
      .where("status")
      .equals("pending")
      .toArray();

    if (pending.length === 0) {
      setState("idle");
      return;
    }

    // Mark all as "pushing"
    const ids = pending.map((c) => c.id!);
    await db.pendingChanges.where("id").anyOf(ids).modify({ status: "pushing" });

    // Decrypt payloads before sending
    const payloads = await Promise.all(
      pending.map(async (change) => {
        const decrypted = await decryptFromStorage(
          "pendingChanges",
          change as Record<string, unknown>,
        ) as unknown as PendingChange;
        return {
          id: String(change.id),
          table: change.table,
          recordId: change.recordId,
          operation: change.operation,
          version: change.version,
          payload: decrypted.payload,
          force: change.force ?? false,
        };
      }),
    );

    const res = await fetch("/api/sync/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ deviceId, changes: payloads }),
    });

    if (!res.ok) {
      // Roll back "pushing" → "pending" on network errors
      await db.pendingChanges.where("id").anyOf(ids).modify({ status: "pending" });
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      throw new Error(
        (body.message as string) ?? (body.error as string) ?? res.statusText,
      );
    }

    const results = (await res.json()) as PushResult[];

    // Process each result
    for (const result of results) {
      const numId = Number(result.id);
      switch (result.status) {
        case "accepted":
          await db.pendingChanges.delete(numId);
          break;

        case "conflict": {
          // Encrypt server data before storing
          let encryptedServerData: string | null = null;
          if (result.serverData) {
            const enc = await encryptFromObject("pendingChanges", result.serverData);
            encryptedServerData = enc;
          }
          await db.pendingChanges.update(numId, {
            status: "conflict",
            serverData: encryptedServerData,
            updatedAt: new Date().toISOString(),
          });
          break;
        }

        case "rejected":
          await db.pendingChanges.update(numId, {
            status: "rejected",
            updatedAt: new Date().toISOString(),
          });
          break;
      }
    }

    setState("idle");
  } catch (err) {
    setState("error");
    throw err;
  }
}

// ─── Queue local change ──────────────────────────────────────────

/**
 * Queue a local mutation into pendingChanges.
 * Payload is encrypted before storage.
 *
 * @param table     - Dexie table name
 * @param recordId  - The record's primary key
 * @param operation - create | update | delete
 * @param version   - Known server version of the record (0 for creates)
 * @param payload   - The change payload (plain object or JSON string)
 */
export async function queueChange(
  table: string,
  recordId: string,
  operation: "create" | "update" | "delete",
  version: number,
  payload: Record<string, unknown> | string,
): Promise<number> {
  const db = getOfflineDB();
  const now = new Date().toISOString();
  const payloadStr =
    typeof payload === "string" ? payload : JSON.stringify(payload);

  // Encrypt the payload string
  const encrypted = await encryptFromObject("pendingChanges", { payload: payloadStr, serverData: null });

  const change: PendingChange = {
    table,
    recordId,
    operation,
    version,
    payload: encrypted as unknown as string,
    serverData: null,
    status: "pending",
    force: false,
    createdAt: now,
    updatedAt: now,
  };

  return db.pendingChanges.add(change);
}

// ─── Queries ─────────────────────────────────────────────────────

/** Returns the number of pending (not yet pushed) changes. */
export async function getPendingCount(): Promise<number> {
  const db = getOfflineDB();
  return db.pendingChanges.where("status").equals("pending").count();
}

/** Returns all changes currently in conflict state. */
export async function getConflicts(): Promise<PendingChange[]> {
  const db = getOfflineDB();
  return db.pendingChanges.where("status").equals("conflict").toArray();
}

// ─── Conflict Resolution ─────────────────────────────────────────

/**
 * Resolve a conflict by keeping the local version.
 * Sets status back to "pending" and force=true so the next push overwrites.
 */
export async function resolveKeepMine(changeId: number): Promise<void> {
  const db = getOfflineDB();
  await db.pendingChanges.update(changeId, {
    status: "pending",
    force: true,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Resolve a conflict by using the server version.
 * Discards the local pending change entirely.
 */
export async function resolveUseTheirs(changeId: number): Promise<void> {
  const db = getOfflineDB();
  await db.pendingChanges.delete(changeId);
}

// ─── Full Sync ───────────────────────────────────────────────────

/**
 * Full sync: push local changes first, then pull remote changes.
 * Push-first ensures our changes are acknowledged before we overwrite local
 * state with the server's view.
 */
export async function fullSync(token: string, deviceId: string): Promise<void> {
  await pushChanges(token, deviceId);
  await pullChanges(token);
}

// ─── Storage Persistence ─────────────────────────────────────────

/**
 * Request persistent storage from the browser.
 * Without this, IndexedDB may be evicted under storage pressure.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

// ─── Event System ────────────────────────────────────────────────

/**
 * Register a listener for sync state changes.
 * Returns a cleanup function that removes the listener.
 */
export function onSyncStateChange(fn: (state: SyncState) => void): () => void {
  _listeners.push(fn);
  // Immediately emit current state
  fn(_state);
  return () => {
    const idx = _listeners.indexOf(fn);
    if (idx !== -1) _listeners.splice(idx, 1);
  };
}

// ─── Internal helpers ────────────────────────────────────────────

/**
 * Encrypt a plain JS object into a JSON string using the pendingChanges
 * encryption fields map, then return the encrypted payload string.
 * Used when storing server conflict data.
 */
async function encryptFromObject(
  _tableName: string,
  obj: Record<string, unknown>,
): Promise<string> {
  const encrypted = await encryptForStorage("pendingChanges", obj);
  // Return the encrypted payload field value
  return (encrypted as Record<string, unknown>).payload as string;
}
