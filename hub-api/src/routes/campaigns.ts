import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission, requireAnyPermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import {
  generateCampaignReport,
  campaignReportToCsv,
  type CampaignReportInput,
} from "../lib/campaign-report.js";

// ─── Schemas ────────────────────────────────────────────────────────

const IdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});
type IdParamsType = Static<typeof IdParams>;

const CampaignCreateBody = Type.Object({
  title: Type.String({ minLength: 1 }),
  template: Type.Union([
    Type.Literal("gedaechtnismahl"),
    Type.Literal("kongress"),
    Type.Literal("predigtdienstaktion"),
    Type.Literal("custom"),
  ]),
  startDate: Type.String({ format: "date" }),
  endDate: Type.String({ format: "date" }),
});
type CampaignCreateBodyType = Static<typeof CampaignCreateBody>;

const CampaignUpdateBody = Type.Object({
  title: Type.Optional(Type.String({ minLength: 1 })),
  template: Type.Optional(
    Type.Union([
      Type.Literal("gedaechtnismahl"),
      Type.Literal("kongress"),
      Type.Literal("predigtdienstaktion"),
      Type.Literal("custom"),
    ]),
  ),
  startDate: Type.Optional(Type.String({ format: "date" })),
  endDate: Type.Optional(Type.String({ format: "date" })),
});
type CampaignUpdateBodyType = Static<typeof CampaignUpdateBody>;

const StatusQuerystring = Type.Object({
  status: Type.Optional(
    Type.Union([
      Type.Literal("draft"),
      Type.Literal("active"),
      Type.Literal("closed"),
      Type.Literal("archived"),
    ]),
  ),
});
type StatusQuerystringType = Static<typeof StatusQuerystring>;

// ─── Routes ─────────────────────────────────────────────────────────

