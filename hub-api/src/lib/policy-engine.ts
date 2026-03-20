/**
 * Policy Engine — permission evaluation, field masking, audit logging.
 *
 * Single-tenant (no tenantId scoping). Simplified from old hub PolicyEngine.
 */

import type { PrismaClient } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { KEYCLOAK_BASE_PERMISSIONS, PAGE_PERMISSIONS } from "./permissions.js";

// --- Types ---

export interface PolicyContext {
  userId: string;           // Keycloak sub
  publisherId: string | null;  // Publisher ID (null if no publisher record linked)
  keycloakRole: string;     // highest priority Keycloak realm role
  appRoles: AppRoleContext[];
  effectivePermissions: string[];
  denyRules: string[];
  privacyAccepted: boolean;
}

export interface AppRoleContext {
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

// --- Constants ---

const ROLE_PRIORITY = ["admin", "elder", "publisher", "viewer"] as const;

const ELDER_ROLE_NAMES = ["Coordinator", "Secretary", "Service Overseer"];

// --- Engine ---

export class PolicyEngine {
  constructor(private prisma: PrismaClient) {}

  /**
   * Build permission context from JWT + DB app roles.
   * Called once per request, cached on request.policyCtx.
   */
  async buildContext(request: FastifyRequest): Promise<PolicyContext> {
    const user = request.user;
    const jwtRoles = user?.roles ?? [];
    const keycloakRole = ROLE_PRIORITY.find((r) => jwtRoles.includes(r)) ?? "viewer";
    const basePerms = KEYCLOAK_BASE_PERMISSIONS[keycloakRole] ?? [];

    // Find publisher by keycloakSub
    let publisher: {
      id: string;
      privacyAccepted: boolean;
      appRoles: Array<{
        validFrom: Date | null;
        validTo: Date | null;
        deniedPermissions: unknown;
        role: { id: string; name: string; permissions: unknown; scope: string };
      }>;
    } | null = null;

    if (user?.sub) {
      publisher = await this.prisma.publisher.findUnique({
        where: { keycloakSub: user.sub },
        select: {
          id: true,
          privacyAccepted: true,
          appRoles: {
            include: { role: true },
          },
        },
      });
    }

    // Filter app roles by temporal validity
    const now = new Date();
    const activeAppRoles: AppRoleContext[] = (publisher?.appRoles ?? [])
      .filter(
        (ar) =>
          (!ar.validFrom || ar.validFrom <= now) &&
          (!ar.validTo || ar.validTo >= now),
      )
      .map((ar) => ({
        roleId: ar.role.id,
        name: ar.role.name,
        permissions: ar.role.permissions as string[],
        scope: ar.role.scope,
        deniedPermissions: (ar.deniedPermissions ?? []) as string[],
      }));

    // Collect per-assignment denials and subtract from effective permissions
    const assignmentDenials = new Set(
      activeAppRoles.flatMap((r) => r.deniedPermissions),
    );
    const allPerms = [...basePerms, ...activeAppRoles.flatMap((r) => r.permissions)];
    const filteredPerms = allPerms.filter((p) => !assignmentDenials.has(p));

    return {
      userId: user?.sub ?? "unknown",
      publisherId: publisher?.id ?? null,
      keycloakRole,
      appRoles: activeAppRoles,
      effectivePermissions: [
        ...new Set(filteredPerms.filter((p) => !p.startsWith("deny:"))),
      ],
      denyRules: [
        ...new Set(allPerms.filter((p) => p.startsWith("deny:"))),
      ],
      privacyAccepted: publisher?.privacyAccepted ?? false,
    };
  }

