/**
 * Gap resolution routes — smart analysis and resolution of uncovered
 * areas between territory polygons.
 *
 * GET  /territories/gap-analysis  — analyze gaps with building counts
 * POST /territories/gap-resolve   — create territory or expand neighbors
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import prisma from "../lib/prisma.js";
import {
  runGapAnalysis,
  resolveGapNewTerritory,
  resolveGapExpandNeighbors,
} from "../lib/gap-analysis.js";

// ─── Schemas ────────────────────────────────────────────────────────

const GapAnalysisQuery = Type.Object({
  minResidentialBuildings: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 8 })),
  minAreaM2: Type.Optional(Type.Number({ minimum: 100, maximum: 1_000_000, default: 5000 })),
});
type GapAnalysisQueryType = Static<typeof GapAnalysisQuery>;

const GapResolveBody = Type.Object({
  gapPolygon: Type.Object({
    type: Type.String(),
    coordinates: Type.Array(Type.Unknown()),
  }),
  action: Type.Union([Type.Literal("new_territory"), Type.Literal("expand_neighbors")]),
  newTerritoryName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  newTerritoryNumber: Type.Optional(Type.String({ minLength: 1, maxLength: 10 })),
  neighborAssignments: Type.Optional(
    Type.Array(
      Type.Object({
        territoryId: Type.String({ format: "uuid" }),
        buildingCoords: Type.Array(
          Type.Tuple([Type.Number(), Type.Number()]),
          { minItems: 1, maxItems: 500 },
        ),
      }),
      { minItems: 1, maxItems: 6 },
    ),
  ),
});
type GapResolveBodyType = Static<typeof GapResolveBody>;

// ─── Routes ──────────────────────────────────────────────────────────

export async function gapResolutionRoutes(app: FastifyInstance): Promise<void> {
  // ─── Analyze gaps ─────────────────────────────────────────────────
  app.get(
    "/territories/gap-analysis",
    {
      preHandler: requirePermission(PERMISSIONS.GAP_DETECTION_RUN),
      schema: { querystring: GapAnalysisQuery },
    },
    async (request, reply) => {
      const query = request.query as GapAnalysisQueryType;

      try {
        const result = await runGapAnalysis(prisma, {
          minResidentialBuildings: query.minResidentialBuildings,
          minAreaM2: query.minAreaM2,
        });

        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        // No congregation boundary
        if (msg.includes("congregation")) {
          return reply.code(400).send({
            error: "No congregation boundary found. Import a branch territory assignment (KML) first.",
          });
        }

        // PostGIS missing
        if (msg.includes("does not exist") && (msg.includes("st_") || msg.includes("postgis"))) {
          return reply.code(501).send({
            error: "PostGIS extension is not available. Gap analysis requires PostGIS.",
          });
        }

        // Overpass failure
        if (msg.includes("Overpass")) {
          return reply.code(502).send({
            error: `Overpass API failed: ${msg}`,
          });
        }

        throw err;
      }
    },
  );

  // ─── Resolve a gap ────────────────────────────────────────────────
  app.post(
    "/territories/gap-resolve",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_EDIT),
      schema: { body: GapResolveBody },
    },
    async (request, reply) => {
      const body = request.body as GapResolveBodyType;

      try {
        if (body.action === "new_territory") {
          if (!body.newTerritoryName || !body.newTerritoryNumber) {
            return reply.code(400).send({
              error: "newTerritoryName and newTerritoryNumber are required for new_territory action.",
            });
          }

          const result = await resolveGapNewTerritory(
            prisma,
            body.gapPolygon,
            body.newTerritoryName,
            body.newTerritoryNumber,
          );

          return {
            success: true,
            action: "new_territory",
            ...result,
          };
        }

        if (body.action === "expand_neighbors") {
          if (!body.neighborAssignments || body.neighborAssignments.length === 0) {
            return reply.code(400).send({
              error: "neighborAssignments are required for expand_neighbors action.",
            });
          }

          const result = await resolveGapExpandNeighbors(prisma, body.neighborAssignments);

          return {
            success: true,
            action: "expand_neighbors",
            ...result,
          };
        }

        return reply.code(400).send({ error: "Invalid action" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        if (msg.includes("does not exist") && (msg.includes("st_") || msg.includes("postgis"))) {
          return reply.code(501).send({ error: "PostGIS extension is not available." });
        }

        app.log.error(err, "Gap resolution failed");
        return reply.code(500).send({ error: "Gap resolution failed. Please try again." });
      }
    },
  );
}
