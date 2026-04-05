import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { audit } from "../lib/policy-engine.js";
import { PERMISSIONS } from "../lib/permissions.js";

const IdParams = Type.Object({ id: Type.String({ format: "uuid" }) });
type IdParamsType = Static<typeof IdParams>;

const DEFAULT_GARDEN_DUTIES = [
  { name: "Rasen mähen", type: "rasen" as const, isDefault: true, sortOrder: 1 },
  { name: "Winterdienst", type: "winterdienst" as const, isDefault: true, sortOrder: 2 },
];

export async function facilitiesGroundsRoutes(app: FastifyInstance): Promise<void> {
  // ═══════════════════════════════════════════════════════════════════
  // SEED DEFAULTS
  // ═══════════════════════════════════════════════════════════════════

  app.post(
    "/facilities/grounds/seed",
    { preHandler: requirePermission(PERMISSIONS.MANAGE_FACILITIES_GROUNDS) },
    async () => {
      let groundsSeeded = 0;

      for (const d of DEFAULT_GARDEN_DUTIES) {
        const exists = await prisma.gardenDuty.findFirst({ where: { name: d.name, isDefault: true } });
        if (!exists) {
          await prisma.gardenDuty.create({ data: d });
          groundsSeeded++;
        }
      }

      return { groundsSeeded };
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  // GROUNDS DUTIES (assigned to individual publishers)
  // ═══════════════════════════════════════════════════════════════════

  // List grounds duties with members
  app.get(
    "/facilities/grounds",
    { preHandler: requirePermission(PERMISSIONS.FACILITIES_VIEW) },
    async () => {
      return prisma.gardenDuty.findMany({
        orderBy: { sortOrder: "asc" },
        include: {
          members: {
            include: { publisher: { select: { id: true, firstName: true, lastName: true, displayName: true } } },
          },
        },
      });
    },
  );

  // Create grounds duty
  app.post<{ Body: { name: string; type?: "rasen" | "winterdienst" | "custom" } }>(
    "/facilities/grounds",
    {
      schema: {
        body: Type.Object({
          name: Type.String({ minLength: 1 }),
          type: Type.Optional(Type.Union([
            Type.Literal("rasen"), Type.Literal("winterdienst"), Type.Literal("custom"),
          ])),
        }),
      },
      preHandler: requirePermission(PERMISSIONS.MANAGE_FACILITIES_GROUNDS),
    },
    async (request) => {
      const { name, type } = request.body;
      const duty = await prisma.gardenDuty.create({
        data: { name, type: type ?? "custom" },
      });
      await audit("grounds_duty.create", request.user.sub, "GardenDuty", duty.id, null, duty);
      return duty;
    },
  );

  // Assign publisher to grounds duty
  app.post<{ Params: IdParamsType; Body: { publisherId: string } }>(
    "/facilities/grounds/:id/members",
    {
      schema: { body: Type.Object({ publisherId: Type.String({ format: "uuid" }) }) },
      preHandler: requirePermission(PERMISSIONS.MANAGE_FACILITIES_GROUNDS),
    },
    async (request, reply) => {
      const duty = await prisma.gardenDuty.findUnique({ where: { id: request.params.id } });
      if (!duty) return reply.code(404).send({ error: "Grounds duty not found" });
      await prisma.gardenDutyMember.create({
        data: { dutyId: request.params.id, publisherId: request.body.publisherId },
      });
      await audit("grounds_duty.member_add", request.user.sub, "GardenDutyMember", request.params.id, null, {
        publisherId: request.body.publisherId,
      });
      return { ok: true };
    },
  );

  // Remove publisher from grounds duty
  app.delete<{ Params: { id: string; publisherId: string } }>(
    "/facilities/grounds/:id/members/:publisherId",
    { preHandler: requirePermission(PERMISSIONS.MANAGE_FACILITIES_GROUNDS) },
    async (request, reply) => {
      await prisma.gardenDutyMember.deleteMany({
        where: { dutyId: request.params.id, publisherId: request.params.publisherId },
      });
      await audit("grounds_duty.member_remove", request.user.sub, "GardenDutyMember", request.params.id, {
        publisherId: request.params.publisherId,
      });
      return reply.code(204).send();
    },
  );
}
