/**
 * Smart Resolve routes — building-centric analysis and resolution
 * of uncovered residential buildings.
 *
 * GET  /territories/gap-analysis  — find uncovered residential buildings, cluster by nearest territory
 * POST /territories/gap-resolve   — expand territory to include buildings
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import prisma from "../lib/prisma.js";
import {
  runSmartResolveAnalysis,
  resolveClusterExpand,
} from "../lib/gap-analysis.js";

// ─── Schemas ────────────────────────────────────────────────────────

const AnalysisQuery = Type.Object({
  maxDistanceM: Type.Optional(Type.Number({ minimum: 10, maximum: 1000, default: 200 })),
});
type AnalysisQueryType = Static<typeof AnalysisQuery>;

const ResolveBody = Type.Object({
  action: Type.Literal("expand_cluster"),
  territoryId: Type.String({ format: "uuid" }),
  buildingCoords: Type.Array(
    Type.Tuple([Type.Number(), Type.Number()]),
    { minItems: 1, maxItems: 500 },
  ),
});
type ResolveBodyType = Static<typeof ResolveBody>;

// ─── Routes ──────────────────────────────────────────────────────────

export async function gapResolutionRoutes(app: FastifyInstance): Promise<void> {
  // ─── Analyze uncovered buildings ─────────────────────────────────
  app.get(
    "/territories/gap-analysis",
    {
      preHandler: requirePermission(PERMISSIONS.GAP_DETECTION_RUN),
      schema: { querystring: AnalysisQuery },
    },
    async (request, reply) => {
      const query = request.query as AnalysisQueryType;

      try {
        const result = await runSmartResolveAnalysis(prisma, {
          maxDistanceM: query.maxDistanceM,
        });

        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        if (msg.includes("does not exist") && (msg.includes("st_") || msg.includes("postgis"))) {
          return reply.code(501).send({
            error: "PostGIS extension is not available. Smart Resolve requires PostGIS.",
          });
        }

        throw err;
      }
    },
  );

  // ─── Resolve: expand territory to include buildings ──────────────
  app.post(
    "/territories/gap-resolve",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_EDIT),
      schema: { body: ResolveBody },
    },
    async (request, reply) => {
      const body = request.body as ResolveBodyType;

      try {
        app.log.info(
          { territoryId: body.territoryId, buildingCount: body.buildingCoords.length },
          "[smart-resolve] expand_cluster request",
        );

        const result = await resolveClusterExpand(
          prisma,
          body.territoryId,
          body.buildingCoords,
        );

        app.log.info(
          { territoryId: result.territoryId, number: result.number, autoFix: result.autoFixApplied },
          "[smart-resolve] expand_cluster result",
        );

        return {
          success: true,
          action: "expand_cluster",
          ...result,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        if (msg.includes("does not exist") && (msg.includes("st_") || msg.includes("postgis"))) {
          return reply.code(501).send({ error: "PostGIS extension is not available." });
        }

        app.log.error(err, "Smart resolve failed");
        return reply.code(500).send({ error: "Smart resolve failed. Please try again." });
      }
    },
  );
}
