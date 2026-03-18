import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";

/** Role hierarchy — higher index means more privilege */
const ROLE_HIERARCHY: readonly string[] = ["viewer", "publisher", "elder", "admin"] as const;

function getRoleLevel(role: string): number {
  const idx = ROLE_HIERARCHY.indexOf(role);
  return idx === -1 ? -1 : idx;
}

/**
 * Returns a preHandler that requires the user to have at least the given role.
 * Uses role hierarchy: admin > elder > publisher > viewer.
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
