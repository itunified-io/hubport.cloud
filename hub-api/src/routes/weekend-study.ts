/**
 * Weekend study import routes.
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { audit } from "../lib/policy-engine.js";
import {
  previewStudyImport,
  commitStudyImport,
} from "../lib/importers/jw/weekend-study-importer.js";
import { checkStudyAvailability } from "../lib/importers/jw/jw-availability.js";
import prisma from "../lib/prisma.js";

const StudyImportBody = Type.Object({
  language: Type.String({ minLength: 2, maxLength: 10 }),
  issueKey: Type.String({ minLength: 4 }),
});

type StudyImportBodyType = Static<typeof StudyImportBody>;

export async function weekendStudyRoutes(app: FastifyInstance): Promise<void> {
  // List study weeks
  app.get(
    "/weekend-study/weeks",
    { preHandler: requirePermission(PERMISSIONS.WEEKEND_STUDY_VIEW) },
    async () => {
      return prisma.weekendStudyWeek.findMany({
        include: {
          edition: { select: { language: true, issueKey: true } },
          meetings: { select: { id: true, date: true, title: true } },
        },
        orderBy: { weekOf: "desc" },
      });
    },
  );

  // Available study editions (checks JW.org + local DB import status)
  app.get<{ Querystring: { language?: string } }>(
    "/weekend-study/available",
    { preHandler: requirePermission(PERMISSIONS.WEEKEND_STUDY_VIEW) },
    async (request) => {
      const language = (request.query.language as string) || "de";
      const editions = await checkStudyAvailability(language);

      // Enrich with import status from DB
      const imported = await prisma.weekendStudyEdition.findMany({
        where: { language },
        select: { id: true, issueKey: true },
      });
      const importedMap = new Map(imported.map((e) => [e.issueKey, e.id]));

      return editions.map((ed) => ({
        ...ed,
        imported: importedMap.has(ed.issueCode),
        importedEditionId: importedMap.get(ed.issueCode) ?? null,
      }));
    },
  );

  // Preview study import
  app.post<{ Body: StudyImportBodyType }>(
    "/weekend-study/import/preview",
    {
      preHandler: requirePermission(PERMISSIONS.WEEKEND_STUDY_IMPORT),
      schema: { body: StudyImportBody },
    },
    async (request, reply) => {
      try {
        const preview = await previewStudyImport(
          request.body.language,
          request.body.issueKey,
        );
        return preview;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Study import preview failed";
        return reply.code(422).send({ error: message });
      }
    },
  );

  // Commit study import
  app.post<{ Body: StudyImportBodyType }>(
    "/weekend-study/import/commit",
    {
      preHandler: requirePermission(PERMISSIONS.WEEKEND_STUDY_IMPORT),
      schema: { body: StudyImportBody },
    },
    async (request, reply) => {
      try {
        const preview = await previewStudyImport(
          request.body.language,
          request.body.issueKey,
        );

        const actorId = request.user?.sub ?? "unknown";
        const result = await commitStudyImport(preview.edition, actorId);

        await audit(
          "weekend_study.import",
          actorId,
          "WeekendStudyEdition",
          result.editionId,
          null,
          { issueKey: request.body.issueKey, language: request.body.language },
        );

        return reply.code(201).send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Study import failed";
        return reply.code(422).send({ error: message });
      }
    },
  );
}
