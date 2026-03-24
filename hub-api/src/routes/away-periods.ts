/**
 * Away period routes — publisher availability management.
 * Publishers manage their own away periods; elders/admins can view any.
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { audit } from "../lib/policy-engine.js";
import prisma from "../lib/prisma.js";

const PublisherIdParams = Type.Object({ publisherId: Type.String({ format: "uuid" }) });
const IdParams = Type.Object({ id: Type.String({ format: "uuid" }) });

const AwayPeriodBody = Type.Object({
  startDate: Type.String({ format: "date" }),
  endDate: Type.String({ format: "date" }),
  reason: Type.Optional(Type.String({ maxLength: 200 })),
});

type PubIdType = Static<typeof PublisherIdParams>;
type IdType = Static<typeof IdParams>;
type BodyType = Static<typeof AwayPeriodBody>;

// Prisma encryption extension handles encrypt/decrypt automatically for /// @encrypted fields

export async function awayPeriodRoutes(app: FastifyInstance): Promise<void> {
  // GET /publishers/:publisherId/away-periods
  app.get<{ Params: PubIdType }>(
    "/publishers/:publisherId/away-periods",
    {
      preHandler: requirePermission(PERMISSIONS.AWAY_PERIODS_VIEW),
      schema: { params: PublisherIdParams },
    },
    async (request) => {
      const periods = await prisma.awayPeriod.findMany({
        where: { publisherId: request.params.publisherId },
        orderBy: { startDate: "asc" },
      });
      return periods;
    },
  );

  // POST /publishers/:publisherId/away-periods
  app.post<{ Params: PubIdType; Body: BodyType }>(
    "/publishers/:publisherId/away-periods",
    {
      preHandler: requirePermission(PERMISSIONS.AWAY_PERIODS_EDIT),
      schema: { params: PublisherIdParams, body: AwayPeriodBody },
    },
    async (request, reply) => {
      const { publisherId } = request.params;
      const { startDate, endDate, reason } = request.body;
      const actorId = (request as any).publisherId ?? (request as any).userId;

      const start = new Date(startDate);
      const end = new Date(endDate);
      if (end < start) {
        return reply.code(400).send({ error: "End date must be after start date" });
      }

      const period = await prisma.awayPeriod.create({
        data: {
          publisherId,
          startDate: start,
          endDate: end,
          reason: reason || null,
        },
      });

      await audit(actorId, "away_period.create", period.id, `${startDate} to ${endDate}`);
      return reply.code(201).send(period);
    },
  );

  // DELETE /away-periods/:id
  app.delete<{ Params: IdType }>(
    "/away-periods/:id",
    {
      preHandler: requirePermission(PERMISSIONS.AWAY_PERIODS_EDIT),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const { id } = request.params;
      const actorId = (request as any).publisherId ?? (request as any).userId;

      const period = await prisma.awayPeriod.findUnique({ where: { id } });
      if (!period) return reply.code(404).send({ error: "Away period not found" });

      await prisma.awayPeriod.delete({ where: { id } });
      await audit(actorId, "away_period.delete", id);
      return reply.code(204).send();
    },
  );
}
