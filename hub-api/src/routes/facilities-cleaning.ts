import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { audit } from "../lib/policy-engine.js";
import { PERMISSIONS } from "../lib/permissions.js";

const IdParams = Type.Object({ id: Type.String({ format: "uuid" }) });
type IdParamsType = Static<typeof IdParams>;

const DEFAULT_CLEANING_DUTIES = [
  { name: "Grundreinigung", category: "grundreinigung" as const, isDefault: true, sortOrder: 1 },
  { name: "Sichtreinigung", category: "sichtreinigung" as const, isDefault: true, sortOrder: 2 },
  { name: "Monatsreinigung", category: "monatsreinigung" as const, isDefault: true, sortOrder: 3 },
];

export async function facilitiesCleaningRoutes(app: FastifyInstance): Promise<void> {
  // ═══════════════════════════════════════════════════════════════════
  // SEED DEFAULTS
  // ═══════════════════════════════════════════════════════════════════

  app.post(
    "/facilities/cleaning/seed",
    { preHandler: requirePermission(PERMISSIONS.MANAGE_FACILITIES_CLEANING) },
    async () => {
      let cleaningSeeded = 0;

      for (const d of DEFAULT_CLEANING_DUTIES) {
        const exists = await prisma.cleaningDuty.findFirst({ where: { name: d.name, isDefault: true } });
        if (!exists) {
          await prisma.cleaningDuty.create({ data: d });
          cleaningSeeded++;
        }
      }

      return { cleaningSeeded };
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  // CLEANING DUTIES (assigned to service groups)
  // ═══════════════════════════════════════════════════════════════════

  // List all cleaning duties
  app.get(
    "/facilities/cleaning/duties",
    { preHandler: requirePermission(PERMISSIONS.FACILITIES_VIEW) },
    async () => {
      return prisma.cleaningDuty.findMany({
        orderBy: { sortOrder: "asc" },
        include: { _count: { select: { schedules: true } } },
      });
    },
  );

  // Create cleaning duty
  app.post<{ Body: { name: string; category?: "grundreinigung" | "sichtreinigung" | "monatsreinigung" | "custom" } }>(
    "/facilities/cleaning/duties",
    {
      schema: {
        body: Type.Object({
          name: Type.String({ minLength: 1 }),
          category: Type.Optional(Type.Union([
            Type.Literal("grundreinigung"), Type.Literal("sichtreinigung"),
            Type.Literal("monatsreinigung"), Type.Literal("custom"),
          ])),
        }),
      },
      preHandler: requirePermission(PERMISSIONS.MANAGE_FACILITIES_CLEANING),
    },
    async (request) => {
      const { name, category } = request.body;
      const duty = await prisma.cleaningDuty.create({
        data: { name, category: category ?? "custom" },
      });
      await audit("cleaning_duty.create", request.user.sub, "CleaningDuty", duty.id, null, duty);
      return duty;
    },
  );

  // Delete cleaning duty
  app.delete<{ Params: IdParamsType }>(
    "/facilities/cleaning/duties/:id",
    { preHandler: requirePermission(PERMISSIONS.MANAGE_FACILITIES_CLEANING) },
    async (request, reply) => {
      const duty = await prisma.cleaningDuty.findUnique({ where: { id: request.params.id } });
      if (!duty) return reply.code(404).send({ error: "Cleaning duty not found" });
      await prisma.cleaningDuty.delete({ where: { id: request.params.id } });
      await audit("cleaning_duty.delete", request.user.sub, "CleaningDuty", request.params.id, duty);
      return reply.code(204).send();
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  // CLEANING SCHEDULES (service group ↔ duty ↔ date)
  // ═══════════════════════════════════════════════════════════════════

  // List schedules in date range
  app.get(
    "/facilities/cleaning/schedules",
    { preHandler: requirePermission(PERMISSIONS.FACILITIES_VIEW) },
    async (request) => {
      const { from, to } = request.query as { from?: string; to?: string };
      const where: Record<string, unknown> = {};
      if (from) where.date = { ...(where.date as object ?? {}), gte: new Date(from) };
      if (to) where.date = { ...(where.date as object ?? {}), lte: new Date(to) };

      return prisma.cleaningSchedule.findMany({
        where,
        orderBy: { date: "asc" },
        include: {
          duty: { select: { id: true, name: true, category: true } },
          serviceGroup: { select: { id: true, name: true } },
        },
      });
    },
  );

  // Generate rotation schedule
  app.post<{ Body: { dutyId: string; startDate: string; endDate: string; frequency: "weekly" | "biweekly" | "monthly" } }>(
    "/facilities/cleaning/schedules/generate",
    {
      schema: {
        body: Type.Object({
          dutyId: Type.String({ format: "uuid" }),
          startDate: Type.String({ format: "date" }),
          endDate: Type.String({ format: "date" }),
          frequency: Type.Union([
            Type.Literal("weekly"), Type.Literal("biweekly"), Type.Literal("monthly"),
          ]),
        }),
      },
      preHandler: requirePermission(PERMISSIONS.MANAGE_FACILITIES_CLEANING),
    },
    async (request) => {
      const { dutyId, startDate, endDate, frequency } = request.body;

      // Get all service groups in order
      const groups = await prisma.serviceGroup.findMany({ orderBy: { sortOrder: "asc" } });
      if (groups.length === 0) return { error: "No service groups configured" };

      const duty = await prisma.cleaningDuty.findUnique({ where: { id: dutyId } });
      if (!duty) return { error: "Cleaning duty not found" };

      // Generate dates
      const dates: Date[] = [];
      const start = new Date(startDate);
      const end = new Date(endDate);
      const intervalDays = frequency === "weekly" ? 7 : frequency === "biweekly" ? 14 : 30;
      let current = new Date(start);
      while (current <= end) {
        dates.push(new Date(current));
        current.setDate(current.getDate() + intervalDays);
      }

      // Round-robin assignment
      const schedules = dates.map((date, i) => ({
        dutyId,
        serviceGroupId: groups[i % groups.length].id,
        date,
      }));

      // Bulk create
      const created = await prisma.cleaningSchedule.createMany({ data: schedules });
      await audit("cleaning_schedule.generate", request.user.sub, "CleaningSchedule", dutyId, null, {
        count: created.count, frequency, startDate, endDate,
      });

      return { created: created.count, frequency, duty: duty.name };
    },
  );

  // Update schedule entry (status, reassign)
  app.put<{ Params: IdParamsType; Body: { status?: "scheduled" | "completed" | "skipped"; serviceGroupId?: string; notes?: string } }>(
    "/facilities/cleaning/schedules/:id",
    {
      schema: {
        body: Type.Object({
          status: Type.Optional(Type.Union([
            Type.Literal("scheduled"), Type.Literal("completed"), Type.Literal("skipped"),
          ])),
          serviceGroupId: Type.Optional(Type.String({ format: "uuid" })),
          notes: Type.Optional(Type.String()),
        }),
      },
      preHandler: requirePermission(PERMISSIONS.MANAGE_FACILITIES_CLEANING),
    },
    async (request, reply) => {
      const before = await prisma.cleaningSchedule.findUnique({ where: { id: request.params.id } });
      if (!before) return reply.code(404).send({ error: "Schedule not found" });
      const updated = await prisma.cleaningSchedule.update({
        where: { id: request.params.id },
        data: request.body as { status?: "scheduled" | "completed" | "skipped"; serviceGroupId?: string; notes?: string },
      });
      await audit("cleaning_schedule.update", request.user.sub, "CleaningSchedule", request.params.id, before, updated);
      return updated;
    },
  );

  // Delete schedule entry
  app.delete<{ Params: IdParamsType }>(
    "/facilities/cleaning/schedules/:id",
    { preHandler: requirePermission(PERMISSIONS.MANAGE_FACILITIES_CLEANING) },
    async (request, reply) => {
      await prisma.cleaningSchedule.delete({ where: { id: request.params.id } });
      return reply.code(204).send();
    },
  );
}
