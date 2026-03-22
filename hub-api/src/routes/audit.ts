import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";

const AuditQuery = Type.Object({
  days: Type.Optional(Type.Number({ minimum: 1, maximum: 365 })),
  publisherId: Type.Optional(Type.String()),
  search: Type.Optional(Type.String()),
});

type AuditQueryType = Static<typeof AuditQuery>;

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: AuditQueryType }>(
    "/audit",
    {
      preHandler: requirePermission(PERMISSIONS.AUDIT_VIEW),
      schema: { querystring: AuditQuery },
    },
    async (request) => {
      const { days, publisherId, search } = request.query;

      // Build where clause
      const where: Record<string, unknown> = {};

      if (days) {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        where.createdAt = { gte: since };
      }

      if (publisherId) {
        where.objectId = publisherId;
      }

      if (search) {
        where.action = { contains: search, mode: "insensitive" };
      }

      const entries = await prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 200,
      });

      // Resolve actor names
      const actorIds = [...new Set(entries.map((e) => e.actorId))];
      const actors = await prisma.publisher.findMany({
        where: { keycloakSub: { in: actorIds } },
        select: { keycloakSub: true, firstName: true, lastName: true },
      });
      const actorMap = new Map(
        actors.map((a) => [a.keycloakSub!, `${a.firstName} ${a.lastName}`]),
      );

      // Resolve object names (Publisher targets)
      const objectIds = [...new Set(
        entries
          .filter((e) => e.objectId && e.objectType === "Publisher")
          .map((e) => e.objectId!),
      )];
      const objects = objectIds.length > 0
        ? await prisma.publisher.findMany({
            where: { id: { in: objectIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [];
      const objectMap = new Map(
        objects.map((o) => [o.id, `${o.firstName} ${o.lastName}`]),
      );

      return entries.map((e) => ({
        ...e,
        actorName: actorMap.get(e.actorId) ?? null,
        objectName: (e.objectId && objectMap.get(e.objectId)) ?? null,
      }));
    },
  );

  // Publisher list for audit filter dropdown
  app.get(
    "/audit/publishers",
    { preHandler: requirePermission(PERMISSIONS.AUDIT_VIEW) },
    async () => {
      return prisma.publisher.findMany({
        select: { id: true, firstName: true, lastName: true },
        orderBy: { lastName: "asc" },
      });
    },
  );
}
