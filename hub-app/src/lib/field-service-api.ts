/**
 * Typed API client for field service module endpoints.
 * Wraps fetch() with auth headers and consistent error handling.
 */
import { getApiUrl } from "./config";

// ─── Types ──────────────────────────────────────────────────────

export interface FieldServiceMeetingPoint {
  id: string;
  tenantId: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  dayOfWeek: number;
  time: string;
  conductorId: string | null;
  conductorName?: string | null;
  assistantIds: string[];
  territoryIds: string[];
  maxParticipants: number | null;
  isActive: boolean;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceGroupMeeting {
  id: string;
  tenantId: string;
  meetingPointId: string;
  meetingPoint?: FieldServiceMeetingPoint;
  serviceGroupId: string | null;
  campaignId: string | null;
  date: string;
  time: string;
  conductorId: string;
  conductorName?: string | null;
  status: "planned" | "active" | "completed" | "cancelled";
  notes: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  signupCount?: number;
  signups?: ServiceMeetingSignup[];
  fieldGroups?: ServiceMeetingFieldGroup[];
}

export interface ServiceMeetingSignup {
  id: string;
  tenantId: string;
  meetingId: string;
  publisherId: string;
  publisherName?: string | null;
  signedUpAt: string;
  cancelledAt: string | null;
}

export interface ServiceMeetingFieldGroup {
  id: string;
  tenantId: string;
  meetingId: string;
  name: string | null;
  leaderId: string;
  leaderName?: string | null;
  memberIds: string[];
  territoryIds: string[];
  status: "planned" | "in_field" | "completed";
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  locationShares?: ServiceLocationShare[];
}

export interface ServiceLocationShare {
  id: string;
  tenantId: string;
  fieldGroupId: string;
  publisherId: string;
  publisherName?: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  isActive: boolean;
  startedAt: string;
  lastUpdatedAt: string;
  stoppedAt: string | null;
}

// ─── API Error ──────────────────────────────────────────────────

export class FieldServiceApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "FieldServiceApiError";
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
    throw new FieldServiceApiError(
      (body?.message as string) ?? (body?.error as string) ?? res.statusText,
      res.status,
      body,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── Meeting Point endpoints ────────────────────────────────────

export function listMeetingPoints(token: string): Promise<FieldServiceMeetingPoint[]> {
  return apiFetch("/field-service/meeting-points", token);
}

export function getMeetingPoint(id: string, token: string): Promise<FieldServiceMeetingPoint> {
  return apiFetch(`/field-service/meeting-points/${id}`, token);
}

export function createMeetingPoint(
  data: Partial<FieldServiceMeetingPoint>,
  token: string,
): Promise<FieldServiceMeetingPoint> {
  return apiFetch("/field-service/meeting-points", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateMeetingPoint(
  id: string,
  data: Partial<FieldServiceMeetingPoint>,
  token: string,
): Promise<FieldServiceMeetingPoint> {
  return apiFetch(`/field-service/meeting-points/${id}`, token, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function deleteMeetingPoint(id: string, token: string): Promise<void> {
  return apiFetch(`/field-service/meeting-points/${id}`, token, {
    method: "DELETE",
  });
}

// ─── Service Meeting endpoints ──────────────────────────────────

export function listServiceMeetings(
  token: string,
  params?: { week?: string },
): Promise<ServiceGroupMeeting[]> {
  const qs = new URLSearchParams();
  if (params?.week) qs.set("week", params.week);
  const q = qs.toString();
  return apiFetch(`/field-service/meetings${q ? `?${q}` : ""}`, token);
}

export function getServiceMeeting(id: string, token: string): Promise<ServiceGroupMeeting> {
  return apiFetch(`/field-service/meetings/${id}`, token);
}

export function createServiceMeeting(
  data: {
    meetingPointId: string;
    date: string;
    time: string;
    conductorId: string;
    serviceGroupId?: string;
    notes?: string;
  },
  token: string,
): Promise<ServiceGroupMeeting> {
  return apiFetch("/field-service/meetings", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateServiceMeeting(
  id: string,
  data: Partial<ServiceGroupMeeting>,
  token: string,
): Promise<ServiceGroupMeeting> {
  return apiFetch(`/field-service/meetings/${id}`, token, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function cancelServiceMeeting(id: string, token: string): Promise<void> {
  return apiFetch(`/field-service/meetings/${id}`, token, {
    method: "DELETE",
  });
}

export function signupForMeeting(meetingId: string, token: string): Promise<ServiceMeetingSignup> {
  return apiFetch(`/field-service/meetings/${meetingId}/signup`, token, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function cancelSignup(meetingId: string, token: string): Promise<void> {
  return apiFetch(`/field-service/meetings/${meetingId}/signup`, token, {
    method: "DELETE",
  });
}

export function startMeeting(meetingId: string, token: string): Promise<ServiceGroupMeeting> {
  return apiFetch(`/field-service/meetings/${meetingId}/start`, token, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function completeMeeting(meetingId: string, token: string): Promise<ServiceGroupMeeting> {
  return apiFetch(`/field-service/meetings/${meetingId}/complete`, token, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

// ─── Field Group endpoints ──────────────────────────────────────

export function createFieldGroup(
  meetingId: string,
  data: {
    name?: string;
    leaderId: string;
    memberIds: string[];
    territoryIds: string[];
  },
  token: string,
): Promise<ServiceMeetingFieldGroup> {
  return apiFetch(`/field-service/meetings/${meetingId}/groups`, token, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateFieldGroup(
  groupId: string,
  data: Partial<ServiceMeetingFieldGroup>,
  token: string,
): Promise<ServiceMeetingFieldGroup> {
  return apiFetch(`/field-service/groups/${groupId}`, token, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function startFieldGroup(groupId: string, token: string): Promise<ServiceMeetingFieldGroup> {
  return apiFetch(`/field-service/groups/${groupId}/start`, token, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function completeFieldGroup(groupId: string, token: string): Promise<ServiceMeetingFieldGroup> {
  return apiFetch(`/field-service/groups/${groupId}/complete`, token, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

// ─── Location Sharing endpoints ─────────────────────────────────

export function startLocationShare(
  groupId: string,
  data: { latitude: number; longitude: number; accuracy?: number },
  token: string,
): Promise<ServiceLocationShare> {
  return apiFetch(`/field-service/groups/${groupId}/location/start`, token, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateLocation(
  groupId: string,
  data: { latitude: number; longitude: number; accuracy?: number },
  token: string,
): Promise<ServiceLocationShare> {
  return apiFetch(`/field-service/groups/${groupId}/location/update`, token, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function stopLocationShare(groupId: string, token: string): Promise<void> {
  return apiFetch(`/field-service/groups/${groupId}/location/stop`, token, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getGroupLocations(
  groupId: string,
  token: string,
): Promise<ServiceLocationShare[]> {
  return apiFetch(`/field-service/groups/${groupId}/locations`, token);
}
