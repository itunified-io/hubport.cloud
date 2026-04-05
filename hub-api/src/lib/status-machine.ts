import type { MaintenanceStatus } from "@prisma/client";

const TRANSITIONS: Record<MaintenanceStatus, MaintenanceStatus[]> = {
  reported: ["under_review", "rejected"],
  under_review: ["approved", "forwarded_to_ldc", "rejected"],
  approved: ["in_progress", "forwarded_to_ldc"],
  forwarded_to_ldc: ["in_progress", "resolved"],
  in_progress: ["resolved"],
  resolved: ["closed", "in_progress"],
  closed: [],
  rejected: [],
};

export function isValidTransition(
  from: MaintenanceStatus,
  to: MaintenanceStatus,
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function getValidTransitions(
  status: MaintenanceStatus,
): MaintenanceStatus[] {
  return TRANSITIONS[status] ?? [];
}
