import type { FastifyInstance } from "fastify";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/audit",
    { preHandler: requirePermission(PERMISSIONS.AUDIT_VIEW) },
    async () => {
      return prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 200,
      });
    },
  );
}
