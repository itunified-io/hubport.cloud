/**
 * Typed API client for territory module endpoints.
 * Wraps fetch() with auth headers and consistent error handling.
 */
import { getApiUrl } from "./config";

// ─── Types ──────────────────────────────────────────────────────

export type AddressType = "residential" | "business" | "apartment_building" | "rural";
export type AddressStatus = "active" | "do_not_call" | "not_at_home" | "moved" | "deceased" | "foreign_language" | "archived";
export type AddressSource = "manual" | "osm" | "csv_import";
export type VisitOutcome = "contacted" | "not_at_home" | "do_not_call" | "moved" | "letter_sent" | "phone_attempted";
export type HeatmapMode = "recency" | "density" | "dnc" | "language" | "gaps" | "status";
export type LocalOsmType = "building_override" | "street" | "poi" | "custom";

/** Minimal GeoJSON types for territory API (no @types/geojson dependency). */
export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

export interface GeoJsonFeature {
  type: "Feature";
  geometry: GeoJsonGeometry;
  properties: Record<string, unknown> | null;
}

export interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

export interface Address {
  addressId: string;
  tenantId: string;
  territoryId: string | null;
  streetAddress: string;
  apartment: string | null;
  city: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  type: AddressType;
  status: AddressStatus;
  languageSpoken: string | null;
  bellCount: number | null;
  doNotCallReason: string | null;
  doNotVisitUntil: string | null;
  lastVisitDate: string | null;
  lastVisitOutcome: VisitOutcome | null;
  notes: string | null;
  osmNodeId: string | null;
  source: AddressSource;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AddressListResponse {
  addresses: Address[];
  meta: { revertedCount: number };
}

export interface AddressVisit {
  visitId: string;
  tenantId: string;
  addressId: string;
  memberId: string | null;
  memberName?: string | null;
  visitDate: string;
  outcome: VisitOutcome;
  notes: string | null;
  createdAt: string;
}

export interface LocalOsmFeature {
  id: string;
  tenantId: string;
  osmId: string | null;
  featureType: LocalOsmType;
  geometry: GeoJsonGeometry;
  properties: Record<string, unknown>;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface OsmRefreshJob {
  id: string;
  tenantId: string;
  territoryId: string;
  status: "queued" | "processing" | "completed" | "failed";
  error: string | null;
  lastRefreshed: string | null;
  buildingsFound: number | null;
  addressesCreated: number | null;
  addressesUpdated: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface GapDetectionRun {
  runId: string;
  tenantId: string;
  status: "pending" | "running" | "completed" | "failed";
  totalBuildings: number | null;
  coveredCount: number | null;
  gapCount: number | null;
  resultGeoJson: GeoJsonFeatureCollection | null;
  startedAt: string;
  completedAt: string | null;
  createdBy: string;
}

export interface IgnoredBuilding {
  id: string;
  tenantId: string;
  osmId: string;
  reason: string;
  evidence: string;
  notes: string | null;
  ignoredBy: string;
  latitude: number | null;
  longitude: number | null;
  streetAddress: string | null;
  buildingType: string | null;
  createdAt: string;
}

export interface HeatmapResponse {
  mode: HeatmapMode;
  territories?: Array<{
    territoryId: string;
    number: string;
    lastWorkedDate?: string | null;
    status?: string;
    daysSinceLastVisit?: number;
    visitCount?: number;
    addressCount?: number;
  }>;
  timeRange?: string;
  type?: "FeatureCollection";
  features?: GeoJsonFeature[];
  runId?: string;
  completedAt?: string | null;
}

export interface ImportKmlResult {
  created: number;
  skipped: number;
  skippedDetails: Array<{ name: string; reason: string }>;
  warnings: Array<{ placemark: string; reason: string }>;
  errors: string[];
}

export interface CsvPreviewResult {
  columns: Record<string, string>;
  preview: Record<string, string>[];
  duplicateCount: number;
  totalRows: number;
}

export interface CsvImportResult {
  created: number;
  skipped: number;
  errors: string[];
}

export interface SnapContext {
  roads: GeoJsonFeatureCollection;
  boundaries: GeoJsonFeatureCollection;
}

// ─── API Error ──────────────────────────────────────────────────

export class TerritoryApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TerritoryApiError";
  }
}

// ─── Fetch helper ───────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${getApiUrl()}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...((init?.headers as Record<string, string>) ?? {}),
  };

  // Only set Content-Type for JSON bodies (not FormData)
  if (init?.body && !(init.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, { ...init, headers });

  if (!res.ok) {
    let body: Record<string, unknown> | undefined;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      // non-JSON error body
    }
    throw new TerritoryApiError(
      (body?.message as string) ?? (body?.error as string) ?? res.statusText,
      res.status,
      body,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── Address endpoints ──────────────────────────────────────────

export function listAddresses(
  territoryId: string,
  token: string,
  params?: { status?: AddressStatus; showArchived?: boolean },
): Promise<AddressListResponse> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.showArchived) qs.set("showArchived", "true");
  const q = qs.toString();
  return apiFetch(`/territories/${territoryId}/addresses${q ? `?${q}` : ""}`, token);
}

