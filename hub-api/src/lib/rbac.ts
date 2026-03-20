import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { PolicyEngine, type PolicyContext } from "./policy-engine.js";
import prisma from "./prisma.js";

// --- Module-level engine instance ---

const engine = new PolicyEngine(prisma);

// --- Augment Fastify request type ---

declare module "fastify" {
  interface FastifyRequest {
    policyCtx?: PolicyContext;
  }
}

// --- Legacy role hierarchy (backward compat) ---

const ROLE_HIERARCHY: readonly string[] = ["viewer", "publisher", "elder", "admin"] as const;

function getRoleLevel(role: string): number {
  const idx = ROLE_HIERARCHY.indexOf(role);
  return idx === -1 ? -1 : idx;
}

/**
 * Legacy preHandler — requires user to have at least the given Keycloak role.
 * Kept for backward compatibility during migration.
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
 * Legacy preHandler — requires exact match on any of the listed roles.
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

// --- Permission-based middleware ---

/**
 * Build PolicyContext once per request (lazy, cached on request.policyCtx).
 */
async function ensurePolicyContext(request: FastifyRequest): Promise<PolicyContext> {
  if (!request.policyCtx) {
    request.policyCtx = await engine.buildContext(request);
  }
  return request.policyCtx;
}

/**
 * PreHandler that requires a specific permission key.
 * Uses the PolicyEngine for evaluation (handles wildcards, deny rules, scoping).
 */
export function requirePermission(permission: string): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await ensurePolicyContext(request);
    const result = engine.can(permission, ctx);

    if (!result.allowed) {
      reply.code(403).send({
        error: "Forbidden",
        message: `Missing permission: ${permission}`,
        reason: result.reason,
      });
    }
  };
}

/**
 * PreHandler that requires ANY of the listed permissions.
 */
export function requireAnyPermission(...permissions: string[]): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await ensurePolicyContext(request);
    const hasAny = permissions.some((p) => engine.can(p, ctx).allowed);

    if (!hasAny) {
      reply.code(403).send({
        error: "Forbidden",
        message: `Missing permissions: ${permissions.join(" | ")}`,
      });
    }
  };
}

/**
 * PreHandler that blocks access if privacy is not accepted.
 * Exempts onboarding and self-service privacy endpoints.
 */
export function requirePrivacyAccepted(): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Exempt paths that must work before privacy acceptance
    const exemptPaths = ["/health", "/onboarding", "/publishers/me/privacy", "/permissions/me"];
    if (exemptPaths.some((p) => request.url.startsWith(p))) return;

    const ctx = await ensurePolicyContext(request);

    // No publisher linked = admin/dev user, skip check
    if (!ctx.publisherId) return;

    if (!ctx.privacyAccepted) {
      reply.code(403).send({
        error: "Forbidden",
        code: "PRIVACY_NOT_ACCEPTED",
        message: "Privacy acceptance required before accessing this resource",
      });
    }
  };
}

/**
 * Get the PolicyEngine instance (for use in routes).
 */
export function getPolicyEngine(): PolicyEngine {
  return engine;
}

/**
 * Get or build the PolicyContext for a request.
 */
export async function getPolicyContext(request: FastifyRequest): Promise<PolicyContext> {
  return ensurePolicyContext(request);
}

/**
 * Register the policy context builder as a Fastify decorator.
 * Call this in your app setup to make policyCtx available on every request.
 */
export async function registerPolicyContext(app: FastifyInstance): Promise<void> {
  app.decorateRequest("policyCtx", undefined);

  app.addHook("onRequest", async (request) => {
    // Skip auth-free routes
    if (request.url.startsWith("/health")) return;
    if (request.url.startsWith("/onboarding")) return;

    // Build policy context (requires user to be set by auth hook first)
    if (request.user?.sub) {
      request.policyCtx = await engine.buildContext(request);
    }
  });
}
