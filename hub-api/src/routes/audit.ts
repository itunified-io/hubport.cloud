import type { FastifyInstance } from "fastify";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/audit",
    { preHandler: requirePermission(PERMISSIONS.AUDIT_VIEW) },
    async () => {
      const entries = await prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 200,
      });

      // Resolve actor names: look up publishers by keycloakSub
      const actorIds = [...new Set(entries.map((e) => e.actorId))];
      const actors = await prisma.publisher.findMany({
        where: { keycloakSub: { in: actorIds } },
        select: { keycloakSub: true, firstName: true, lastName: true },
      });
      const actorMap = new Map(
        actors.map((a) => [a.keycloakSub!, `${a.firstName} ${a.lastName}`]),
      );

      return entries.map((e) => ({
        ...e,
        actorName: actorMap.get(e.actorId) ?? null,
      }));
    },
  );
}
