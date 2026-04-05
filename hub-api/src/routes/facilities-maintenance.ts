import type { FastifyInstance } from "fastify";
import PDFDocument from "pdfkit";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import prisma from "../lib/prisma.js";
import { audit, can } from "../lib/policy-engine.js";
import { isValidTransition } from "../lib/status-machine.js";

const MAX_PHOTOS_PER_ISSUE = 10;
const MAX_PHOTO_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB base64

const VALID_CATEGORIES = ["plumbing", "electrical", "hvac", "structural", "safety", "grounds", "furniture", "cleaning", "other"] as const;
const VALID_PRIORITIES = ["low", "medium", "high", "critical"] as const;
const VALID_STATUSES = ["reported", "under_review", "approved", "in_progress", "forwarded_to_ldc", "resolved", "rejected", "closed"] as const;

export async function facilitiesMaintenanceRoutes(app: FastifyInstance): Promise<void> {

  // ═══════════════════════════════════════════════════════════════════
  // LIST — cursor pagination + filters, soft-delete exclusion
  // ═══════════════════════════════════════════════════════════════════

  app.get(
    "/facilities/maintenance",
    { preHandler: requirePermission(PERMISSIONS.FACILITIES_VIEW) },
    async (request) => {
      const { cursor, limit = "20", status, category, priority, assignee } =
        request.query as Record<string, string | undefined>;
      const take = Math.min(parseInt(limit ?? "20") || 20, 100);

      const where: Record<string, unknown> = { deletedAt: null };
      if (status) where.status = status;
      if (category) where.category = category;
      if (priority) where.priority = priority;
      if (assignee) where.assigneeId = assignee;

      const issues = await prisma.maintenanceIssue.findMany({
        where,
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { createdAt: "desc" },
        include: {
          reporter: { select: { id: true, firstName: true, lastName: true } },
          assignee: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { photos: true, comments: true } },
        },
      });

      const hasMore = issues.length > take;
      if (hasMore) issues.pop();

      return {
        data: issues,
        nextCursor: hasMore ? issues[issues.length - 1].id : null,
      };
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  // CREATE — report a new maintenance issue
  // ═══════════════════════════════════════════════════════════════════

  app.post(
    "/facilities/maintenance",
    { preHandler: requirePermission(PERMISSIONS.FACILITIES_REPORT) },
    async (request, reply) => {
      const { title, description, category, priority, location } =
        request.body as Record<string, string>;

      if (!title || typeof title !== "string" || !title.trim()) {
        return reply.code(400).send({ error: "title is required and must be a non-empty string" });
      }
      if (!description || typeof description !== "string" || !description.trim()) {
        return reply.code(400).send({ error: "description is required and must be a non-empty string" });
      }
      if (!VALID_CATEGORIES.includes(category as any)) {
        return reply.code(400).send({ error: `Invalid category: ${category}. Valid values: ${VALID_CATEGORIES.join(", ")}` });
      }
      if (!VALID_PRIORITIES.includes(priority as any)) {
        return reply.code(400).send({ error: `Invalid priority: ${priority}. Valid values: ${VALID_PRIORITIES.join(", ")}` });
      }

      const issue = await prisma.maintenanceIssue.create({
        data: {
          title,
          description,
          category: category as any,
          priority: priority as any,
          location: location || null,
          reporterId: request.user.sub,
        },
      });
      await audit("maintenance_issue.create", request.user.sub, "MaintenanceIssue", issue.id, null, issue);
      return issue;
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  // DETAIL — single issue with photos, comments, reporter, assignee
  // ═══════════════════════════════════════════════════════════════════

  app.get(
    "/facilities/maintenance/:id",
    { preHandler: requirePermission(PERMISSIONS.FACILITIES_VIEW) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const issue = await prisma.maintenanceIssue.findFirst({
        where: { id, deletedAt: null },
        include: {
          reporter: { select: { id: true, firstName: true, lastName: true } },
          assignee: { select: { id: true, firstName: true, lastName: true } },
          photos: { orderBy: { createdAt: "asc" } },
          comments: {
            orderBy: { createdAt: "asc" },
            include: { author: { select: { id: true, firstName: true, lastName: true } } },
          },
        },
      });
      if (!issue) return reply.code(404).send({ error: "Issue not found" });
      return issue;
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  // UPDATE — status transitions, timestamp rules, assignee changes
  // ═══════════════════════════════════════════════════════════════════

  app.put(
    "/facilities/maintenance/:id",
    { preHandler: requirePermission(PERMISSIONS.MANAGE_FACILITIES_MAINTENANCE) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;

      const existing = await prisma.maintenanceIssue.findFirst({
        where: { id, deletedAt: null },
      });
      if (!existing) return reply.code(404).send({ error: "Issue not found" });

      // Validate enum values
      if (body.status && !VALID_STATUSES.includes(body.status as any)) {
        return reply.code(400).send({
          error: `Invalid status: ${body.status}. Valid values: ${VALID_STATUSES.join(", ")}`,
        });
      }
      if (body.priority && !VALID_PRIORITIES.includes(body.priority as any)) {
        return reply.code(400).send({
          error: `Invalid priority: ${body.priority}. Valid values: ${VALID_PRIORITIES.join(", ")}`,
        });
      }

      // Validate status transition
      if (body.status && body.status !== existing.status) {
        if (!isValidTransition(existing.status, body.status as any)) {
          return reply.code(400).send({
            error: `Invalid status transition: ${existing.status} → ${body.status}`,
          });
        }
      }

      // Build update data with timestamp rules
      const data: Record<string, unknown> = {};
      if (body.status) data.status = body.status;
      if (body.assigneeId !== undefined) data.assigneeId = body.assigneeId || null;
      if (body.priority) data.priority = body.priority;
      if (body.rejectionNote) data.rejectionNote = body.rejectionNote;

      // Timestamp rules: set resolvedAt/closedAt on corresponding transitions
      if (body.status === "resolved") {
        data.resolvedAt = new Date();
      } else if (body.status === "in_progress" && existing.status === "resolved") {
        data.resolvedAt = null; // clear on reopen
      }
      if (body.status === "closed") {
        data.closedAt = new Date();
      }

      const updated = await prisma.maintenanceIssue.update({ where: { id }, data });
      await audit("maintenance_issue.update", request.user.sub, "MaintenanceIssue", id, existing, updated);
      return updated;
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  // PHOTOS — upload (max 2 MB, JPEG/PNG, max 10 per issue)
  // ═══════════════════════════════════════════════════════════════════

  app.post(
    "/facilities/maintenance/:id/photos",
    { preHandler: requirePermission(PERMISSIONS.FACILITIES_REPORT) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { data, mimeType, caption } = request.body as {
        data: string;
        mimeType: string;
        caption?: string;
      };

      if (data.length > MAX_PHOTO_SIZE_BYTES) {
        return reply.code(400).send({ error: "Photo exceeds 2 MB limit" });
      }

      if (!["image/jpeg", "image/png"].includes(mimeType)) {
        return reply.code(400).send({ error: "Only JPEG and PNG are accepted" });
      }

      const issue = await prisma.maintenanceIssue.findFirst({ where: { id, deletedAt: null } });
      if (!issue) return reply.code(404).send({ error: "Issue not found" });

      const count = await prisma.maintenancePhoto.count({ where: { issueId: id } });
      if (count >= MAX_PHOTOS_PER_ISSUE) {
        return reply.code(400).send({ error: `Maximum ${MAX_PHOTOS_PER_ISSUE} photos per issue` });
      }

      const photo = await prisma.maintenancePhoto.create({
        data: {
          issueId: id,
          uploadedById: request.user.sub,
          data,
          mimeType,
          caption: caption || null,
        },
      });
      await audit("maintenance_photo.create", request.user.sub, "MaintenancePhoto", photo.id);
      return photo;
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  // PHOTOS — delete (owner or manager)
  // ═══════════════════════════════════════════════════════════════════

  app.delete(
    "/facilities/maintenance/:id/photos/:photoId",
    { preHandler: requirePermission(PERMISSIONS.FACILITIES_REPORT) },
    async (request, reply) => {
      const { photoId } = request.params as { id: string; photoId: string };

      const photo = await prisma.maintenancePhoto.findUnique({ where: { id: photoId } });
      if (!photo) return reply.code(404).send({ error: "Photo not found" });

      const isOwner = photo.uploadedById === request.user.sub;
      const isManager = can(PERMISSIONS.MANAGE_FACILITIES_MAINTENANCE, request.policyCtx!).allowed;
      if (!isOwner && !isManager) {
        return reply.code(403).send({ error: "Not authorized to delete this photo" });
      }

      await prisma.maintenancePhoto.delete({ where: { id: photoId } });
      await audit("maintenance_photo.delete", request.user.sub, "MaintenancePhoto", photoId);
      return { ok: true };
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  // COMMENTS — add comment to issue
  // ═══════════════════════════════════════════════════════════════════

  app.post(
    "/facilities/maintenance/:id/comments",
    { preHandler: requirePermission(PERMISSIONS.FACILITIES_REPORT) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { text } = request.body as { text: string };

      const issue = await prisma.maintenanceIssue.findFirst({ where: { id, deletedAt: null } });
      if (!issue) return reply.code(404).send({ error: "Issue not found" });

      const comment = await prisma.maintenanceComment.create({
        data: { issueId: id, authorId: request.user.sub, text },
        include: { author: { select: { id: true, firstName: true, lastName: true } } },
      });
      await audit("maintenance_comment.create", request.user.sub, "MaintenanceComment", comment.id);
      return comment;
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  // FORWARD TO LDC — escalate issue to LDC committee
  // ═══════════════════════════════════════════════════════════════════

  app.post(
    "/facilities/maintenance/:id/forward-ldc",
    { preHandler: requirePermission(PERMISSIONS.MANAGE_FACILITIES_MAINTENANCE) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { ldcContact } = request.body as { ldcContact?: string };

      const existing = await prisma.maintenanceIssue.findFirst({
        where: { id, deletedAt: null },
      });
      if (!existing) return reply.code(404).send({ error: "Issue not found" });

      if (!isValidTransition(existing.status, "forwarded_to_ldc")) {
        return reply.code(400).send({
          error: `Cannot forward from status: ${existing.status}`,
        });
      }

      const updated = await prisma.maintenanceIssue.update({
        where: { id },
        data: {
          status: "forwarded_to_ldc",
          ldcForwarded: new Date(),
          ldcContact: ldcContact || null,
        },
      });
      await audit("maintenance_issue.forward_ldc", request.user.sub, "MaintenanceIssue", id, existing, updated);
      return updated;
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  // SOFT DELETE
  // ═══════════════════════════════════════════════════════════════════

  app.delete(
    "/facilities/maintenance/:id",
    { preHandler: requirePermission(PERMISSIONS.MANAGE_FACILITIES_MAINTENANCE) },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const existing = await prisma.maintenanceIssue.findFirst({ where: { id, deletedAt: null } });
      if (!existing) return reply.code(404).send({ error: "Issue not found" });

      await prisma.maintenanceIssue.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await audit("maintenance_issue.delete", request.user.sub, "MaintenanceIssue", id);
      return { ok: true };
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  // REPORT — PDF generation
  // ═══════════════════════════════════════════════════════════════════

  app.get(
    "/facilities/maintenance/:id/report",
    { preHandler: requirePermission(PERMISSIONS.MANAGE_FACILITIES_MAINTENANCE) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const issue = await prisma.maintenanceIssue.findFirst({
        where: { id, deletedAt: null },
        include: {
          reporter: { select: { firstName: true, lastName: true } },
          assignee: { select: { firstName: true, lastName: true } },
          photos: true,
          comments: {
            orderBy: { createdAt: "asc" },
            include: { author: { select: { firstName: true, lastName: true } } },
          },
        },
      });
      if (!issue) return reply.code(404).send({ error: "Issue not found" });

      const doc = new PDFDocument({ margin: 50 });
      reply.header("Content-Type", "application/pdf");
      reply.header("Content-Disposition", `attachment; filename="issue-${id}.pdf"`);

      doc.fontSize(20).text("Wartungsmeldung / Maintenance Report", { align: "center" });
      doc.moveDown();
      doc.fontSize(14).text(issue.title);
      doc.moveDown(0.5);
      doc.fontSize(10);
      doc.text(`Kategorie: ${issue.category}`);
      doc.text(`Priorität: ${issue.priority}`);
      doc.text(`Status: ${issue.status}`);
      doc.text(`Standort: ${issue.location || "-"}`);
      doc.text(`Gemeldet von: ${issue.reporter.firstName} ${issue.reporter.lastName}`);
      doc.text(`Zuständig: ${issue.assignee ? `${issue.assignee.firstName} ${issue.assignee.lastName}` : "-"}`);
      doc.text(`Erstellt: ${issue.createdAt.toISOString().split("T")[0]}`);
      doc.moveDown();
      doc.fontSize(12).text("Beschreibung:");
      doc.fontSize(10).text(issue.description);

      if (issue.photos.length > 0) {
        doc.moveDown();
        doc.fontSize(12).text(`Fotos (${issue.photos.length}):`);
        for (const photo of issue.photos) {
          try {
            const buf = Buffer.from(photo.data, "base64");
            doc.image(buf, { width: 300 });
            doc.moveDown(0.5);
          } catch {
            /* skip invalid images */
          }
        }
      }

      if (issue.comments.length > 0) {
        doc.moveDown();
        doc.fontSize(12).text("Kommentare:");
        for (const c of issue.comments) {
          doc.fontSize(10).text(
            `${c.author.firstName} ${c.author.lastName} (${c.createdAt.toISOString().split("T")[0]}): ${c.text}`,
          );
        }
      }

      doc.end();
      return reply.send(doc);
    },
  );
}
