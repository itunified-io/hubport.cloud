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
  id: string;
  territoryId: string;
  status: "running" | "completed" | "failed";
  totalBuildings: number | null;
  coveredCount: number | null;
  gapCount: number | null;
  resultGeoJson: GeoJsonFeatureCollection | null;
  startedAt: string;
  completedAt: string | null;
  runBy: string;
  createdAt: string;
  territory?: { id: string; number: string; name: string };
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

// ─── Territory list endpoint ────────────────────────────────────

export interface TerritoryListItem {
  id: string;
  number: string;
  name: string;
  description: string | null;
  type?: string; // "territory" | "congregation_boundary"
  boundaries: unknown | null;
  createdAt: string;
  updatedAt: string;
  assignments: Array<{
    id: string;
    publisherId: string;
    assignedAt: string;
    returnedAt: string | null;
    publisher: { id: string; firstName: string; lastName: string };
  }>;
}

export function listTerritories(token: string, opts?: { lite?: boolean; type?: string }): Promise<TerritoryListItem[]> {
  const params = new URLSearchParams();
  if (opts?.lite) params.set("lite", "true");
  if (opts?.type) params.set("type", opts.type);
  const q = params.toString();
  return apiFetch(`/territories${q ? `?${q}` : ""}`, token);
}

export function getTerritory(id: string, token: string): Promise<TerritoryListItem> {
  return apiFetch(`/territories/${id}`, token);
}

// ─── PDF Export ─────────────────────────────────────────────────────

export async function exportPdf(
  territoryIds: string[],
  token: string,
  styles?: ("satellite" | "street")[],
): Promise<Blob> {
  const res = await fetch(`${getApiUrl()}/territories/export/pdf`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ territoryIds, ...(styles?.length ? { styles } : {}) }),
  });
  if (!res.ok) throw new Error(`PDF export failed: ${res.status}`);
  return res.blob();
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

// ─── OSM Populate ──────────────────────────────────────────────

export interface OsmPopulateResult {
  totalBuildings: number;
  addressableBuildings: number;
  territoriesProcessed: number;
  addressesCreated: number;
  addressesUpdated: number;
  unassigned: number;
}

