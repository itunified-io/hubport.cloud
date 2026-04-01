/**
 * Dexie.js offline database with AES-256-GCM encryption middleware.
 *
 * Database name: hubportOffline-{tenantId}  (tenant-scoped)
 * All PII fields are encrypted before writing to IndexedDB.
 */
import Dexie, { type Table } from "dexie";
import { encryptFields, decryptFields } from "./crypto";

// ─── Table Interfaces ────────────────────────────────────────────

export interface OfflineTerritory {
  id: string;
  number: string;
  name: string;
  description: string | null;
  type?: string;
  boundaries: unknown | null; // GeoJSON — encrypted as JSON string
  createdAt: string;
  updatedAt: string;
  _v?: number; // server version for sync
}

export interface OfflineAddress {
  id: string;
  territoryId: string | null;
  street: string;
  houseNumber: string | null;
  city: string | null;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  type: string;
  status: string;
  languageSpoken: string | null;
  bellCount: number | null;
  notes: string | null;
  lastVisitDate: string | null;
  lastVisitOutcome: string | null;
  createdAt: string;
  updatedAt: string;
  _v?: number;
}

export interface OfflineVisit {
  id: string;
  addressId: string;
  territoryId: string | null;
  memberId: string | null;
  visitDate: string;
  outcome: string;
  notes: string | null;
  createdAt: string;
  _v?: number;
}

export interface OfflineAssignment {
  id: string;
  territoryId: string;
  publisherId: string;
  assignedAt: string;
  returnedAt: string | null;
  createdAt: string;
  updatedAt: string;
  _v?: number;
}

export interface OfflineMeetingPoint {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  dayOfWeek: number;
  time: string;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  _v?: number;
}

export interface OfflineCampaignMeetingPoint {
  id: string;
  campaignId: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _v?: number;
}

export interface OfflineMeeting {
  id: string;
  meetingPointId: string;
  date: string;
  time: string;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  _v?: number;
}

export interface OfflinePublisher {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _v?: number;
}

export interface OfflineTerritoryShare {
  id: string;
  territoryId: string;
  sharedWithId: string;
  sharedAt: string;
  expiresAt: string | null;
  _v?: number;
}

export interface PendingChange {
  id?: number; // auto-increment
  table: string;
  recordId: string;
  operation: "create" | "update" | "delete";
  version: number;
  payload: string; // JSON — encrypted
  serverData?: string | null; // JSON — encrypted; populated on conflict
  status: "pending" | "pushing" | "conflict" | "rejected";
  force?: boolean; // true = force-push on next push cycle
  createdAt: string;
  updatedAt: string;
}

export interface SyncMetaEntry {
  key: string;
  value: string;
}

// ─── Encrypted Fields Map ────────────────────────────────────────

/**
 * Which fields to encrypt per table.
 * Only string or object fields that contain PII or sensitive data.
 */
export const ENCRYPTED_FIELDS: Record<string, string[]> = {
  territories: ["name", "description", "boundaries"],
  addresses: ["street", "houseNumber", "city", "postcode", "notes"],
  visits: ["notes"],
  meetingPoints: ["name", "address"],
  campaignMeetingPoints: ["name", "address"],
  meetings: ["notes"],
  publishers: ["firstName", "lastName"],
  pendingChanges: ["payload", "serverData"],
};

/**
 * Fields that should be JSON.parsed after decryption
 * (they were JSON.stringified before encryption).
 */
export const JSON_ENCRYPTED_FIELDS: Record<string, string[]> = {
  territories: ["boundaries"],
};

// ─── Dexie DB Class ──────────────────────────────────────────────

