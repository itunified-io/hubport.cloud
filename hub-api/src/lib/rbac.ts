import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { buildContext, can, type PolicyContext } from "./policy-engine.js";

// ─── Augment FastifyRequest with policyCtx ───────────────────────────

declare module "fastify" {
  interface FastifyRequest {
    policyCtx?: PolicyContext;
  }
}

// ─── Policy Context Decorator ────────────────────────────────────────

/**
 * Register a preHandler that builds the policy context once per request.
 * Cached on `request.policyCtx`.
 */
export function registerPolicyContext(app: FastifyInstance): void {
  app.addHook("onRequest", async (request: FastifyRequest) => {
    // Skip for health checks and public onboarding routes
    if (
      request.url.startsWith("/health") ||
      request.url.startsWith("/onboarding")
    ) {
      return;
    }

    // Only build context if user is authenticated
    if (request.user?.sub) {
      request.policyCtx = await buildContext(request);
    }
  });
}

// ─── Legacy Role Hierarchy ───────────────────────────────────────────

/** Role hierarchy — higher index means more privilege */
const ROLE_HIERARCHY: readonly string[] = ["viewer", "publisher", "elder", "admin"] as const;

function getRoleLevel(role: string): number {
  const idx = ROLE_HIERARCHY.indexOf(role);
  return idx === -1 ? -1 : idx;
}

/**
 * Returns a preHandler that requires the user to have at least the given role.
 * Uses role hierarchy: admin > elder > publisher > viewer.
 * Kept for backward compatibility — prefer requirePermission() for new routes.
 */
export function requireRole(minimumRole: string): preHandlerHookHandler {
  const requiredLevel = getRoleLevel(minimumRole);

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const userRoles = request.user?.roles ?? [];
    const maxUserLevel = Math.max(...userRoles.map(getRoleLevel), -1);

    if (maxUserLevel < requiredLevel) {
      reply.code(403).send({
        error: "Forbidden",
        message: `Requires at least '${minimumRole}' role`,
      });
    }
  };
}

/**
 * Returns a preHandler that requires the user to have at least one of the given roles.
 * No hierarchy check — exact match on any of the listed roles.
 */
export function requireAnyRole(...roles: string[]): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const userRoles = request.user?.roles ?? [];
    const hasRole = roles.some((r) => userRoles.includes(r));

    if (!hasRole) {
      reply.code(403).send({
        error: "Forbidden",
        message: `Requires one of: ${roles.join(", ")}`,
      });
    }
  };
}

// ─── Permission-Based Guards ─────────────────────────────────────────

/**
 * Returns a preHandler that requires the user to have the given permission.
 * Uses the PolicyEngine (buildContext + can).
 */
export function requirePermission(permission: string): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = request.policyCtx;
    if (!ctx) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const result = can(permission, ctx);
    if (!result.allowed) {
      return reply.code(403).send({
        error: "Forbidden",
        message: result.reason,
      });
    }
  };
}

/**
 * Returns a preHandler that requires any of the given permissions.
 */
export function requireAnyPermission(...permissions: string[]): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = request.policyCtx;
    if (!ctx) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const hasAny = permissions.some((p) => can(p, ctx).allowed);
    if (!hasAny) {
      return reply.code(403).send({
        error: "Forbidden",
        message: `Requires one of: ${permissions.join(", ")}`,
      });
    }
  };
}

// ─── Privacy Acceptance Gate ─────────────────────────────────────────

/**
 * Blocks all API calls if the publisher has not accepted privacy terms.
 * Exempted routes: /publishers/me/privacy, /onboarding/*, /health
 */
export function requirePrivacyAccepted(): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip exempted routes
    if (
      request.url.startsWith("/health") ||
      request.url.startsWith("/onboarding") ||
      request.url === "/publishers/me/privacy" ||
      request.url === "/permissions/me"
    ) {
      return;
    }

    const ctx = request.policyCtx;
    if (!ctx) return; // No context = no user = auth middleware handles it

    // Admin always passes (they manage others' privacy)
    if (ctx.effectivePermissions.includes("*")) return;

    if (!ctx.privacyAccepted) {
      return reply.code(403).send({
        error: "Forbidden",
        code: "PRIVACY_NOT_ACCEPTED",
        message: "Privacy terms must be accepted before accessing this resource",
      });
    }
  };
}