export async function campaignRoutes(app: FastifyInstance): Promise<void> {
  // List campaigns — CAMPAIGNS_VIEW
  app.get<{ Querystring: StatusQuerystringType }>(
    "/campaigns",
    {
      preHandler: requirePermission(PERMISSIONS.CAMPAIGNS_VIEW),
      schema: { querystring: StatusQuerystring },
    },
    async (request) => {
      const where: Record<string, unknown> = { deletedAt: null };
      if (request.query.status) {
        where.status = request.query.status;
      }
      return prisma.campaign.findMany({
        where,
        orderBy: { startDate: "desc" },
        include: {
          meetingPoints: true,
          _count: { select: { invitations: true } },
        },
      });
    },
  );

  // Get campaign detail — CAMPAIGNS_VIEW
  app.get<{ Params: IdParamsType }>(
    "/campaigns/:id",
    {
      preHandler: requirePermission(PERMISSIONS.CAMPAIGNS_VIEW),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const campaign = await prisma.campaign.findUnique({
        where: { id: request.params.id, deletedAt: null },
        include: {
          meetingPoints: {
            include: {
              fieldGroups: {
                include: { locationShares: true },
              },
            },
          },
          invitations: true,
        },
      });
      if (!campaign) {
        return reply.code(404).send({ error: "Not found" });
      }
      return campaign;
    },
  );

  // Create campaign (draft) — CAMPAIGNS_MANAGE
  app.post<{ Body: CampaignCreateBodyType }>(
    "/campaigns",
    {
      preHandler: requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE),
      schema: { body: CampaignCreateBody },
    },
    async (request, reply) => {
      const sub = (request.user as { sub: string }).sub;
      const campaign = await prisma.campaign.create({
        data: {
          title: request.body.title,
          template: request.body.template,
          startDate: new Date(request.body.startDate),
          endDate: new Date(request.body.endDate),
          createdBy: sub,
        },
      });
      return reply.code(201).send(campaign);
    },
  );

  // Update draft campaign — CAMPAIGNS_MANAGE
  app.put<{ Params: IdParamsType; Body: CampaignUpdateBodyType }>(
    "/campaigns/:id",
    {
      preHandler: requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE),
      schema: { params: IdParams, body: CampaignUpdateBody },
    },
    async (request, reply) => {
      const existing = await prisma.campaign.findUnique({
        where: { id: request.params.id },
      });
      if (!existing || existing.deletedAt) {
        return reply.code(404).send({ error: "Not found" });
      }
      if (existing.status !== "draft") {
        return reply.code(409).send({
          error: "Conflict",
          message: "Only draft campaigns can be updated",
        });
      }

      const data: Record<string, unknown> = {};
      if (request.body.title) data.title = request.body.title;
      if (request.body.template) data.template = request.body.template;
      if (request.body.startDate)
        data.startDate = new Date(request.body.startDate);
      if (request.body.endDate) data.endDate = new Date(request.body.endDate);

      const campaign = await prisma.campaign.update({
        where: { id: request.params.id },
        data,
      });
      return campaign;
    },
  );

  // Activate campaign — CAMPAIGNS_MANAGE
  app.post<{ Params: IdParamsType }>(
    "/campaigns/:id/activate",
    {
      preHandler: requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const campaign = await prisma.campaign.findUnique({
        where: { id: request.params.id },
        include: { meetingPoints: true },
      });
      if (!campaign || campaign.deletedAt) {
        return reply.code(404).send({ error: "Not found" });
      }
      if (campaign.status !== "draft") {
        return reply.code(409).send({
          error: "Conflict",
          message: "Only draft campaigns can be activated",
        });
      }

      // Collect territory IDs from meeting points
      const campaignTerritoryIds = campaign.meetingPoints.flatMap(
        (mp) => mp.territoryIds,
      );

      // Check for overlapping active assignments on these territories
      if (campaignTerritoryIds.length > 0) {
        const overlapping = await prisma.territoryAssignment.findMany({
          where: {
            territoryId: { in: campaignTerritoryIds },
            isActive: true,
            isSuspended: false,
            campaignId: null, // only regular assignments
          },
        });

        // Suspend regular assignments for campaign territories
        if (overlapping.length > 0) {
          await prisma.territoryAssignment.updateMany({
            where: {
              id: { in: overlapping.map((a) => a.id) },
            },
            data: { isSuspended: true },
          });
        }
      }

      const updated = await prisma.campaign.update({
        where: { id: request.params.id },
        data: { status: "active" },
      });
      return updated;
    },
  );

  // Close campaign — CAMPAIGNS_MANAGE (full effect chain)
  app.post<{ Params: IdParamsType }>(
    "/campaigns/:id/close",
    {
      preHandler: requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const campaign = await prisma.campaign.findUnique({
        where: { id: request.params.id },
        include: {
          meetingPoints: {
            include: {
              fieldGroups: {
                include: { locationShares: true },
              },
            },
          },
        },
      });
      if (!campaign || campaign.deletedAt) {
        return reply.code(404).send({ error: "Not found" });
      }
      if (campaign.status !== "active") {
        return reply.code(409).send({
          error: "Conflict",
          message: "Only active campaigns can be closed",
        });
      }

      const campaignTerritoryIds = campaign.meetingPoints.flatMap(
        (mp) => mp.territoryIds,
      );
      const campaignDurationDays = Math.ceil(
        (campaign.endDate.getTime() - campaign.startDate.getTime()) /
          (1000 * 60 * 60 * 24),
      );

      await prisma.$transaction(async (tx) => {
        // 1. Deactivate campaign-specific assignments
        await tx.territoryAssignment.updateMany({
          where: { campaignId: campaign.id, isActive: true },
          data: { isActive: false, returnedAt: new Date() },
        });

        // 2. Close all field groups
        for (const mp of campaign.meetingPoints) {
          for (const fg of mp.fieldGroups) {
            if (fg.status !== "closed") {
              await tx.campaignFieldGroup.update({
                where: { id: fg.id },
                data: { status: "closed", closedAt: new Date() },
              });
            }

            // 3. Null LocationShare coordinates, deactivate
            await tx.locationShare.updateMany({
              where: { fieldGroupId: fg.id, isActive: true },
              data: {
                isActive: false,
                lastLatitude: null,
                lastLongitude: null,
              },
            });
          }
        }

        // 4. Unsuspend regular assignments
        await tx.territoryAssignment.updateMany({
          where: {
            territoryId: { in: campaignTerritoryIds },
            isSuspended: true,
            campaignId: null,
          },
          data: { isSuspended: false },
        });

        // 5. Extend due dates by campaign duration (preserve null)
        if (campaignTerritoryIds.length > 0) {
          const suspendedAssignments = await tx.territoryAssignment.findMany({
            where: {
              territoryId: { in: campaignTerritoryIds },
              isActive: true,
              campaignId: null,
              dueDate: { not: null },
            },
          });
          for (const assignment of suspendedAssignments) {
            if (assignment.dueDate) {
              const newDue = new Date(assignment.dueDate);
              newDue.setDate(newDue.getDate() + campaignDurationDays);
              await tx.territoryAssignment.update({
                where: { id: assignment.id },
                data: { dueDate: newDue },
              });
            }
          }
        }

        // 6. Update territory lastWorkedDate — stored as updatedAt on territory
        if (campaignTerritoryIds.length > 0) {
          await tx.territory.updateMany({
            where: { id: { in: campaignTerritoryIds } },
            data: { updatedAt: new Date() },
          });
        }

        // 7. Set status closed
        await tx.campaign.update({
          where: { id: campaign.id },
          data: { status: "closed" },
        });
      });

      // 8. Generate result report (outside transaction — failure won't roll back close)
      try {
        const reportInput = await buildReportInput(prisma, campaign.id);
        const report = generateCampaignReport(reportInput);

        // 9. Send notification (create Notification record)
        const creatorPublisher = await prisma.publisher.findFirst({
          where: { keycloakSub: campaign.createdBy },
        });
        if (creatorPublisher) {
          await prisma.notification.create({
            data: {
              publisherId: creatorPublisher.id,
              type: "campaign_closed",
              title: `Campaign "${campaign.title}" closed`,
              body: `${report.summary.totalTerritories} territories, ${Object.values(report.summary.visitsByOutcome).reduce((a, b) => a + b, 0)} visits recorded`,
              data: { campaignId: campaign.id },
            },
          });
        }
      } catch (reportErr) {
        // Log but don't fail the close operation
        request.log.error({ err: reportErr }, "Failed to generate campaign close report/notification");
      }

      const updated = await prisma.campaign.findUnique({
        where: { id: request.params.id },
      });
      return updated;
    },
  );

  // Soft delete campaign — CAMPAIGNS_MANAGE
  app.delete<{ Params: IdParamsType }>(
    "/campaigns/:id",
    {
      preHandler: requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const existing = await prisma.campaign.findUnique({
        where: { id: request.params.id },
      });
      if (!existing || existing.deletedAt) {
        return reply.code(404).send({ error: "Not found" });
      }
      await prisma.campaign.update({
        where: { id: request.params.id },
        data: { deletedAt: new Date() },
      });
      return reply.code(204).send();
    },
  );

  // Campaign report — CAMPAIGNS_REPORT or CAMPAIGNS_MANAGE
  app.get<{ Params: IdParamsType }>(
    "/campaigns/:id/report",
    {
      preHandler: requireAnyPermission(
        PERMISSIONS.CAMPAIGNS_REPORT,
        PERMISSIONS.CAMPAIGNS_MANAGE,
      ),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const campaign = await prisma.campaign.findUnique({
        where: { id: request.params.id, deletedAt: null },
      });
      if (!campaign) {
        return reply.code(404).send({ error: "Not found" });
      }
      const input = await buildReportInput(prisma, campaign.id);
      return generateCampaignReport(input);
    },
  );

  // Campaign report CSV export — CAMPAIGNS_REPORT or CAMPAIGNS_MANAGE
  app.get<{ Params: IdParamsType }>(
    "/campaigns/:id/report/export",
    {
      preHandler: requireAnyPermission(
        PERMISSIONS.CAMPAIGNS_REPORT,
        PERMISSIONS.CAMPAIGNS_MANAGE,
      ),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const campaign = await prisma.campaign.findUnique({
        where: { id: request.params.id, deletedAt: null },
      });
      if (!campaign) {
        return reply.code(404).send({ error: "Not found" });
      }
      const input = await buildReportInput(prisma, campaign.id);
      const report = generateCampaignReport(input);
      const csv = campaignReportToCsv(report);

      return reply
        .header("Content-Type", "text/csv")
        .header(
          "Content-Disposition",
          `attachment; filename="campaign-${campaign.id}.csv"`,
        )
        .send(csv);
    },
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Build report input from database. Works with both PrismaClient and
 * Prisma transaction client.
 */
async function buildReportInput(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  campaignId: string,
): Promise<CampaignReportInput> {
  const campaign = await tx.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { meetingPoints: true },
  });

  const territoryIds = [
    ...new Set(
      (campaign.meetingPoints as Array<{ id: string; name: string | null; territoryIds: string[] }>)
        .flatMap((mp: { territoryIds: string[] }) => mp.territoryIds),
    ),
  ];

  const territories = await tx.territory.findMany({
    where: { id: { in: territoryIds } },
    include: {
      addresses: {
        include: {
          visits: {
            where: {
              visitedAt: {
                gte: campaign.startDate,
                lte: campaign.endDate,
              },
            },
          },
        },
      },
    },
  });

  // Collect unique publisher IDs from visits
  const publisherIds = new Set<string>();
  for (const t of territories) {
    for (const a of t.addresses) {
      for (const v of a.visits) {
        publisherIds.add(v.publisherId);
      }
    }
  }

  const publishers = new Map<string, string>();
  if (publisherIds.size > 0) {
    const pubs = await tx.publisher.findMany({
      where: { id: { in: [...publisherIds] } },
      select: { id: true, firstName: true, lastName: true, displayName: true },
    });
    for (const p of pubs) {
      publishers.set(p.id, p.displayName ?? `${p.firstName} ${p.lastName}`);
    }
  }

  return {
    campaign: { startDate: campaign.startDate, endDate: campaign.endDate },
    meetingPoints: (campaign.meetingPoints as Array<{ id: string; name: string | null; territoryIds: string[] }>).map(
      (mp: { id: string; name: string | null; territoryIds: string[] }) => ({
        id: mp.id,
        name: mp.name,
        territoryIds: mp.territoryIds,
      }),
    ),
    territories: (territories as Array<{ id: string; number: string; addresses: Array<{ id: string; visits: Array<{ publisherId: string; outcome: string; visitedAt: Date }> }> }>).map(
      (t: { id: string; number: string; addresses: Array<{ id: string; visits: Array<{ publisherId: string; outcome: string; visitedAt: Date }> }> }) => ({
        id: t.id,
        number: t.number,
        addresses: t.addresses.map(
          (a: { id: string; visits: Array<{ publisherId: string; outcome: string; visitedAt: Date }> }) => ({
            id: a.id,
            visits: a.visits.map(
              (v: { publisherId: string; outcome: string; visitedAt: Date }) => ({
                publisherId: v.publisherId,
                outcome: v.outcome,
                visitedAt: v.visitedAt,
              }),
            ),
          }),
        ),
      }),
    ),
    publishers,
  };
}
