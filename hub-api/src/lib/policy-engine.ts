/**
 * Policy Engine — simplified from old hub (no tenantId, single-tenant).
 *
 * Evaluates permissions from:
 *   1. Keycloak realm roles (base floor)
 *   2. CongregationRole (inheritable base)
 *   3. AppRole assignments (time-bound, with per-assignment deny overrides)
 *
 * Flow: buildContext → can → maskFields → audit
 */

import type { FastifyRequest } from "fastify";
import prisma from "./prisma.js";
import {
  BASE_ROLE_PERMISSIONS,
  CONGREGATION_ROLE_PERMISSIONS,
  PERMISSIONS,
  PAGE_PERMISSIONS,
} from "./permissions.js";

// ─── Types ───────────────────────────────────────────────────────────

export interface PolicyContext {
  userId: string; // Keycloak sub
  publisherId: string | null;
  keycloakRoles: string[];
  congregationRole: string | null;
  appRoles: ActiveAppRole[];
  effectivePermissions: string[];
  denyRules: string[];
  privacyAccepted: boolean;
  scopes?: {
    territoryIds?: string[];
  };
}

interface ActiveAppRole {
  roleId: string;
  name: string;
  permissions: string[];
  scope: string;
  deniedPermissions: string[];
}

export interface PolicyResult {
  allowed: boolean;
  reason: string;
}

// ─── Elder Roles (for privacy visibility floor) ──────────────────────

const ELDER_APP_ROLES = ["Coordinator", "Secretary", "Service Overseer"];

// ─── Build Context ───────────────────────────────────────────────────

/**
 * Build policy context from JWT claims + DB records.
 * Called once per request, cached on request.policyCtx.
 */
export async function buildContext(request: FastifyRequest): Promise<PolicyContext> {
  const user = request.user;
  const keycloakRoles = user?.roles ?? [];
  const sub = user?.sub;

  // Base permissions from Keycloak realm roles
  const basePerms = new Set<string>();
  for (const role of keycloakRoles) {
    const perms = BASE_ROLE_PERMISSIONS[role];
    if (perms) perms.forEach((p) => basePerms.add(p));
  }

  // Find publisher by keycloakSub
  const publisher = sub
    ? await prisma.publisher.findUnique({
        where: { keycloakSub: sub },
        include: { appRoles: { include: { role: true } } },
      })
    : null;

  // Add congregation role base permissions
  if (publisher?.congregationRole) {
    const rolePerms = CONGREGATION_ROLE_PERMISSIONS[publisher.congregationRole];
    if (rolePerms) rolePerms.forEach((p) => basePerms.add(p));
  }

  // Filter app role assignments by temporal validity
  const now = new Date();
  const rawAppRoles = publisher?.appRoles ?? [];
  const activeAppRoles: ActiveAppRole[] = rawAppRoles
    .filter(
      (ar: { validFrom: Date | null; validTo: Date | null }) =>
        (!ar.validFrom || ar.validFrom <= now) &&
        (!ar.validTo || ar.validTo >= now),
    )
    .map((ar: { role: { id: string; name: string; permissions: unknown; scope: string }; deniedPermissions: unknown }) => ({
      roleId: ar.role.id,
      name: ar.role.name,
      permissions: ar.role.permissions as string[],
      scope: ar.role.scope,
      deniedPermissions: (ar.deniedPermissions as string[]) ?? [],
    }));

  // Collect all permissions from app roles
  for (const role of activeAppRoles) {
    for (const p of role.permissions) {
      basePerms.add(p);
    }
  }

  // Collect per-assignment denials
  const assignmentDenials = new Set(
    activeAppRoles.flatMap((r) => r.deniedPermissions),
  );

  // Dynamic permissions from campaign meeting points
  let scopes: { territoryIds?: string[] } | undefined;
  if (publisher?.id) {
    const activeMeetingPoints = await prisma.campaignMeetingPoint.findMany({
      where: {
        campaign: { status: "active" },
        OR: [
          { conductorId: publisher.id },
          { assistantIds: { has: publisher.id } },
        ],
      },
    });

    for (const mp of activeMeetingPoints) {
      const isConductor = mp.conductorId === publisher.id;

      // Both conductors and assistants get:
      basePerms.add(PERMISSIONS.CAMPAIGNS_ASSIST);
      basePerms.add(PERMISSIONS.LOCATION_VIEW);

      // Conductors additionally get:
      if (isConductor) {
        basePerms.add(PERMISSIONS.CAMPAIGNS_CONDUCT);
        basePerms.add(PERMISSIONS.ASSIGNMENTS_MANAGE);
      }
    }

    // Collect territory IDs for scope isolation
    const territoryIds = [...new Set(
      activeMeetingPoints.flatMap((mp) => mp.territoryIds),
    )];
    if (territoryIds.length > 0) {
      scopes = { territoryIds };
    }
  }

  // Split into effective permissions and deny rules
  const allPerms = [...basePerms];
  const effectivePermissions = allPerms.filter(
    (p) => !p.startsWith("deny:") && !assignmentDenials.has(p),
  );
  const denyRules = allPerms.filter((p) => p.startsWith("deny:"));

  return {
    userId: sub ?? "unknown",
    publisherId: publisher?.id ?? null,
    keycloakRoles,
    congregationRole: publisher?.congregationRole ?? null,
    appRoles: activeAppRoles,
    effectivePermissions: [...new Set(effectivePermissions)],
    denyRules: [...new Set(denyRules)],
    privacyAccepted: publisher?.privacyAccepted ?? false,
    ...(scopes ? { scopes } : {}),
  };
}

