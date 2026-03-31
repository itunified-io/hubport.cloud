/**
 * Local OSM feature routes — CRUD for user-managed OSM features.
 * Supports building overrides, streets, POIs, and custom features.
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";

// ─── Schemas ────────────────────────────────────────────────────────

const IdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});
type IdParamsType = Static<typeof IdParams>;

const FeatureBody = Type.Object({
  territoryId: Type.String({ format: "uuid" }),
  osmId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  featureType: Type.Union([
    Type.Literal("building_override"),
    Type.Literal("street"),
    Type.Literal("poi"),
    Type.Literal("custom"),
  ]),
  tags: Type.Optional(Type.Record(Type.String(), Type.Any())),
  geometry: Type.Object({
    type: Type.String(),
    coordinates: Type.Any(),
  }),
  enrichedName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  enrichedType: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
type FeatureBodyType = Static<typeof FeatureBody>;

const FeatureUpdateBody = Type.Object({
  osmId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  featureType: Type.Optional(
    Type.Union([
      Type.Literal("building_override"),
      Type.Literal("street"),
      Type.Literal("poi"),
      Type.Literal("custom"),
    ]),
  ),
  tags: Type.Optional(Type.Record(Type.String(), Type.Any())),
  geometry: Type.Optional(
    Type.Object({
      type: Type.String(),
      coordinates: Type.Any(),
    }),
  ),
  enrichedName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  enrichedType: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
type FeatureUpdateBodyType = Static<typeof FeatureUpdateBody>;

const BboxQuerystring = Type.Object({
  bbox: Type.Optional(Type.String({ description: "minLng,minLat,maxLng,maxLat" })),
  territoryId: Type.Optional(Type.String({ format: "uuid" })),
});
type BboxQuerystringType = Static<typeof BboxQuerystring>;

/** Valid GeoJSON geometry types per RFC 7946. */
const VALID_GEOJSON_TYPES = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
]);

function validateGeoJSONGeometry(
  geometry: unknown,
): { valid: boolean; reason: string | null } {
  if (!geometry || typeof geometry !== "object") {
    return { valid: false, reason: "Geometry must be an object" };
  }

  const geo = geometry as Record<string, unknown>;

  if (!geo.type || typeof geo.type !== "string") {
    return { valid: false, reason: "Geometry must have a 'type' string field" };
  }

  if (!VALID_GEOJSON_TYPES.has(geo.type)) {
    return {
      valid: false,
      reason: `Invalid geometry type '${geo.type}'. Must be one of: ${[...VALID_GEOJSON_TYPES].join(", ")}`,
    };
  }

  if (geo.type === "GeometryCollection") {
    if (!Array.isArray(geo.geometries)) {
      return { valid: false, reason: "GeometryCollection must have 'geometries' array" };
    }
  } else {
    if (geo.coordinates === undefined || geo.coordinates === null) {
      return { valid: false, reason: "Geometry must have 'coordinates'" };
    }
  }

  return { valid: true, reason: null };
}

