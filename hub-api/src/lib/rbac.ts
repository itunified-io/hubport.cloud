import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { buildContext, can, type PolicyContext } from "./policy-engine.js";
import prisma from "./prisma.js";

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

// ─── Security Setup Enforcement (ADR-0081) ──────────────────────────

/** Routes exempt from the security-complete check. */
const SECURITY_EXEMPT_ROUTES = ["/health", "/onboarding", "/security", "/publishers/me/privacy"];

/**
 * Server-side enforcement: blocks API access unless the user has
 * passwordChanged + (passkey OR TOTP).
 * ADR-0081: backend MUST verify credential setup, not rely on frontend alone.
 */
export function requireSecurityComplete(): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (SECURITY_EXEMPT_ROUTES.some((r) => request.url.startsWith(r))) {
      return;
    }

    const sub = (request.user as { sub?: string } | undefined)?.sub;
    if (!sub) return; // No user = auth middleware handles it

    const setup = await prisma.securitySetup.findUnique({
      where: { keycloakSub: sub },
    });

    if (!setup?.passwordChanged) {
      return reply.code(403).send({
        error: "Forbidden",
        code: "SECURITY_SETUP_INCOMPLETE",
        message: "Password must be changed before accessing this resource",
      });
    }

    const [passkeyCount, hasTOTP] = await Promise.all([
      prisma.webAuthnCredential.count({ where: { keycloakSub: sub } }),
      Promise.resolve(!!setup.totpSecret && !!setup.totpEnabledAt),
    ]);

    if (passkeyCount === 0 && !hasTOTP) {
      return reply.code(403).send({
        error: "Forbidden",
        code: "SECURITY_SETUP_INCOMPLETE",
        message: "At least one second factor (passkey or TOTP) is required",
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
