import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import crypto from "node:crypto";
import prisma from "../lib/prisma.js";
import { requirePermission, requireAnyPermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";

/** Generate a 6-character alphanumeric join code */
function generateJoinCode(): string {
  return crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
}

// ─── Schemas ────────────────────────────────────────────────────────

const MeetingPointIdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});
type MeetingPointIdParamsType = Static<typeof MeetingPointIdParams>;

const FieldGroupIdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});
type FieldGroupIdParamsType = Static<typeof FieldGroupIdParams>;

const FieldGroupBody = Type.Object({
  name: Type.Optional(Type.String()),
  memberIds: Type.Optional(Type.Array(Type.String({ format: "uuid" }))),
  territoryIds: Type.Optional(Type.Array(Type.String({ format: "uuid" }))),
  sessionDate: Type.Optional(Type.String({ format: "date" })),
  sessionTime: Type.Optional(Type.String()),
  notes: Type.Optional(Type.String()),
});
type FieldGroupBodyType = Static<typeof FieldGroupBody>;

const FieldGroupUpdateBody = Type.Object({
  name: Type.Optional(Type.String()),
  memberIds: Type.Optional(Type.Array(Type.String({ format: "uuid" }))),
  territoryIds: Type.Optional(Type.Array(Type.String({ format: "uuid" }))),
  sessionDate: Type.Optional(Type.String({ format: "date" })),
  sessionTime: Type.Optional(Type.String()),
  notes: Type.Optional(Type.String()),
});
type FieldGroupUpdateBodyType = Static<typeof FieldGroupUpdateBody>;

const LocationShareStartBody = Type.Object({
  publisherId: Type.String({ format: "uuid" }),
  duration: Type.Union([
    Type.Literal("one_hour"),
    Type.Literal("four_hours"),
    Type.Literal("eight_hours"),
  ]),
});
type LocationShareStartBodyType = Static<typeof LocationShareStartBody>;

const LocationShareUpdateBody = Type.Object({
  publisherId: Type.String({ format: "uuid" }),
  latitude: Type.Number(),
  longitude: Type.Number(),
  heading: Type.Optional(Type.Number({ minimum: 0, maximum: 360 })),
  accuracy: Type.Optional(Type.Number({ minimum: 0 })),
});
type LocationShareUpdateBodyType = Static<typeof LocationShareUpdateBody>;

const LocationShareStopBody = Type.Object({
  publisherId: Type.String({ format: "uuid" }),
});
type LocationShareStopBodyType = Static<typeof LocationShareStopBody>;

const JoinByCodeBody = Type.Object({
  code: Type.String({ minLength: 6, maxLength: 6 }),
  publisherId: Type.String({ format: "uuid" }),
});
type JoinByCodeBodyType = Static<typeof JoinByCodeBody>;

// Duration map in milliseconds
const DURATION_MS: Record<string, number> = {
  one_hour: 1 * 60 * 60 * 1000,
  four_hours: 4 * 60 * 60 * 1000,
  eight_hours: 8 * 60 * 60 * 1000,
};

// ─── Routes ─────────────────────────────────────────────────────────

