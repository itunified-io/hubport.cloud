import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission, requireAnyPermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { calculateSuggestedDue } from "../lib/adaptive-due-date.js";

// ─── Schemas ────────────────────────────────────────────────────────

const TerritoryIdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});
type TerritoryIdParamsType = Static<typeof TerritoryIdParams>;

// ─── Routes ─────────────────────────────────────────────────────────

export async function assignmentRoutes(app: FastifyInstance): Promise<void> {
  // Suggested due date for a territory — ASSIGNMENTS_MANAGE or ASSIGNMENTS_VIEW
  app.get<{ Params: TerritoryIdParamsType }>(
    "/territories/:id/suggested-due",
    {
      preHandler: requireAnyPermission(
        PERMISSIONS.ASSIGNMENTS_MANAGE,
        PERMISSIONS.ASSIGNMENTS_VIEW,
      ),
      schema: { params: TerritoryIdParams },
    },
    async (request, reply) => {
      const territory = await prisma.territory.findUnique({
        where: { id: request.params.id },
        include: {
          addresses: { select: { id: true } },
          assignments: {
            select: { assignedAt: true, returnedAt: true },
            orderBy: { assignedAt: "desc" },
            take: 20,
          },
        },
      });
      if (!territory) {
        return reply.code(404).send({ error: "Territory not found" });
      }

      // Get congregation settings for default checkout days
      const settings = await prisma.congregationSettings.findFirst();
      const defaultCheckoutDays = settings?.defaultCheckoutDays ?? 120;

      // Calculate average address count across all territories
      const addressStats = await prisma.address.aggregate({
        _count: { id: true },
      });
      const territoryCount = await prisma.territory.count();
      const avgAddressCount =
        territoryCount > 0
          ? (addressStats._count.id ?? 0) / territoryCount
          : territory.addresses.length;

      const suggestedDue = calculateSuggestedDue(
        territory.addresses.length,
        avgAddressCount,
        defaultCheckoutDays,
        territory.assignments,
      );

      return {
        territoryId: territory.id,
        addressCount: territory.addresses.length,
        avgAddressCount: Math.round(avgAddressCount),
        defaultCheckoutDays,
        suggestedDue,
      };
    },
  );

  // Territory board (kanban) — ASSIGNMENTS_VIEW
  app.get(
    "/territories/board",
    {
      preHandler: requirePermission(PERMISSIONS.ASSIGNMENTS_VIEW),
    },
    async () => {
      const settings = await prisma.congregationSettings.findFirst();
      const returnedVisibleDays = settings?.returnedVisibleDays ?? 30;

      const now = new Date();
      const recentReturnCutoff = new Date();
      recentReturnCutoff.setDate(
        recentReturnCutoff.getDate() - returnedVisibleDays,
      );

      // All territories with current assignment state
      const territories = await prisma.territory.findMany({
        orderBy: { number: "asc" },
        include: {
          assignments: {
            where: { isActive: true, isSuspended: false },
            include: { publisher: true },
          },
          addresses: { select: { id: true } },
        },
      });

      const available: typeof territories = [];
      const assigned: typeof territories = [];
      const overdue: typeof territories = [];

      for (const t of territories) {
        const activeAssignment = t.assignments[0];
        if (!activeAssignment) {
          available.push(t);
        } else if (
          activeAssignment.dueDate &&
          activeAssignment.dueDate < now
        ) {
          overdue.push(t);
        } else {
          assigned.push(t);
        }
      }

      // Recently returned (last N days)
      const recentlyReturned = await prisma.territoryAssignment.findMany({
        where: {
          returnedAt: { gte: recentReturnCutoff },
          isActive: false,
        },
        include: {
          territory: true,
          publisher: true,
        },
        orderBy: { returnedAt: "desc" },
      });

      return {
        available: available.map((t) => ({
          id: t.id,
          number: t.number,
          name: t.name,
          addressCount: t.addresses.length,
        })),
        assigned: assigned.map((t) => ({
          id: t.id,
          number: t.number,
          name: t.name,
          addressCount: t.addresses.length,
          assignment: t.assignments[0],
        })),
        overdue: overdue.map((t) => ({
          id: t.id,
          number: t.number,
          name: t.name,
          addressCount: t.addresses.length,
          assignment: t.assignments[0],
        })),
        recentlyReturned: recentlyReturned.map((a) => ({
          id: a.territory.id,
          number: a.territory.number,
          name: a.territory.name,
          returnedAt: a.returnedAt,
          publisher: a.publisher,
        })),
      };
    },
  );

  // Publishers with assignment counts — ASSIGNMENTS_VIEW
  app.get(
    "/territories/board/publishers",
    {
      preHandler: requirePermission(PERMISSIONS.ASSIGNMENTS_VIEW),
    },
    async () => {
      const publishers = await prisma.publisher.findMany({
        where: { status: "active" },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
          _count: {
            select: {
              assignments: {
                where: { isActive: true },
              },
            },
          },
        },
        orderBy: { lastName: "asc" },
      });

      return publishers.map((p) => ({
        id: p.id,
        name: p.displayName ?? `${p.firstName} ${p.lastName}`,
        activeAssignments: p._count.assignments,
      }));
    },
  );
}
