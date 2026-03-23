/**
 * Meeting assignment routes — assign publishers to meeting slots.
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { audit } from "../lib/policy-engine.js";
import { checkEligibility, getEligiblePublishers } from "../lib/eligibility-engine.js";
import prisma from "../lib/prisma.js";

const IdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});
type IdParamsType = Static<typeof IdParams>;

const AssignmentBody = Type.Object({
  meetingId: Type.String({ format: "uuid" }),
  slotTemplateId: Type.String({ format: "uuid" }),
  workbookPartId: Type.Optional(Type.String({ format: "uuid" })),
  assigneePublisherId: Type.Optional(Type.String({ format: "uuid" })),
  assistantPublisherId: Type.Optional(Type.String({ format: "uuid" })),
  notes: Type.Optional(Type.String()),
});
type AssignmentBodyType = Static<typeof AssignmentBody>;

const UpdateAssignmentBody = Type.Object({
  assigneePublisherId: Type.Optional(Type.Union([Type.String({ format: "uuid" }), Type.Null()])),
  assistantPublisherId: Type.Optional(Type.Union([Type.String({ format: "uuid" }), Type.Null()])),
  status: Type.Optional(Type.Union([
    Type.Literal("pending"),
    Type.Literal("assigned"),
    Type.Literal("confirmed"),
    Type.Literal("declined"),
    Type.Literal("cancelled"),
  ])),
  notes: Type.Optional(Type.String()),
});
type UpdateAssignmentBodyType = Static<typeof UpdateAssignmentBody>;

const SubstituteBody = Type.Object({
  newAssigneeId: Type.String({ format: "uuid" }),
  reason: Type.Optional(Type.String()),
});
type SubstituteBodyType = Static<typeof SubstituteBody>;

const ValidateBody = Type.Object({
  publisherId: Type.String({ format: "uuid" }),
  slotKey: Type.String(),
  meetingType: Type.Union([Type.Literal("midweek"), Type.Literal("weekend")]),
  isAssistant: Type.Optional(Type.Boolean()),
});
type ValidateBodyType = Static<typeof ValidateBody>;

export async function meetingAssignmentRoutes(app: FastifyInstance): Promise<void> {
  // List assignments (filterable by meetingId)
  app.get(
    "/meeting-assignments",
    { preHandler: requirePermission(PERMISSIONS.MEETING_ASSIGNMENTS_VIEW) },
    async (request) => {
      const { meetingId, publisherId } = request.query as { meetingId?: string; publisherId?: string };
      const where: Record<string, unknown> = {};
      if (meetingId) where.meetingId = meetingId;
      if (publisherId) {
        where.OR = [
          { assigneePublisherId: publisherId },
          { assistantPublisherId: publisherId },
        ];
      }

      return prisma.meetingAssignment.findMany({
        where,
        include: {
          slotTemplate: true,
          workbookPart: true,
          assignee: { select: { id: true, firstName: true, lastName: true, displayName: true } },
          assistant: { select: { id: true, firstName: true, lastName: true, displayName: true } },
        },
        orderBy: { slotTemplate: { sortOrder: "asc" } },
      });
    },
  );

  // Create an assignment
  app.post<{ Body: AssignmentBodyType }>(
    "/meeting-assignments",
    {
      preHandler: requirePermission(PERMISSIONS.MEETING_ASSIGNMENTS_EDIT),
      schema: { body: AssignmentBody },
    },
    async (request, reply) => {
      const { meetingId, slotTemplateId, workbookPartId, assigneePublisherId, assistantPublisherId, notes } = request.body;

      // Verify meeting exists and is not locked
      const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
      if (!meeting) return reply.code(404).send({ error: "Meeting not found" });
      if (meeting.status === "locked") {
        return reply.code(409).send({ error: "Meeting is locked — cannot modify assignments" });
      }

      const assignment = await prisma.meetingAssignment.create({
        data: {
          meetingId,
          slotTemplateId,
          workbookPartId,
          assigneePublisherId,
          assistantPublisherId,
          status: assigneePublisherId ? "assigned" : "pending",
          source: "manual",
          notes,
        },
        include: { slotTemplate: true, assignee: true, assistant: true },
      });

      // Log assignment history
      await prisma.assignmentHistory.create({
        data: {
          assignmentId: assignment.id,
          action: "create",
          actorId: request.user?.sub ?? "unknown",
          newState: assignment as object,
        },
      });

      return reply.code(201).send(assignment);
    },
  );

  // Update an assignment (assign/reassign publisher)
  app.put<{ Params: IdParamsType; Body: UpdateAssignmentBodyType }>(
    "/meeting-assignments/:id",
    {
      preHandler: requirePermission(PERMISSIONS.MEETING_ASSIGNMENTS_EDIT),
      schema: { params: IdParams, body: UpdateAssignmentBody },
    },
    async (request, reply) => {
      const existing = await prisma.meetingAssignment.findUnique({
        where: { id: request.params.id },
        include: { meeting: true },
      });
      if (!existing) return reply.code(404).send({ error: "Assignment not found" });
      if (existing.meeting.status === "locked") {
        return reply.code(409).send({ error: "Meeting is locked" });
      }

      const actorId = request.user?.sub ?? "unknown";
      const data: Record<string, unknown> = {};
      if (request.body.assigneePublisherId !== undefined) {
        data.assigneePublisherId = request.body.assigneePublisherId;
        data.status = request.body.assigneePublisherId ? "assigned" : "pending";
      }
      if (request.body.assistantPublisherId !== undefined) {
        data.assistantPublisherId = request.body.assistantPublisherId;
      }
      if (request.body.status) data.status = request.body.status;
      if (request.body.notes !== undefined) data.notes = request.body.notes;

      const updated = await prisma.meetingAssignment.update({
        where: { id: request.params.id },
        data,
        include: { slotTemplate: true, assignee: true, assistant: true },
      });

      await prisma.assignmentHistory.create({
        data: {
          assignmentId: updated.id,
          action: "update",
          actorId,
          previousState: existing as object,
          newState: updated as object,
        },
      });

      return updated;
    },
  );

  // Delete an assignment
  app.delete<{ Params: IdParamsType }>(
    "/meeting-assignments/:id",
    {
      preHandler: requirePermission(PERMISSIONS.MEETING_ASSIGNMENTS_EDIT),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const existing = await prisma.meetingAssignment.findUnique({
        where: { id: request.params.id },
        include: { meeting: true },
      });
      if (!existing) return reply.code(404).send({ error: "Assignment not found" });
      if (existing.meeting.status === "locked") {
        return reply.code(409).send({ error: "Meeting is locked" });
      }

      await prisma.assignmentHistory.create({
        data: {
          assignmentId: existing.id,
          action: "unassign",
          actorId: request.user?.sub ?? "unknown",
          previousState: existing as object,
        },
      });

      await prisma.meetingAssignment.delete({ where: { id: request.params.id } });
      return reply.code(204).send();
    },
  );

  // Substitute: replace assignee with audit trail
  app.post<{ Params: IdParamsType; Body: SubstituteBodyType }>(
    "/meeting-assignments/:id/substitute",
    {
      preHandler: requirePermission(PERMISSIONS.MEETING_ASSIGNMENTS_EDIT),
      schema: { params: IdParams, body: SubstituteBody },
    },
    async (request, reply) => {
      const existing = await prisma.meetingAssignment.findUnique({
        where: { id: request.params.id },
        include: { meeting: true },
      });
      if (!existing) return reply.code(404).send({ error: "Assignment not found" });

      const actorId = request.user?.sub ?? "unknown";
      const updated = await prisma.meetingAssignment.update({
        where: { id: request.params.id },
        data: {
          assigneePublisherId: request.body.newAssigneeId,
          status: "substituted",
        },
        include: { slotTemplate: true, assignee: true, assistant: true },
      });

      await prisma.assignmentHistory.create({
        data: {
          assignmentId: existing.id,
          action: "substitute",
          actorId,
          previousState: existing as object,
          newState: updated as object,
          reason: request.body.reason,
        },
      });

      return updated;
    },
  );

  // Validate eligibility for an assignment
  app.post<{ Body: ValidateBodyType }>(
    "/meeting-assignments/validate",
    {
      preHandler: requirePermission(PERMISSIONS.MEETING_ASSIGNMENTS_VIEW),
      schema: { body: ValidateBody },
    },
    async (_request) => {
      const { publisherId, slotKey, meetingType, isAssistant } = _request.body;
      return checkEligibility({ publisherId, slotKey, meetingType, isAssistant });
    },
  );

  // Get eligible publishers for a slot
  app.get(
    "/meeting-assignments/eligible",
    { preHandler: requirePermission(PERMISSIONS.MEETING_ASSIGNMENTS_VIEW) },
    async (request) => {
      const { slotKey, meetingType } = request.query as { slotKey: string; meetingType: "midweek" | "weekend" };
      if (!slotKey || !meetingType) {
        return { error: "slotKey and meetingType query params required" };
      }
      return getEligiblePublishers(slotKey, meetingType);
    },
  );
}
