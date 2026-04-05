import type { FastifyInstance } from "fastify";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import prisma from "../lib/prisma.js";
import { audit } from "../lib/policy-engine.js";
import { calculateNextDue, isValidFrequency } from "../lib/frequency.js";

const DEFAULT_PREVENTIVE_TASKS = [
  { name: "Feuerlöscher prüfen", category: "safety" as const, frequency: "6m" },
  { name: "Notbeleuchtung testen", category: "safety" as const, frequency: "3m" },
  { name: "Rauchmelder prüfen", category: "safety" as const, frequency: "6m" },
  { name: "Erste-Hilfe-Kasten prüfen", category: "safety" as const, frequency: "6m" },
  { name: "Heizungsfilter wechseln", category: "hvac" as const, frequency: "3m" },
  { name: "Heizungsanlage warten", category: "hvac" as const, frequency: "1y" },
  { name: "Klimaanlage warten", category: "hvac" as const, frequency: "1y" },
  { name: "Dachinspektion", category: "structural" as const, frequency: "1y" },
  { name: "Regenrinnen reinigen", category: "grounds" as const, frequency: "6m" },
  { name: "Wasserhähne Entkalkung", category: "plumbing" as const, frequency: "3m" },
  { name: "Abflüsse reinigen", category: "plumbing" as const, frequency: "6m" },
  { name: "Außenbeleuchtung prüfen", category: "electrical" as const, frequency: "3m" },
];