export function populateAddressesFromOsm(token: string): Promise<OsmPopulateResult> {
  return apiFetch("/territories/osm-populate", token, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function runGapDetection(token: string): Promise<GapDetectionRun> {
  return apiFetch("/territories/gap-detection/run", token, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getGapRuns(token: string): Promise<GapDetectionRun[]> {
  return apiFetch("/territories/gap-detection/runs", token);
}

export function deleteGapRun(runId: string, token: string): Promise<void> {
  return apiFetch(`/territories/gap-detection/runs/${runId}`, token, {
    method: "DELETE",
  });
}

export function ignoreBuildings(
  data: Array<{
    territoryId: string;
    osmId: string;
    reason: string;
    notes?: string;
    lat?: number;
    lng?: number;
    streetAddress?: string;
    buildingType?: string;
  }>,
  token: string,
): Promise<{ created: string[]; skipped: string[] }> {
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

export async function importKml(file: File, token: string): Promise<ImportKmlResult> {
  const kml = await file.text();
  return apiFetch("/territories/import/kml", token, {
    method: "POST",
    body: JSON.stringify({ kml, name: file.name.replace(/\.kml$/i, "") }),
  });
}

export interface ImportBranchKmlResult {
  updated: number;
  created: number;
  skipped: number;
  warnings: string[];
}

export async function importBranchKml(file: File, token: string): Promise<ImportBranchKmlResult> {
  const kml = await file.text();
  return apiFetch("/territories/import/kml/branch", token, {
    method: "POST",
    body: JSON.stringify({ kml }),
  });
}

export async function previewCsv(file: File, token: string): Promise<CsvPreviewResult> {
  const csv = await file.text();
  return apiFetch("/territories/import/csv/preview", token, {
    method: "POST",
    body: JSON.stringify({ csv }),
  });
}

export function confirmCsvImport(
  data: {
    csv: string;
    columns: Record<string, string>;
  },
  token: string,
): Promise<CsvImportResult> {
  return apiFetch("/territories/import/csv/confirm", token, {
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

// ─── Auto-Fix / Violations / Versions ──────────────────────────

export interface OverlapInfo {
  territoryId: string;
  number: string;
  name: string;
  overlapAreaM2: number;
}

export interface AutoFixResult {
  original: unknown;
  clipped: unknown;
  applied: string[];
  overlaps: OverlapInfo[];
  geometryModified: boolean;
}

export interface BoundaryVersion {
  id: string;
  version: number;
  changeType: string;
  changeSummary: string | null;
  createdAt: string;
}

export interface TerritoryViolation {
  territoryId: string;
  number: string;
  name: string;
  violations: string[];
}

export function createTerritory(
  token: string,
  data: { number: string; name: string; boundaries?: unknown },
): Promise<TerritoryListItem> {
  return apiFetch("/territories", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export interface TerritorySuggestion {
  city: string | null;
  suggestedPrefix: string;
  suggestedNumber: string;
  existingInGroup: string[];
  autoFix: AutoFixResult | null;
}

export function suggestTerritory(
  token: string,
  boundaries: unknown,
): Promise<TerritorySuggestion> {
  return apiFetch("/territories/suggest", token, {
    method: "POST",
    body: JSON.stringify({ boundaries }),
  });
}

export function updateTerritoryBoundaries(
  token: string,
  territoryId: string,
  boundaries: unknown,
): Promise<TerritoryListItem & { autoFix?: AutoFixResult }> {
  return apiFetch(`/territories/${territoryId}`, token, {
    method: "PUT",
    body: JSON.stringify({ boundaries }),
  });
}

export function previewFix(
  token: string,
  territoryId: string | null,
  boundaries: unknown,
): Promise<AutoFixResult> {
  const path = territoryId
    ? `/territories/${territoryId}/preview-fix`
    : "/territories/preview-fix";
  return apiFetch(path, token, {
    method: "POST",
    body: JSON.stringify({ boundaries }),
  });
}

export function getViolations(token: string): Promise<TerritoryViolation[]> {
  return apiFetch("/territories/violations", token);
}

export function deleteBoundary(
  token: string,
  territoryId: string,
): Promise<TerritoryListItem> {
  return apiFetch(`/territories/${territoryId}/boundaries`, token, {
    method: "DELETE",
  });
}

export interface BulkFixResult {
  fixed: number;
  failed: Array<{ id: string; number: string; error: string }>;
}

export function bulkFixViolations(
  token: string,
  territoryIds: string[],
): Promise<BulkFixResult> {
  return apiFetch("/territories/fix/bulk", token, {
    method: "POST",
    body: JSON.stringify({ territoryIds }),
  });
}

export function getVersions(token: string, territoryId: string): Promise<BoundaryVersion[]> {
  return apiFetch(`/territories/${territoryId}/versions`, token);
}

export function restoreVersion(
  token: string,
  territoryId: string,
  versionId: string,
): Promise<AutoFixResult> {
  return apiFetch(`/territories/${territoryId}/restore`, token, {
    method: "POST",
    body: JSON.stringify({ versionId }),
  });
}

// ─── Field Work / Location Sharing API ─────────────────────────────

export interface LocationShareData {
  id: string;
  fieldGroupId: string;
  publisherId: string;
  lastLatitude: number | null;
  lastLongitude: number | null;
  heading: number | null;
  accuracy: number | null;
  isActive: boolean;
  expiresAt: string;
  publisher?: { id: string; firstName: string; lastName: string };
  fieldGroup?: {
    id: string;
    name: string | null;
    status: string;
    territoryIds: string[];
  };
}

export function updateLocationShare(
  fieldGroupId: string,
  data: {
    publisherId: string;
    latitude: number;
    longitude: number;
    heading?: number | null;
    accuracy?: number | null;
  },
  token: string,
): Promise<LocationShareData> {
  return apiFetch(`/field-groups/${fieldGroupId}/location-share/update`, token, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function getActiveLocations(token: string): Promise<LocationShareData[]> {
  return apiFetch("/field-groups/active-locations", token);
}

export function generateJoinCode(
  fieldGroupId: string,
  token: string,
): Promise<{ joinCode: string }> {
  return apiFetch(`/field-groups/${fieldGroupId}/generate-code`, token, {
    method: "POST",
  });
}

export function joinFieldGroupByCode(
  code: string,
  publisherId: string,
  token: string,
): Promise<unknown> {
  return apiFetch("/field-groups/join", token, {
    method: "POST",
    body: JSON.stringify({ code, publisherId }),
  });
}

// ─── Gap Resolution ──────────────────────────────────────────────────

export interface GapNeighborAssignment {
  territoryId: string;
  territoryNumber: string;
  territoryName: string;
  buildingCount: number;
  buildingCoords: [number, number][];
}

export interface GapAnalysisItem {
  gapId: string;
  gapPolygon: GeoJsonGeometry;
  areaMeter2: number;
  residentialCount: number;
  totalBuildingCount: number;
  unreviewedCount: number;
  recommendation: "new_territory" | "expand_neighbors";
  neighborAssignments: GapNeighborAssignment[];
}

export interface GapAnalysisResponse {
  gaps: GapAnalysisItem[];
  thresholds: { minResidentialBuildings: number; minAreaM2: number };
}

export async function fetchGapAnalysis(
  token: string,
  minResidentialBuildings = 8,
  minAreaM2 = 5000,
): Promise<GapAnalysisResponse> {
  const params = new URLSearchParams({
    minResidentialBuildings: String(minResidentialBuildings),
    minAreaM2: String(minAreaM2),
  });
  return apiFetch(`/territories/gap-analysis?${params}`, token);
}

export interface GapResolveNewTerritoryRequest {
  gapPolygon: GeoJsonGeometry;
  action: "new_territory";
  newTerritoryName: string;
  newTerritoryNumber: string;
}

export interface GapResolveExpandRequest {
  gapPolygon: GeoJsonGeometry;
  action: "expand_neighbors";
  neighborAssignments: Array<{
    territoryId: string;
    buildingCoords: [number, number][];
  }>;
}

export type GapResolveRequest = GapResolveNewTerritoryRequest | GapResolveExpandRequest;

export interface GapResolveResponse {
  success: boolean;
  action: string;
  territoryId?: string;
  number?: string;
  name?: string;
  autoFixApplied?: string[];
  expanded?: Array<{
    territoryId: string;
    number: string;
    autoFixApplied: string[];
  }>;
}

export async function resolveGap(
  token: string,
  body: GapResolveRequest,
): Promise<GapResolveResponse> {
  return apiFetch("/territories/gap-resolve", token, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ─── Building Override (Triage Workflow) ────────────────────────────

export type TriageStatus = "unreviewed" | "confirmed_residential" | "ignored" | "needs_visit";

export interface BuildingOverride {
  id: string;
  osmId: string;
  overriddenType: string | null;
  overriddenAddress: string | null;
  triageStatus: TriageStatus;
  notes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BuildingOverridesResponse {
  overrides: BuildingOverride[];
  total: number;
}

export interface OverrideInput {
  overriddenType?: string;
  overriddenAddress?: string;
  triageStatus?: TriageStatus;
  notes?: string;
}

export interface BatchOverrideInput {
  osmId: string;
  overriddenType?: string;
  overriddenAddress?: string;
  triageStatus?: TriageStatus;
  notes?: string;
}

export function fetchBuildingOverrides(
  token: string,
  options?: { triageStatus?: TriageStatus; limit?: number; offset?: number },
): Promise<BuildingOverridesResponse> {
  const params = new URLSearchParams();
  if (options?.triageStatus) params.set("triageStatus", options.triageStatus);
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.offset) params.set("offset", String(options.offset));
  const qs = params.toString();
  return apiFetch(`/territories/gap-detection/overrides${qs ? `?${qs}` : ""}`, token);
}

export function upsertBuildingOverride(
  token: string,
  osmId: string,
  data: OverrideInput,
): Promise<BuildingOverride> {
  return apiFetch(`/territories/gap-detection/overrides/${encodeURIComponent(osmId)}`, token, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function batchOverrides(
  token: string,
  overrides: BatchOverrideInput[],
): Promise<{ updated: number }> {
  return apiFetch("/territories/gap-detection/overrides/batch", token, {
    method: "POST",
    body: JSON.stringify({ overrides }),
  });
}

export function deleteBuildingOverride(
  token: string,
  osmId: string,
): Promise<void> {
  return apiFetch(`/territories/gap-detection/overrides/${encodeURIComponent(osmId)}`, token, {
    method: "DELETE",
  });
}