export class HubportOfflineDB extends Dexie {
  territories!: Table<OfflineTerritory, string>;
  addresses!: Table<OfflineAddress, string>;
  visits!: Table<OfflineVisit, string>;
  assignments!: Table<OfflineAssignment, string>;
  meetingPoints!: Table<OfflineMeetingPoint, string>;
  campaignMeetingPoints!: Table<OfflineCampaignMeetingPoint, string>;
  meetings!: Table<OfflineMeeting, string>;
  publishers!: Table<OfflinePublisher, string>;
  territoryShares!: Table<OfflineTerritoryShare, string>;
  pendingChanges!: Table<PendingChange, number>;
  syncMeta!: Table<SyncMetaEntry, string>;

  constructor(tenantId: string) {
    super(`hubportOffline-${tenantId}`);

    this.version(1).stores({
      territories: "id, number, updatedAt",
      addresses: "id, territoryId, status, updatedAt",
      visits: "id, addressId, territoryId, visitDate",
      assignments: "id, territoryId, publisherId, assignedAt",
      meetingPoints: "id, dayOfWeek, isActive, updatedAt",
      campaignMeetingPoints: "id, campaignId, isActive, updatedAt",
      meetings: "id, meetingPointId, date, status",
      publishers: "id, isActive, updatedAt",
      territoryShares: "id, territoryId, sharedWithId",
      pendingChanges: "++id, table, recordId, status, createdAt",
      syncMeta: "key",
    });
  }
}

// ─── Singleton & Accessors ───────────────────────────────────────

let _db: HubportOfflineDB | null = null;
let _encryptionKey: CryptoKey | null = null;

/**
 * Initialise the offline DB singleton for a given tenant.
 * Stores the encryption key in memory for the session.
 */
export function initOfflineDB(tenantId: string, key: CryptoKey): HubportOfflineDB {
  if (_db) {
    // If already open for a different tenant, close first
    _db.close();
  }
  _db = new HubportOfflineDB(tenantId);
  _encryptionKey = key;
  return _db;
}

/** Returns the singleton DB instance (must call initOfflineDB first). */
export function getOfflineDB(): HubportOfflineDB {
  if (!_db) throw new Error("OfflineDB not initialised — call initOfflineDB first");
  return _db;
}

/** Returns the in-memory encryption key (must call initOfflineDB first). */
export function getEncryptionKey(): CryptoKey {
  if (!_encryptionKey)
    throw new Error("Encryption key not set — call initOfflineDB first");
  return _encryptionKey;
}

// ─── Encryption Middleware ───────────────────────────────────────

/**
 * Encrypt PII fields in a record before storing in IndexedDB.
 *
 * @param tableName - Dexie table name (key in ENCRYPTED_FIELDS)
 * @param obj       - The record to encrypt
 */
export async function encryptForStorage<T extends Record<string, unknown>>(
  tableName: string,
  obj: T,
): Promise<T> {
  const fields = ENCRYPTED_FIELDS[tableName];
  if (!fields || fields.length === 0) return obj;
  const key = getEncryptionKey();
  return encryptFields(key, obj, fields as (keyof T)[]);
}

/**
 * Decrypt PII fields in a record retrieved from IndexedDB.
 *
 * @param tableName - Dexie table name
 * @param obj       - The record to decrypt
 */
export async function decryptFromStorage<T extends Record<string, unknown>>(
  tableName: string,
  obj: T,
): Promise<T> {
  const fields = ENCRYPTED_FIELDS[tableName];
  if (!fields || fields.length === 0) return obj;
  const key = getEncryptionKey();
  const jsonFields = JSON_ENCRYPTED_FIELDS[tableName] as (keyof T)[] | undefined;
  return decryptFields(key, obj, fields as (keyof T)[], jsonFields);
}

// ─── Wipe ────────────────────────────────────────────────────────

/**
 * Completely wipe offline data: close the DB, delete it from IndexedDB, and
 * clear the in-memory encryption key.
 */
export async function wipeOfflineData(): Promise<void> {
  if (_db) {
    const dbName = _db.name;
    _db.close();
    _db = null;
    await Dexie.delete(dbName);
  }
  _encryptionKey = null;
}