export function createAddress(
  territoryId: string,
  data: Partial<Address>,
  token: string,
): Promise<Address> {
  return apiFetch(`/territories/${territoryId}/addresses`, token, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateAddress(
  territoryId: string,
  addressId: string,
  data: Partial<Address>,
  token: string,
): Promise<Address> {
  return apiFetch(`/territories/${territoryId}/addresses/${addressId}`, token, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function deleteAddress(
  territoryId: string,
  addressId: string,
  token: string,
): Promise<void> {
  return apiFetch(`/territories/${territoryId}/addresses/${addressId}`, token, {
    method: "DELETE",
  });
}

// ─── Visit endpoints ────────────────────────────────────────────

export function logVisit(
  territoryId: string,
  addressId: string,
  data: { outcome: VisitOutcome; notes?: string; visitDate?: string },
  token: string,
): Promise<AddressVisit> {
  return apiFetch(
    `/territories/${territoryId}/addresses/${addressId}/visits`,
    token,
    { method: "POST", body: JSON.stringify(data) },
  );
}

export function listVisits(
  territoryId: string,
  addressId: string,
  token: string,
): Promise<AddressVisit[]> {
  return apiFetch(
    `/territories/${territoryId}/addresses/${addressId}/visits`,
    token,
  );
}

// ─── OSM Refresh endpoints ─────────────────────────────────────

export function refreshOsm(
  territoryId: string,
  token: string,
): Promise<OsmRefreshJob> {
  return apiFetch(`/territories/${territoryId}/osm-refresh`, token, {
    method: "POST",
  });
}

export function getOsmQueue(token: string): Promise<OsmRefreshJob[]> {
  return apiFetch("/territories/osm-refresh/queue", token);
}

// ─── Gap Detection endpoints ────────────────────────────────────

export function runGapDetection(token: string): Promise<GapDetectionRun> {
  return apiFetch("/territories/gap-detection/run", token, { method: "POST" });
}

export function getGapRuns(token: string): Promise<GapDetectionRun[]> {
  return apiFetch("/territories/gap-detection/runs", token);
}

export function getGapRun(runId: string, token: string): Promise<GapDetectionRun> {
  return apiFetch(`/territories/gap-detection/runs/${runId}`, token);
}

export function ignoreBuildings(
  data: Array<{
    osmId: string;
    reason: string;
    evidence: string;
    notes?: string;
    latitude?: number;
    longitude?: number;
    streetAddress?: string;
    buildingType?: string;
  }>,
  token: string,
): Promise<{ ignored: number }> {
  return apiFetch("/territories/gap-detection/ignore", token, {
    method: "POST",
    body: JSON.stringify({ buildings: data }),
  });
}

export function unignoreBuilding(osmId: string, token: string): Promise<void> {
  return apiFetch(`/territories/gap-detection/ignore/${osmId}`, token, {
    method: "DELETE",
  });
}

export function listIgnoredBuildings(token: string): Promise<IgnoredBuilding[]> {
  return apiFetch("/territories/gap-detection/ignored", token);
}

// ─── Local OSM Feature endpoints ────────────────────────────────

export function getLocalOsmFeatures(
  token: string,
  params?: { bbox?: string; featureType?: LocalOsmType },
): Promise<LocalOsmFeature[]> {
  const qs = new URLSearchParams();
  if (params?.bbox) qs.set("bbox", params.bbox);
  if (params?.featureType) qs.set("featureType", params.featureType);
  const q = qs.toString();
  return apiFetch(`/territories/local-osm${q ? `?${q}` : ""}`, token);
}

export function createLocalOsmFeature(
  data: {
    featureType: LocalOsmType;
    geometry: GeoJsonGeometry;
    properties: Record<string, unknown>;
    osmId?: string;
  },
  token: string,
): Promise<LocalOsmFeature> {
  return apiFetch("/territories/local-osm", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateLocalOsmFeature(
  id: string,
  data: Partial<{
    geometry: GeoJsonGeometry;
    properties: Record<string, unknown>;
  }>,
  token: string,
): Promise<LocalOsmFeature> {
  return apiFetch(`/territories/local-osm/${id}`, token, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function deleteLocalOsmFeature(id: string, token: string): Promise<void> {
  return apiFetch(`/territories/local-osm/${id}`, token, { method: "DELETE" });
}

// ─── Heatmap endpoint ───────────────────────────────────────────

export function getHeatmap(
  mode: HeatmapMode,
  token: string,
  params?: { timeRange?: string; bbox?: string },
): Promise<HeatmapResponse> {
  const qs = new URLSearchParams({ mode });
  if (params?.timeRange) qs.set("timeRange", params.timeRange);
  if (params?.bbox) qs.set("bbox", params.bbox);
  return apiFetch(`/territories/heatmap?${qs}`, token);
}

// ─── Import endpoints ───────────────────────────────────────────

export function importKml(file: File, token: string): Promise<ImportKmlResult> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch("/territories/import/kml", token, {
    method: "POST",
    body: form,
  });
}

export function previewCsv(file: File, token: string): Promise<CsvPreviewResult> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch("/territories/import/csv/preview", token, {
    method: "POST",
    body: form,
  });
}

export function confirmCsvImport(
  data: {
    columns: Record<string, string>;
    territoryId?: string;
  },
  token: string,
): Promise<CsvImportResult> {
  return apiFetch("/territories/import/csv", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ─── Snap Context ───────────────────────────────────────────────

export function getSnapContext(
  bbox: string,
  token: string,
): Promise<SnapContext> {
  return apiFetch(`/territories/snap-context?bbox=${encodeURIComponent(bbox)}`, token);
}