// ─── Permission Check ────────────────────────────────────────────────

/**
 * Check if action is allowed in the given context.
 */
export function can(
  action: string,
  ctx: PolicyContext,
  resource?: Record<string, unknown>,
): PolicyResult {
  // 1. Self-service: publishers can always access own record
  if (
    action.startsWith("self:") &&
    resource?.publisherId === ctx.publisherId
  ) {
    return { allowed: true, reason: "Self-service" };
  }

  // 2. Wildcard
  if (ctx.effectivePermissions.includes(PERMISSIONS.WILDCARD)) {
    return { allowed: true, reason: "Wildcard grant" };
  }

  // 3. Deny rules
  const denyKey = `deny:${action}`;
  if (ctx.denyRules.includes(denyKey)) {
    return { allowed: false, reason: `Denied by ${denyKey}` };
  }

  // 4. Direct permission match
  if (ctx.effectivePermissions.includes(action)) {
    return { allowed: true, reason: `Granted: ${action}` };
  }

  // 5. Prefix wildcard (e.g. "app:territories.*" matches "app:territories.view")
  const hasWildcard = ctx.effectivePermissions.some(
    (p) => p.endsWith(".*") && action.startsWith(p.slice(0, -1)),
  );
  if (hasWildcard) {
    return { allowed: true, reason: `Wildcard prefix: ${action}` };
  }

  // 6. Scope check for meeting-scoped roles
  if (resource?.meetingType) {
    const scopedRole = ctx.appRoles.find(
      (r) =>
        r.permissions.some(
          (p) =>
            p === action ||
            (p.endsWith(".*") && action.startsWith(p.slice(0, -1))),
        ) &&
        (r.scope === "all" || r.scope === resource.meetingType),
    );
    if (scopedRole) {
      return { allowed: true, reason: `Scoped: ${scopedRole.name}` };
    }
  }

  return { allowed: false, reason: `No grant for ${action}` };
}

// ─── Page Visibility ─────────────────────────────────────────────────

/**
 * Compute which pages the user can see.
 */
export function getPageVisibility(ctx: PolicyContext): Record<string, boolean> {
  const result: Record<string, boolean> = {};

  for (const [path, requiredPerms] of Object.entries(PAGE_PERMISSIONS)) {
    // Any of the listed permissions grants access
    result[path] = requiredPerms.some(
      (p) => can(p, ctx).allowed,
    );
  }

  return result;
}

// ─── Field Masking ───────────────────────────────────────────────────

/**
 * Strip fields based on deny rules + publisher's privacy settings.
 * Elders always see contact/address unless explicit deny.
 */
export function maskFields<T extends Record<string, unknown>>(
  data: T,
  ctx: PolicyContext,
): T {
  // Wildcard sees all
  if (ctx.effectivePermissions.includes(PERMISSIONS.WILDCARD)) return data;

  const masked = { ...data };
  const privacy = (data.privacySettings ?? {}) as Record<string, string>;
  const isElder = ctx.appRoles.some((r) => ELDER_APP_ROLES.includes(r.name));
  const isSelf = data.id === ctx.publisherId;

  // Self always sees own full record
  if (isSelf) return masked;

  // Contact fields
  const canSeeContacts =
    ctx.effectivePermissions.includes(PERMISSIONS.PUBLISHERS_VIEW_CONTACTS) &&
    !ctx.denyRules.includes(PERMISSIONS.DENY_CONTACT);
  const memberAllowsContacts =
    isElder || privacy.contactVisibility === "everyone";
  if (!canSeeContacts || !memberAllowsContacts) {
    delete masked.email;
    delete masked.phone;
  }

  // Address fields
  const canSeeAddress =
    ctx.effectivePermissions.includes(PERMISSIONS.PUBLISHERS_VIEW_CONTACTS) &&
    !ctx.denyRules.includes(PERMISSIONS.DENY_ADDRESS);
  const memberAllowsAddress =
    isElder || privacy.addressVisibility === "everyone";
  if (!canSeeAddress || !memberAllowsAddress) {
    delete masked.address;
  }

  // Notes
  const canSeeNotes = !ctx.denyRules.includes(PERMISSIONS.DENY_NOTES);
  const memberAllowsNotes =
    isElder || privacy.notesVisibility === "everyone";
  if (!canSeeNotes || !memberAllowsNotes) {
    delete masked.notes;
  }

  // Minimal view: strip to basic fields only
  if (
    !ctx.effectivePermissions.includes(PERMISSIONS.PUBLISHERS_VIEW) &&
    ctx.effectivePermissions.includes(PERMISSIONS.PUBLISHERS_VIEW_MINIMAL)
  ) {
    const {
      id, firstName, lastName, displayName,
      congregationRole, congregationFlags, status,
    } = masked as Record<string, unknown>;
    return {
      id, firstName, lastName, displayName,
      congregationRole, congregationFlags, status,
    } as unknown as T;
  }

  // Strip privacySettings from response (only self and admins see it)
  delete masked.privacySettings;

  return masked;
}

// ─── Audit Logging ───────────────────────────────────────────────────

/**
 * Write an audit log entry for a mutation.
 */
export async function audit(
  action: string,
  actorId: string,
  objectType: string,
  objectId?: string,
  beforeState?: unknown,
  afterState?: unknown,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId,
      action,
      objectType,
      objectId: objectId ?? "",
      beforeState: beforeState ? (beforeState as object) : undefined,
      afterState: afterState ? (afterState as object) : undefined,
    },
  });
}
