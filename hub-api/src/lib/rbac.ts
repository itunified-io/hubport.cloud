import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { buildContext, can, type PolicyContext } from "./policy-engine.js";
import { getKeycloakUser } from "./keycloak-admin.js";

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

// ─── Security Setup Enforcement (ADR-0081 + ADR-0086) ───────────────

/** Routes exempt from the security-complete check. */
const SECURITY_EXEMPT_ROUTES = ["/health", "/onboarding", "/security", "/publishers/me/privacy", "/internal"];

/** Cache: keycloakSub → { complete: boolean, cachedAt: number } */
const securityStatusCache = new Map<string, { complete: boolean; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Invalidate the security status cache for a user.
 * Called from /security/* mutation endpoints.
 */
export function invalidateSecurityCache(userId: string): void {
  securityStatusCache.delete(userId);
}

/**
 * Server-side enforcement: blocks API access unless the user has
 * completed all required actions in Keycloak (empty requiredActions array).
 * ADR-0081: backend MUST verify credential setup, not rely on frontend alone.
 * ADR-0086: Keycloak is the sole credential authority — no local DB checks.
 *
 * Fail-closed: if Keycloak is unreachable, returns 403 SECURITY_VERIFICATION_UNAVAILABLE.
 */
export function requireSecurityComplete(): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (SECURITY_EXEMPT_ROUTES.some((r) => request.url.startsWith(r))) {
      return;
    }

    const sub = (request.user as { sub?: string } | undefined)?.sub;
    if (!sub) return; // No user = auth middleware handles it

    // Check cache first
    const cached = securityStatusCache.get(sub);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      if (!cached.complete) {
        return reply.code(403).send({
          error: "Forbidden",
          code: "SECURITY_SETUP_INCOMPLETE",
          message: "Security setup must be completed before accessing this resource",
        });
      }
      return; // Cache hit: setup complete
    }

    // Query Keycloak for user requiredActions
    try {
      const user = await getKeycloakUser(sub);
      const complete = user.requiredActions.length === 0;

      // Update cache
      securityStatusCache.set(sub, { complete, cachedAt: Date.now() });

      if (!complete) {
        return reply.code(403).send({
          error: "Forbidden",
          code: "SECURITY_SETUP_INCOMPLETE",
          message: "Security setup must be completed before accessing this resource",
        });
      }
    } catch {
      // Fail-closed: Keycloak unreachable → deny access (ADR-0081)
      return reply.code(403).send({
        error: "Forbidden",
        code: "SECURITY_VERIFICATION_UNAVAILABLE",
        message: "Unable to verify security setup status. Please try again later.",
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
      request.url.startsWith("/security") ||
      request.url.startsWith("/internal") ||
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