  /**
   * Check if action is allowed.
   *
   * Evaluation order:
   * 1. Self-service (own record)
   * 2. Wildcard (admin)
   * 3. Deny rules
   * 4. Permission key match (exact or prefix wildcard)
   * 5. Scope check for meeting-type actions
   */
  can(
    action: string,
    ctx: PolicyContext,
    resource?: { publisherId?: string; meetingType?: string },
  ): PolicyResult {
    // 1. Self-service: publishers can always view/edit own record
    if (resource?.publisherId === ctx.publisherId && ctx.publisherId) {
      return { allowed: true, reason: "Self-service" };
    }

    // 2. Wildcard (admin/coordinator)
    if (ctx.effectivePermissions.includes("*")) {
      return { allowed: true, reason: "Wildcard grant" };
    }

    // 3. Deny rules
    const denyKey = `deny:${action.replace("app:", "")}`;
    if (ctx.denyRules.includes(denyKey)) {
      return { allowed: false, reason: `Denied by ${denyKey}` };
    }

    // 4. Permission key match (exact or prefix wildcard like "app:meetings.*")
    const hasPermission = ctx.effectivePermissions.some(
      (p) =>
        p === action || (p.endsWith(".*") && action.startsWith(p.slice(0, -1))),
    );
    if (hasPermission) {
      return { allowed: true, reason: `Granted by ${action}` };
    }

    // 5. Scope check for scoped app roles
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
        return { allowed: true, reason: `Scoped grant via ${scopedRole.name}` };
      }
    }

    return { allowed: false, reason: `No grant for ${action}` };
  }

  /**
   * Compute which pages the user can see.
   */
  pageVisibility(ctx: PolicyContext): Record<string, boolean> {
    const visibility: Record<string, boolean> = {};

    for (const [path, requiredPerms] of Object.entries(PAGE_PERMISSIONS)) {
      visibility[path] = requiredPerms.some(
        (perm) => this.can(perm, ctx).allowed,
      );
    }

    return visibility;
  }

  /**
   * Strip fields based on deny rules + publisher's privacy settings.
   *
   * Elders always see contact/address unless explicit deny is present.
   * Non-elders use effective_visibility = min(role_grant, member_privacy).
   */
  maskFields<T extends Record<string, unknown>>(
    data: T,
    ctx: PolicyContext,
  ): T {
    // Owner sees all
    if (ctx.effectivePermissions.includes("*")) return data;

    const masked = { ...data };
    const privacy = (data.privacySettings ?? {}) as Record<string, string>;
    const isElder = ctx.appRoles.some((r) => ELDER_ROLE_NAMES.includes(r.name));
    const isSelf = data.id === ctx.publisherId;

    // Self always sees own full record
    if (isSelf) return masked;

    // Contact fields
    const canSeeContacts =
      ctx.effectivePermissions.includes("app:publishers.view_contacts") &&
      !ctx.denyRules.includes("deny:publishers.contact");
    const memberAllowsContacts =
      isElder || privacy.contactVisibility === "everyone";
    if (!canSeeContacts || !memberAllowsContacts) {
      delete masked.email;
      delete masked.phone;
    }

    // Address fields
    const canSeeAddress =
      ctx.effectivePermissions.includes("app:publishers.view_contacts") &&
      !ctx.denyRules.includes("deny:publishers.address");
    const memberAllowsAddress =
      isElder || privacy.addressVisibility === "everyone";
    if (!canSeeAddress || !memberAllowsAddress) {
      delete masked.address;
    }

    // Notes
    const canSeeNotes = !ctx.denyRules.includes("deny:publishers.notes");
    const memberAllowsNotes =
      isElder || privacy.notesVisibility === "everyone";
    if (!canSeeNotes || !memberAllowsNotes) {
      delete masked.notes;
    }

    // Minimal view: strip to basic fields only
    if (
      !ctx.effectivePermissions.includes("app:publishers.view") &&
      ctx.effectivePermissions.includes("app:publishers.view_minimal")
    ) {
      const {
        id,
        firstName,
        lastName,
        displayName,
        congregationRole,
        congregationFlags,
        status,
        keycloakSub,
      } = masked as Record<string, unknown>;
      return {
        id,
        firstName,
        lastName,
        displayName,
        congregationRole,
        congregationFlags,
        status,
        hasAccount: !!keycloakSub,
      } as unknown as T;
    }

    // Strip privacySettings from non-self responses
    delete masked.privacySettings;

    // Add hasAccount indicator
    (masked as Record<string, unknown>).hasAccount = !!(masked as Record<string, unknown>).keycloakSub;

    return masked;
  }

  /**
   * Write an audit log entry.
   */
  async audit(
    actorId: string,
    action: string,
    objectType: string,
    objectId: string,
    beforeState?: unknown,
    afterState?: unknown,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action,
        objectType,
        objectId,
        beforeState: beforeState ? (beforeState as object) : undefined,
        afterState: afterState ? (afterState as object) : undefined,
      },
    });
  }
}