/** Escape text for iCal RFC 5545 compliance */
function escapeIcalText(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export async function facilitiesPreventiveRoutes(app: FastifyInstance): Promise<void> {

  // POST /facilities/preventive/seed
  app.post(
    "/facilities/preventive/seed",
    { preHandler: requirePermission(PERMISSIONS.MANAGE_FACILITIES_PREVENTIVE) },
    async (request) => {
      const existing = await prisma.preventiveTask.count();
      if (existing > 0) return { seeded: false, message: "Tasks already exist" };

      const now = new Date();
      for (const task of DEFAULT_PREVENTIVE_TASKS) {
        const nextDue = calculateNextDue(now, task.frequency as any);
        await prisma.preventiveTask.create({
          data: { ...task, isDefault: true, nextDue },
        });
      }
      await audit("preventive_task.seed", request.user.sub, "PreventiveTask");
      return { seeded: true, count: DEFAULT_PREVENTIVE_TASKS.length };
    },
  );

  // GET /facilities/preventive — list tasks with cursor pagination
  app.get(
    "/facilities/preventive",
    { preHandler: requirePermission(PERMISSIONS.FACILITIES_VIEW) },
    async (request) => {
      const { cursor, limit = "20" } = request.query as Record<string, string | undefined>;
      const take = Math.min(parseInt(limit ?? "20") || 20, 50);

      const tasks = await prisma.preventiveTask.findMany({
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { nextDue: "asc" },
        include: {
          assignee: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { entries: true } },
        },
      });

      const hasMore = tasks.length > take;
      if (hasMore) tasks.pop();

      return {
        data: tasks,
        nextCursor: hasMore ? tasks[tasks.length - 1].id : null,
      };
    },
  );

  // POST /facilities/preventive — create task
  app.post(
    "/facilities/preventive",
    { preHandler: requirePermission(PERMISSIONS.MANAGE_FACILITIES_PREVENTIVE) },
    async (request, reply) => {
      const { name, description, category, frequency, assigneeId } =
        request.body as Record<string, string>;

      if (!isValidFrequency(frequency)) {
        return reply.status(400).send({ error: `Invalid frequency: ${frequency}` });
      }

      const nextDue = calculateNextDue(new Date(), frequency as any);
      const task = await prisma.preventiveTask.create({
        data: {
          name,
          description: description || null,
          category: category as any,
          frequency,
          assigneeId: assigneeId || null,
          nextDue,
        },
      });
      await audit("preventive_task.create", request.user.sub, "PreventiveTask", task.id, null, task);
      return task;
    },
  );

  // PUT /facilities/preventive/:id — update task
  app.put(
    "/facilities/preventive/:id",
    { preHandler: requirePermission(PERMISSIONS.MANAGE_FACILITIES_PREVENTIVE) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, string>;

      if (body.frequency && !isValidFrequency(body.frequency)) {
        return reply.status(400).send({ error: `Invalid frequency: ${body.frequency}` });
      }

      const before = await prisma.preventiveTask.findUnique({ where: { id } });
      if (!before) return reply.status(404).send({ error: "Task not found" });

      const data: Record<string, unknown> = {};
      if (body.name) data.name = body.name;
      if (body.description !== undefined) data.description = body.description || null;
      if (body.category) data.category = body.category;
      if (body.frequency) {
        data.frequency = body.frequency;
        const from = before.lastDone || before.createdAt;
        data.nextDue = calculateNextDue(from, body.frequency as any);
      }
      if (body.assigneeId !== undefined) data.assigneeId = body.assigneeId || null;

      const updated = await prisma.preventiveTask.update({ where: { id }, data });
      await audit("preventive_task.update", request.user.sub, "PreventiveTask", id, before, updated);
      return updated;
    },
  );

  // DELETE /facilities/preventive/:id
  app.delete(
    "/facilities/preventive/:id",
    { preHandler: requirePermission(PERMISSIONS.MANAGE_FACILITIES_PREVENTIVE) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = await prisma.preventiveTask.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: "Task not found" });
      await prisma.preventiveTask.delete({ where: { id } });
      await audit("preventive_task.delete", request.user.sub, "PreventiveTask", id);
      return { ok: true };
    },
  );

  // POST /facilities/preventive/:id/complete — record completion
  app.post(
    "/facilities/preventive/:id/complete",
    { preHandler: requirePermission(PERMISSIONS.MANAGE_FACILITIES_PREVENTIVE) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { doneAt, notes } = request.body as { doneAt?: string; notes?: string };

      const task = await prisma.preventiveTask.findUnique({ where: { id } });
      if (!task) return reply.status(404).send({ error: "Task not found" });

      const completionDate = doneAt ? new Date(doneAt) : new Date();
      const nextDue = calculateNextDue(completionDate, task.frequency as any);

      const [entry] = await prisma.$transaction([
        prisma.preventiveEntry.create({
          data: {
            taskId: id,
            doneById: request.user.sub,
            doneAt: completionDate,
            notes: notes || null,
          },
        }),
        prisma.preventiveTask.update({
          where: { id },
          data: { lastDone: completionDate, nextDue },
        }),
      ]);

      await audit("preventive_task.complete", request.user.sub, "PreventiveTask", id, null, {
        entryId: entry.id, doneAt: completionDate, nextDue,
      });
      return { entry, nextDue };
    },
  );

  // GET /facilities/preventive/calendar.ics — iCal feed
  app.get(
    "/facilities/preventive/calendar.ics",
    { preHandler: requirePermission(PERMISSIONS.FACILITIES_VIEW) },
    async (request, reply) => {
      const tasks = await prisma.preventiveTask.findMany({
        where: { nextDue: { not: null } },
        include: { assignee: { select: { firstName: true, lastName: true } } },
      });

      const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//hubport.cloud//Facilities//EN",
        "X-WR-CALNAME:Wartungsplan",
      ];

      for (const task of tasks) {
        if (!task.nextDue) continue;
        const d = task.nextDue;
        const dateStr = d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
        const assignee = task.assignee
          ? `${task.assignee.firstName} ${task.assignee.lastName}`
          : "Nicht zugewiesen";

        lines.push(
          "BEGIN:VEVENT",
          `UID:preventive-${task.id}@hubport.cloud`,
          `DTSTART;VALUE=DATE:${dateStr.substring(0, 8)}`,
          `SUMMARY:${escapeIcalText(task.name)}`,
          `DESCRIPTION:Zuständig: ${escapeIcalText(assignee)}\\nKategorie: ${escapeIcalText(task.category)}\\nIntervall: ${escapeIcalText(task.frequency)}`,
          `CATEGORIES:${escapeIcalText(task.category)}`,
          "END:VEVENT",
        );
      }

      lines.push("END:VCALENDAR");

      reply.header("Content-Type", "text/calendar; charset=utf-8");
      reply.header("Content-Disposition", 'attachment; filename="wartungsplan.ics"');
      return lines.join("\r\n");
    },
  );
}
