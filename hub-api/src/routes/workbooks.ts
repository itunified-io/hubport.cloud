/**
 * Workbook import routes — server-side JW.org workbook ingestion.
 * Guards: permission-based (not legacy requireRole).
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { audit } from "../lib/policy-engine.js";
import {
  previewWorkbookImport,
  commitWorkbookImport,
} from "../lib/importers/jw/midweek-workbook-importer.js";
import { checkWorkbookAvailability } from "../lib/importers/jw/jw-availability.js";
import prisma from "../lib/prisma.js";

const ImportPreviewBody = Type.Object({
  language: Type.String({ minLength: 2, maxLength: 10 }),
  yearMonth: Type.String({ pattern: "^\\d{4}-\\d{2}$" }),
});

type ImportPreviewBodyType = Static<typeof ImportPreviewBody>;

const IdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});

type IdParamsType = Static<typeof IdParams>;

export async function workbookRoutes(app: FastifyInstance): Promise<void> {
  // Check which workbook editions are available on JW.org
  app.get(
    "/workbooks/available",
    { preHandler: requirePermission(PERMISSIONS.MEETINGS_VIEW) },
    async (request) => {
      const { language } = request.query as { language?: string };
      const lang = language ?? "de";

      // Get already-imported editions for comparison
      const imported = await prisma.workbookEdition.findMany({
        where: { language: lang },
        select: { yearMonth: true, id: true },
      });
      const importedMap = new Map(imported.map((e) => [e.yearMonth, e.id]));

      const available = await checkWorkbookAvailability(lang);

      return available.map((edition) => ({
        ...edition,
        imported: importedMap.has(edition.yearMonth),
        importedEditionId: importedMap.get(edition.yearMonth) ?? null,
      }));
    },
  );

  // List imported workbook editions
  app.get(
    "/workbooks/editions",
    { preHandler: requirePermission(PERMISSIONS.WORKBOOKS_VIEW) },
    async () => {
      return prisma.workbookEdition.findMany({
        include: { weeks: { orderBy: { sortOrder: "asc" } } },
        orderBy: { yearMonth: "desc" },
      });
    },
  );

  // Get a specific workbook edition with weeks and parts
  app.get<{ Params: IdParamsType }>(
    "/workbooks/:id",
    {
      preHandler: requirePermission(PERMISSIONS.WORKBOOKS_VIEW),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const edition = await prisma.workbookEdition.findUnique({
        where: { id: request.params.id },
        include: {
          weeks: {
            include: { parts: { orderBy: { sortOrder: "asc" } } },
            orderBy: { sortOrder: "asc" },
          },
        },
      });
      if (!edition) {
        return reply.code(404).send({ error: "Edition not found" });
      }
      return edition;
    },
  );

  // Preview workbook import (fetch + parse, no persist)
  app.post<{ Body: ImportPreviewBodyType }>(
    "/workbooks/import/preview",
    {
      preHandler: requirePermission(PERMISSIONS.WORKBOOKS_IMPORT),
      schema: { body: ImportPreviewBody },
    },
    async (request, reply) => {
      try {
        const preview = await previewWorkbookImport(
          request.body.language,
          request.body.yearMonth,
        );
        return preview;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Import preview failed";
        return reply.code(422).send({ error: message });
      }
    },
  );

  // Commit workbook import (persist + create period + seed meetings)
  app.post<{ Body: ImportPreviewBodyType }>(
    "/workbooks/import/commit",
    {
      preHandler: requirePermission(PERMISSIONS.WORKBOOKS_IMPORT),
      schema: { body: ImportPreviewBody },
    },
    async (request, reply) => {
      try {
        const preview = await previewWorkbookImport(
          request.body.language,
          request.body.yearMonth,
        );

        // Check for published period that would be overwritten
        if (preview.existingEditionId) {
          const existingPeriod = await prisma.meetingPeriod.findFirst({
            where: {
              sourceEditionId: preview.existingEditionId,
              status: { in: ["published", "locked"] },
            },
          });
          if (existingPeriod) {
            return reply.code(409).send({
              error: "Cannot reimport — existing period is published/locked",
              periodId: existingPeriod.id,
              periodStatus: existingPeriod.status,
            });
          }
        }

        const actorId = request.user?.sub ?? "unknown";
        const result = await commitWorkbookImport(preview.edition, actorId);

        await audit(
          "workbook.import",
          actorId,
          "WorkbookEdition",
          result.editionId,
          null,
          { yearMonth: request.body.yearMonth, language: request.body.language },
        );

        return reply.code(201).send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Import commit failed";
        return reply.code(422).send({ error: message });
      }
    },
  );
}
