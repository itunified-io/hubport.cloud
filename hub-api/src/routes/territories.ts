import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission, requireAnyPermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import {
  queryRoadsInBBox,
  queryBuildingsInBBox,
  queryWaterBodiesInBBox,
} from "../lib/osm-overpass.js";

const TerritoryBody = Type.Object({
  number: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
  boundaries: Type.Optional(Type.Any()),
});

type TerritoryBodyType = Static<typeof TerritoryBody>;

const IdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});

type IdParamsType = Static<typeof IdParams>;

const AssignBody = Type.Object({
  publisherId: Type.String({ format: "uuid" }),
});

type AssignBodyType = Static<typeof AssignBody>;

export async function territoryRoutes(app: FastifyInstance): Promise<void> {
  // List all territories — requires territories.view
  // ?lite=true excludes boundaries for faster loading (list/board views)
  // ?type=all includes congregation_boundary records (default: territory only)
  app.get<{ Querystring: { lite?: string; type?: string } }>(
    "/territories",
    { preHandler: requirePermission(PERMISSIONS.TERRITORIES_VIEW) },
    async (request) => {
      const lite = request.query.lite === "true";
      const typeFilter = request.query.type === "all"
        ? undefined
        : request.query.type === "congregation_boundary"
          ? "congregation_boundary"
          : "territory";
      const territories = await prisma.territory.findMany({
        where: typeFilter ? { type: typeFilter } : undefined,
        orderBy: { number: "asc" },
        select: lite
          ? {
              id: true,
              number: true,
              name: true,
              description: true,
              type: true,
              createdAt: true,
              updatedAt: true,
              assignments: {
                where: { returnedAt: null },
                include: { publisher: true },
              },
            }
          : undefined,
        include: lite
          ? undefined
          : {
              assignments: {
                where: { returnedAt: null },
                include: { publisher: true },
              },
            },
      });
      return territories;
    },
  );

  // Get one territory with full assignment history — requires territories.view
  app.get<{ Params: IdParamsType }>(
    "/territories/:id",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_VIEW),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const territory = await prisma.territory.findUnique({
        where: { id: request.params.id },
        include: {
          assignments: {
            include: { publisher: true },
            orderBy: { assignedAt: "desc" },
          },
        },
      });
      if (!territory) {
        return reply.code(404).send({ error: "Not found" });
      }
      return territory;
    },
  );

  // Create territory — requires territories.edit
  app.post<{ Body: TerritoryBodyType }>(
    "/territories",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_EDIT),
      schema: { body: TerritoryBody },
    },
    async (request, reply) => {
      const territory = await prisma.territory.create({
        data: request.body,
      });
      return reply.code(201).send(territory);
    },
  );

  // Update territory — requires territories.edit
  app.put<{ Params: IdParamsType; Body: TerritoryBodyType }>(
    "/territories/:id",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_EDIT),
      schema: { params: IdParams, body: TerritoryBody },
    },
    async (request, reply) => {
      const existing = await prisma.territory.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Not found" });
      }
      const territory = await prisma.territory.update({
        where: { id: request.params.id },
        data: request.body,
      });
      return territory;
    },
  );

  // Delete territory — requires territories.delete
  app.delete<{ Params: IdParamsType }>(
    "/territories/:id",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_DELETE),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const existing = await prisma.territory.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Not found" });
      }
      await prisma.territory.delete({
        where: { id: request.params.id },
      });
      return reply.code(204).send();
    },
  );

  // Assign territory to publisher — requires assignments.manage or campaigns.assist
  app.post<{ Params: IdParamsType; Body: AssignBodyType }>(
    "/territories/:id/assign",
    {
      preHandler: requireAnyPermission(PERMISSIONS.ASSIGNMENTS_MANAGE, PERMISSIONS.CAMPAIGNS_ASSIST),
      schema: { params: IdParams, body: AssignBody },
    },
    async (request, reply) => {
      const territory = await prisma.territory.findUnique({
        where: { id: request.params.id },
      });
      if (!territory) {
        return reply.code(404).send({ error: "Territory not found" });
      }

      const publisher = await prisma.publisher.findUnique({
        where: { id: request.body.publisherId },
      });
      if (!publisher) {
        return reply.code(404).send({ error: "Publisher not found" });
      }

      // Check if territory is already assigned (no returnedAt)
      const active = await prisma.territoryAssignment.findFirst({
        where: { territoryId: request.params.id, returnedAt: null },
      });
      if (active) {
        return reply.code(409).send({
          error: "Conflict",
          message: "Territory is already assigned. Return it first.",
        });
      }

      const assignment = await prisma.territoryAssignment.create({
        data: {
          territoryId: request.params.id,
          publisherId: request.body.publisherId,
        },
        include: { publisher: true, territory: true },
      });
      return reply.code(201).send(assignment);
    },
  );

  // Return territory — requires assignments.manage
  app.post<{ Params: IdParamsType }>(
    "/territories/:id/return",
    {
      preHandler: requirePermission(PERMISSIONS.ASSIGNMENTS_MANAGE),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const active = await prisma.territoryAssignment.findFirst({
        where: { territoryId: request.params.id, returnedAt: null },
      });
      if (!active) {
        return reply.code(404).send({
          error: "Not found",
          message: "No active assignment for this territory",
        });
      }

      const assignment = await prisma.territoryAssignment.update({
        where: { id: active.id },
        data: { returnedAt: new Date() },
        include: { publisher: true, territory: true },
      });
      return assignment;
    },
  );

  // Snap context — returns combined GeoJSON for snap targets (roads, buildings, water)
  app.get<{ Querystring: { bbox: string } }>(
    "/territories/snap-context",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_VIEW),
      schema: {
        querystring: Type.Object({
          bbox: Type.String({
            description: "Bounding box: minLng,minLat,maxLng,maxLat",
          }),
        }),
      },
    },
    async (request, reply) => {
      const { bbox } = request.query;
      const parts = bbox.split(",").map(Number);

      if (
        parts.length !== 4 ||
        parts.some((n) => isNaN(n))
      ) {
        return reply.code(400).send({
          error: "Bad Request",
          message:
            "bbox must be 4 comma-separated numbers: minLng,minLat,maxLng,maxLat",
        });
      }

      const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];

      // Validate coordinate ranges
      if (
        minLat < -90 || minLat > 90 ||
        maxLat < -90 || maxLat > 90 ||
        minLng < -180 || minLng > 180 ||
        maxLng < -180 || maxLng > 180
      ) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "Coordinates out of valid range",
        });
      }

      // Fetch roads, buildings, water in parallel from Overpass
      const [roads, buildings, waterBodies] = await Promise.all([
        queryRoadsInBBox(minLat, minLng, maxLat, maxLng),
        queryBuildingsInBBox(minLat, minLng, maxLat, maxLng),
        queryWaterBodiesInBBox(minLat, minLng, maxLat, maxLng),
      ]);

      // Combine into a single GeoJSON FeatureCollection
      const features: object[] = [];

      for (const road of roads) {
        features.push({
          type: "Feature",
          properties: {
            snapType: "road",
            osmId: road.osmId,
            highway: road.highway,
            name: road.name,
          },
          geometry: road.geometry,
        });
      }

      for (const building of buildings) {
        features.push({
          type: "Feature",
          properties: {
            snapType: "building",
            osmId: building.osmId,
            buildingType: building.buildingType,
            streetAddress: building.streetAddress,
          },
          geometry: {
            type: "Point",
            coordinates: [building.lng, building.lat],
          },
        });
      }

      for (const water of waterBodies) {
        features.push({
          type: "Feature",
          properties: {
            snapType: "water",
            osmId: water.osmId,
            waterType: water.waterType,
            name: water.name,
          },
          geometry: water.geometry,
        });
      }

      // Include local streets from LocalOsmFeature table
      const localStreets = await prisma.localOsmFeature.findMany({
        where: { featureType: "street" },
      });

      for (const ls of localStreets) {
        const geo = ls.geometry as { type?: string; coordinates?: unknown };
        if (!geo?.type) continue;

        // Filter by bbox for Point/LineString geometries
        if (geo.type === "Point" && Array.isArray(geo.coordinates)) {
          const [lng, lat] = geo.coordinates as [number, number];
          if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
        }

        features.push({
          type: "Feature",
          properties: {
            snapType: "local_street",
            osmId: ls.osmId,
            name: ls.enrichedName ?? (ls.tags as Record<string, string>)?.name ?? null,
            featureId: ls.id,
          },
          geometry: geo,
        });
      }

      return {
        type: "FeatureCollection",
        features,
      };
    },
  );
}
