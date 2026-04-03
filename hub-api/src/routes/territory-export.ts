/**
 * Territory export routes — PDF map generation via Puppeteer.
 */
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import archiver from "archiver";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { renderTerritoryPdfs } from "../lib/pdf-renderer.js";

const ExportPdfBody = Type.Object({
  territoryIds: Type.Array(Type.String({ format: "uuid" }), { minItems: 1, maxItems: 100 }),
  styles: Type.Optional(
    Type.Array(Type.Union([Type.Literal("satellite"), Type.Literal("street")])),
  ),
});
type ExportPdfBodyType = Static<typeof ExportPdfBody>;

export async function territoryExportRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ExportPdfBodyType }>(
    "/territories/export/pdf",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_EXPORT),
      schema: { body: ExportPdfBody },
    },
    async (request, reply) => {
      const { territoryIds, styles: reqStyles } = request.body;
      const styles = reqStyles?.length ? reqStyles : (["satellite", "street"] as const);

      // Load territories
      const territories = await prisma.territory.findMany({
        where: { id: { in: territoryIds } },
        select: { id: true, number: true, name: true, boundaries: true },
      });

      if (territories.length === 0) {
        return reply.code(404).send({ error: "No territories found" });
      }

      // Filter to those with boundaries
      const withBoundaries = territories.filter((t) => t.boundaries);
      if (withBoundaries.length === 0) {
        return reply.code(400).send({ error: "No selected territories have boundaries" });
      }

      const apiKey = process.env.MAPTILER_API_KEY;
      if (!apiKey) {
        return reply.code(500).send({ error: "MAPTILER_API_KEY not configured" });
      }

      const { files, errors } = await renderTerritoryPdfs(
        withBoundaries.map((t) => ({
          number: t.number,
          name: t.name,
          boundaries: t.boundaries,
        })),
        [...styles],
        apiKey,
        request.log,
      );

      if (files.length === 0) {
        return reply.code(500).send({ error: "All PDF renders failed", details: errors });
      }

      // Build ZIP
      const date = new Date().toISOString().slice(0, 10);
      const zipName = withBoundaries.length === 1
        ? `T-${withBoundaries[0]!.number}-maps.zip`
        : `territories-maps-${date}.zip`;

      reply.header("Content-Type", "application/zip");
      reply.header("Content-Disposition", `attachment; filename="${zipName}"`);

      const archive = archiver("zip", { zlib: { level: 6 } });
      archive.pipe(reply.raw);

      for (const f of files) {
        archive.append(f.buffer, { name: f.filename });
      }

      if (errors.length > 0) {
        archive.append(errors.join("\n"), { name: "_errors.txt" });
      }

      await archive.finalize();
      return reply;
    },
  );
}