export async function fieldGroupRoutes(app: FastifyInstance): Promise<void> {
  // ─── Active locations for overseer dashboard ─────────────────────
  app.get(
    "/field-groups/active-locations",
    {
      preHandler: requirePermission(PERMISSIONS.FIELD_WORK_OVERSEER),
    },
    async (_request, reply) => {
      const now = new Date();
      const activeShares = await prisma.locationShare.findMany({
        where: { isActive: true, expiresAt: { gt: now } },
        include: {
          publisher: { select: { id: true, firstName: true, lastName: true } },
          fieldGroup: {
            select: {
              id: true,
              name: true,
              status: true,
              territoryIds: true,
              meetingPointId: true,
            },
          },
        },
      });
      return reply.send(activeShares);
    },
  );

  // ─── Join field group by code ────────────────────────────────────
  app.post<{ Body: JoinByCodeBodyType }>(
    "/field-groups/join",
    {
      preHandler: requireAnyPermission(
        PERMISSIONS.CAMPAIGNS_ASSIST,
        PERMISSIONS.CAMPAIGNS_CONDUCT,
      ),
      schema: { body: JoinByCodeBody },
    },
    async (request, reply) => {
      const fg = await prisma.campaignFieldGroup.findFirst({
        where: {
          joinCode: request.body.code.toUpperCase(),
          status: { not: "closed" },
        },
      });
      if (!fg) {
        return reply.code(404).send({ error: "Invalid or expired join code" });
      }

      const memberIds = fg.memberIds ?? [];
      if (!memberIds.includes(request.body.publisherId)) {
        await prisma.campaignFieldGroup.update({
          where: { id: fg.id },
          data: { memberIds: [...memberIds, request.body.publisherId] },
        });
      }

      return reply.send(fg);
    },
  );

  // Create field group within a meeting point — CAMPAIGNS_CONDUCT
  app.post<{ Params: MeetingPointIdParamsType; Body: FieldGroupBodyType }>(
    "/meeting-points/:id/field-groups",
    {
      preHandler: requirePermission(PERMISSIONS.CAMPAIGNS_CONDUCT),
      schema: { params: MeetingPointIdParams, body: FieldGroupBody },
    },
    async (request, reply) => {
      const mp = await prisma.campaignMeetingPoint.findUnique({
        where: { id: request.params.id },
      });
      if (!mp) {
        return reply.code(404).send({ error: "Meeting point not found" });
      }

      const fieldGroup = await prisma.campaignFieldGroup.create({
        data: {
          meetingPointId: request.params.id,
          name: request.body.name,
          memberIds: request.body.memberIds ?? [],
          territoryIds: request.body.territoryIds ?? [],
          sessionDate: request.body.sessionDate
            ? new Date(request.body.sessionDate)
            : undefined,
          sessionTime: request.body.sessionTime,
          notes: request.body.notes,
        },
      });
      return reply.code(201).send(fieldGroup);
    },
  );

  // Update field group — CAMPAIGNS_CONDUCT
  app.put<{ Params: FieldGroupIdParamsType; Body: FieldGroupUpdateBodyType }>(
    "/field-groups/:id",
    {
      preHandler: requirePermission(PERMISSIONS.CAMPAIGNS_CONDUCT),
      schema: { params: FieldGroupIdParams, body: FieldGroupUpdateBody },
    },
    async (request, reply) => {
      const existing = await prisma.campaignFieldGroup.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Field group not found" });
      }

      const data: Record<string, unknown> = {};
      if (request.body.name !== undefined) data.name = request.body.name;
      if (request.body.memberIds !== undefined)
        data.memberIds = request.body.memberIds;
      if (request.body.territoryIds !== undefined)
        data.territoryIds = request.body.territoryIds;
      if (request.body.sessionDate !== undefined)
        data.sessionDate = new Date(request.body.sessionDate);
      if (request.body.sessionTime !== undefined)
        data.sessionTime = request.body.sessionTime;
      if (request.body.notes !== undefined) data.notes = request.body.notes;

      const fieldGroup = await prisma.campaignFieldGroup.update({
        where: { id: request.params.id },
        data,
      });
      return fieldGroup;
    },
  );

  // Start field group (set status to in_field) — CAMPAIGNS_CONDUCT
  app.post<{ Params: FieldGroupIdParamsType }>(
    "/field-groups/:id/start",
    {
      preHandler: requirePermission(PERMISSIONS.CAMPAIGNS_CONDUCT),
      schema: { params: FieldGroupIdParams },
    },
    async (request, reply) => {
      const existing = await prisma.campaignFieldGroup.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Field group not found" });
      }
      if (existing.status !== "open") {
        return reply.code(409).send({
          error: "Conflict",
          message: "Field group must be open to start",
        });
      }

      const fieldGroup = await prisma.campaignFieldGroup.update({
        where: { id: request.params.id },
        data: { status: "in_field", startedAt: new Date() },
      });
      return fieldGroup;
    },
  );

  // Close field group — CAMPAIGNS_CONDUCT
  app.post<{ Params: FieldGroupIdParamsType }>(
    "/field-groups/:id/close",
    {
      preHandler: requirePermission(PERMISSIONS.CAMPAIGNS_CONDUCT),
      schema: { params: FieldGroupIdParams },
    },
    async (request, reply) => {
      const existing = await prisma.campaignFieldGroup.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Field group not found" });
      }
      if (existing.status === "closed") {
        return reply.code(409).send({
          error: "Conflict",
          message: "Field group is already closed",
        });
      }

      await prisma.$transaction(async (tx) => {
        // Deactivate all location shares
        await tx.locationShare.updateMany({
          where: { fieldGroupId: request.params.id, isActive: true },
          data: {
            isActive: false,
            lastLatitude: null,
            lastLongitude: null,
          },
        });

        await tx.campaignFieldGroup.update({
          where: { id: request.params.id },
          data: { status: "closed", closedAt: new Date() },
        });
      });

      const updated = await prisma.campaignFieldGroup.findUnique({
        where: { id: request.params.id },
      });
      return updated;
    },
  );

  // Start location sharing — CAMPAIGNS_ASSIST
  app.post<{
    Params: FieldGroupIdParamsType;
    Body: LocationShareStartBodyType;
  }>(
    "/field-groups/:id/location-share/start",
    {
      preHandler: requireAnyPermission(
        PERMISSIONS.CAMPAIGNS_ASSIST,
        PERMISSIONS.CAMPAIGNS_CONDUCT,
      ),
      schema: {
        params: FieldGroupIdParams,
        body: LocationShareStartBody,
      },
    },
    async (request, reply) => {
      const fg = await prisma.campaignFieldGroup.findUnique({
        where: { id: request.params.id },
      });
      if (!fg) {
        return reply.code(404).send({ error: "Field group not found" });
      }
      if (fg.status === "closed") {
        return reply.code(409).send({
          error: "Conflict",
          message: "Cannot share location in a closed field group",
        });
      }

      // Check for existing active share by this publisher in this group
      const existingShare = await prisma.locationShare.findFirst({
        where: {
          fieldGroupId: request.params.id,
          publisherId: request.body.publisherId,
          isActive: true,
        },
      });
      if (existingShare) {
        return reply.code(409).send({
          error: "Conflict",
          message: "Publisher already has an active location share in this group",
        });
      }

      const durationMs = DURATION_MS[request.body.duration];
      const expiresAt = new Date(Date.now() + durationMs);

      const share = await prisma.locationShare.create({
        data: {
          fieldGroupId: request.params.id,
          publisherId: request.body.publisherId,
          duration: request.body.duration,
          expiresAt,
        },
      });
      return reply.code(201).send(share);
    },
  );

  // Update location position (30s polling) — CAMPAIGNS_ASSIST
  app.post<{
    Params: FieldGroupIdParamsType;
    Body: LocationShareUpdateBodyType;
  }>(
    "/field-groups/:id/location-share/update",
    {
      preHandler: requireAnyPermission(
        PERMISSIONS.CAMPAIGNS_ASSIST,
        PERMISSIONS.CAMPAIGNS_CONDUCT,
      ),
      schema: {
        params: FieldGroupIdParams,
        body: LocationShareUpdateBody,
      },
    },
    async (request, reply) => {
      const share = await prisma.locationShare.findFirst({
        where: {
          fieldGroupId: request.params.id,
          publisherId: request.body.publisherId,
          isActive: true,
        },
      });
      if (!share) {
        return reply.code(404).send({
          error: "No active location share found",
        });
      }

      // Check if expired
      if (share.expiresAt < new Date()) {
        await prisma.locationShare.update({
          where: { id: share.id },
          data: {
            isActive: false,
            lastLatitude: null,
            lastLongitude: null,
          },
        });
        return reply.code(410).send({
          error: "Gone",
          message: "Location share has expired",
        });
      }

      const updated = await prisma.locationShare.update({
        where: { id: share.id },
        data: {
          lastLatitude: request.body.latitude,
          lastLongitude: request.body.longitude,
          heading: request.body.heading ?? null,
          accuracy: request.body.accuracy ?? null,
          lastUpdatedAt: new Date(),
        },
      });
      return updated;
    },
  );

  // Stop location sharing — CAMPAIGNS_ASSIST
  app.post<{
    Params: FieldGroupIdParamsType;
    Body: LocationShareStopBodyType;
  }>(
    "/field-groups/:id/location-share/stop",
    {
      preHandler: requireAnyPermission(
        PERMISSIONS.CAMPAIGNS_ASSIST,
        PERMISSIONS.CAMPAIGNS_CONDUCT,
      ),
      schema: {
        params: FieldGroupIdParams,
        body: LocationShareStopBody,
      },
    },
    async (request, reply) => {
      const share = await prisma.locationShare.findFirst({
        where: {
          fieldGroupId: request.params.id,
          publisherId: request.body.publisherId,
          isActive: true,
        },
      });
      if (!share) {
        return reply.code(404).send({
          error: "No active location share found",
        });
      }

      const updated = await prisma.locationShare.update({
        where: { id: share.id },
        data: {
          isActive: false,
          lastLatitude: null,
          lastLongitude: null,
        },
      });
      return updated;
    },
  );

  // ─── Generate join code ──────────────────────────────────────────
  app.post<{ Params: FieldGroupIdParamsType }>(
    "/field-groups/:id/generate-code",
    {
      preHandler: requirePermission(PERMISSIONS.CAMPAIGNS_CONDUCT),
      schema: { params: FieldGroupIdParams },
    },
    async (request, reply) => {
      const fg = await prisma.campaignFieldGroup.findUnique({
        where: { id: request.params.id },
      });
      if (!fg) {
        return reply.code(404).send({ error: "Field group not found" });
      }
      if (fg.status === "closed") {
        return reply.code(409).send({
          error: "Conflict",
          message: "Cannot generate code for closed group",
        });
      }

      let code: string;
      let attempts = 0;
      do {
        code = generateJoinCode();
        const existing = await prisma.campaignFieldGroup.findFirst({
          where: { joinCode: code, status: { not: "closed" } },
        });
        if (!existing) break;
        attempts++;
      } while (attempts < 5);

      const updated = await prisma.campaignFieldGroup.update({
        where: { id: request.params.id },
        data: { joinCode: code },
      });
      return reply.send({ joinCode: updated.joinCode });
    },
  );

  // ─── Auto-close stale field groups (in_field > 4 hours) ──────────
  const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
  const MAX_FIELD_DURATION_MS = 4 * 60 * 60 * 1000;

  const cleanupTimer = setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - MAX_FIELD_DURATION_MS);
      const stale = await prisma.campaignFieldGroup.findMany({
        where: { status: "in_field", startedAt: { lt: cutoff } },
      });

      for (const fg of stale) {
        await prisma.$transaction(async (tx) => {
          await tx.locationShare.updateMany({
            where: { fieldGroupId: fg.id, isActive: true },
            data: { isActive: false, lastLatitude: null, lastLongitude: null },
          });
          await tx.campaignFieldGroup.update({
            where: { id: fg.id },
            data: { status: "closed", closedAt: new Date() },
          });
        });
        app.log.info(`Auto-closed stale field group ${fg.id}`);
      }
    } catch (err) {
      app.log.error(err, "Field group cleanup failed");
    }
  }, CLEANUP_INTERVAL_MS);

  app.addHook("onClose", () => clearInterval(cleanupTimer));
}