export async function localOsmRoutes(app: FastifyInstance): Promise<void> {
  // ─── List local OSM features ─────────────────────────────────────
  app.get<{ Querystring: BboxQuerystringType }>(
    "/local-osm",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_VIEW),
      schema: { querystring: BboxQuerystring },
    },
    async (request, reply) => {
      const where: Record<string, unknown> = {};

      if (request.query.territoryId) {
        where.territoryId = request.query.territoryId;
      }

      const features = await prisma.localOsmFeature.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
          territory: { select: { id: true, number: true, name: true } },
        },
      });

      // If bbox is specified, filter in-memory (geometry is stored as JSON, no PostGIS index)
      if (request.query.bbox) {
        const parts = request.query.bbox.split(",").map(Number);
        if (parts.length !== 4 || parts.some((n) => isNaN(n))) {
          return reply.code(400).send({
            error: "Bad Request",
            message: "bbox must be 4 comma-separated numbers: minLng,minLat,maxLng,maxLat",
          });
        }
        const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];

        return features.filter((f) => {
          const geo = f.geometry as { type?: string; coordinates?: number[] | number[][] };
          if (!geo?.coordinates) return true; // Include features without parseable coords

          // For Point geometry, filter by bbox
          if (geo.type === "Point" && Array.isArray(geo.coordinates)) {
            const [lng, lat] = geo.coordinates as [number, number];
            return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
          }

          // For line/polygon geometries, include if any coord is in bbox
          return true;
        });
      }

      return features;
    },
  );

  // ─── Get single local OSM feature ───────────────────────────────
  app.get<{ Params: IdParamsType }>(
    "/local-osm/:id",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_VIEW),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const feature = await prisma.localOsmFeature.findUnique({
        where: { id: request.params.id },
        include: {
          territory: { select: { id: true, number: true, name: true } },
        },
      });

      if (!feature) {
        return reply.code(404).send({ error: "Local OSM feature not found" });
      }

      return feature;
    },
  );

  // ─── Create local OSM feature ───────────────────────────────────
  app.post<{ Body: FeatureBodyType }>(
    "/local-osm",
    {
      preHandler: requirePermission(PERMISSIONS.OSM_REFRESH),
      schema: { body: FeatureBody },
    },
    async (request, reply) => {
      // Validate geometry
      const geoValidation = validateGeoJSONGeometry(request.body.geometry);
      if (!geoValidation.valid) {
        return reply.code(400).send({
          error: "Bad Request",
          message: geoValidation.reason,
        });
      }

      // Verify territory exists
      const territory = await prisma.territory.findUnique({
        where: { id: request.body.territoryId },
      });
      if (!territory) {
        return reply.code(404).send({ error: "Territory not found" });
      }

      const publisherId = request.user?.sub ?? undefined;

      const feature = await prisma.localOsmFeature.create({
        data: {
          territoryId: request.body.territoryId,
          osmId: request.body.osmId ?? null,
          featureType: request.body.featureType,
          tags: (request.body.tags as object) ?? {},
          geometry: request.body.geometry as object,
          enrichedName: request.body.enrichedName ?? null,
          enrichedType: request.body.enrichedType ?? null,
          createdBy: publisherId,
          updatedBy: publisherId,
        },
      });

      return reply.code(201).send(feature);
    },
  );

  // ─── Update local OSM feature ───────────────────────────────────
  app.put<{ Params: IdParamsType; Body: FeatureUpdateBodyType }>(
    "/local-osm/:id",
    {
      preHandler: requirePermission(PERMISSIONS.OSM_REFRESH),
      schema: { params: IdParams, body: FeatureUpdateBody },
    },
    async (request, reply) => {
      const existing = await prisma.localOsmFeature.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Local OSM feature not found" });
      }

      // Validate geometry if provided
      if (request.body.geometry) {
        const geoValidation = validateGeoJSONGeometry(request.body.geometry);
        if (!geoValidation.valid) {
          return reply.code(400).send({
            error: "Bad Request",
            message: geoValidation.reason,
          });
        }
      }

      const publisherId = request.user?.sub ?? undefined;

      const updated = await prisma.localOsmFeature.update({
        where: { id: request.params.id },
        data: {
          ...(request.body.osmId !== undefined ? { osmId: request.body.osmId } : {}),
          ...(request.body.featureType ? { featureType: request.body.featureType } : {}),
          ...(request.body.tags ? { tags: request.body.tags as object } : {}),
          ...(request.body.geometry ? { geometry: request.body.geometry as object } : {}),
          ...(request.body.enrichedName !== undefined ? { enrichedName: request.body.enrichedName } : {}),
          ...(request.body.enrichedType !== undefined ? { enrichedType: request.body.enrichedType } : {}),
          updatedBy: publisherId,
        },
      });

      return updated;
    },
  );

  // ─── Delete local OSM feature ───────────────────────────────────
  app.delete<{ Params: IdParamsType }>(
    "/local-osm/:id",
    {
      preHandler: requirePermission(PERMISSIONS.OSM_REFRESH),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const existing = await prisma.localOsmFeature.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Local OSM feature not found" });
      }

      await prisma.localOsmFeature.delete({
        where: { id: request.params.id },
      });

      return reply.code(204).send();
    },
  );
}
