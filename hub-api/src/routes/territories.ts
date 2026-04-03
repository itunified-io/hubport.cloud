import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission, requireAnyPermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { runAutoFixPipeline, clipToCongregation, clipToNeighbors, detectOverlaps, type AutoFixResult, type OverlapInfo } from "../lib/postgis-helpers.js";
import {
  queryRoadsInBBox,
  queryBuildingsInBBox,
  queryWaterBodiesInBBox,
} from "../lib/osm-overpass.js";
import { reverseGeocode } from "../lib/osm-nominatim.js";

const TerritoryBody = Type.Object({
  number: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
  boundaries: Type.Optional(Type.Any()),
});

type TerritoryBodyType = Static<typeof TerritoryBody>;

const TerritoryUpdateBody = Type.Object({
  number: Type.Optional(Type.String({ minLength: 1 })),
  name: Type.Optional(Type.String({ minLength: 1 })),
  description: Type.Optional(Type.String()),
  boundaries: Type.Optional(Type.Any()),
});

type TerritoryUpdateBodyType = Static<typeof TerritoryUpdateBody>;

const IdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});

type IdParamsType = Static<typeof IdParams>;

/** Check if an error is a missing PostGIS extension */
function isPostgisMissing(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("does not exist") && (msg.includes("st_") || msg.includes("postgis"));
}

const AssignBody = Type.Object({
  publisherId: Type.String({ format: "uuid" }),
});

type AssignBodyType = Static<typeof AssignBody>;

const BulkFixBody = Type.Object({
  territoryIds: Type.Array(Type.String({ format: "uuid" }), { minItems: 1, maxItems: 50 }),
});
type BulkFixBodyType = Static<typeof BulkFixBody>;

async function createBoundaryVersion(
  territoryId: string,
  boundaries: object,
  changeType: string,
  changeSummary?: string
) {
  const lastVersion = await prisma.territoryBoundaryVersion.findFirst({
    where: { territoryId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const nextVersion = (lastVersion?.version ?? 0) + 1;

  await prisma.territoryBoundaryVersion.create({
    data: {
      territoryId,
      version: nextVersion,
      boundaries: boundaries as any,
      changeType,
      changeSummary,
    },
  });

  return nextVersion;
}

/**
 * Given a drawn polygon, reverse-geocode centroid to get city name,
 * then find the territory number group for that city and suggest next number.
 */
export async function suggestFromBoundaries(
  prismaClient: typeof prisma,
  boundaries: { type: string; coordinates: number[][][] },
): Promise<{
  city: string | null;
  suggestedPrefix: string;
  suggestedNumber: string;
  existingInGroup: string[];
}> {
  // 1. Compute centroid from polygon exterior ring
  const ring = boundaries.coordinates[0] ?? [];
  const verts =
    ring.length > 1 &&
    ring[0]![0] === ring[ring.length - 1]![0] &&
    ring[0]![1] === ring[ring.length - 1]![1]
      ? ring.slice(0, -1)
      : ring;
  let cx = 0,
    cy = 0;
  for (const v of verts) {
    cx += v[0]!;
    cy += v[1]!;
  }
  cx /= verts.length || 1;
  cy /= verts.length || 1;

  // 2. Reverse geocode centroid via Nominatim
  let city: string | null = null;
  try {
    const result = await reverseGeocode(cy, cx); // lat, lng
    city = result?.address?.city ?? null;
  } catch {
    // Nominatim unavailable — city stays null
  }

  // 3. Fetch all territories to find groups
  const allTerritories = await prismaClient.territory.findMany({
    select: { number: true, name: true },
  });

  // 4. Find group prefix for this city
  const usedPrefixes = new Map<string, string>(); // prefix -> city name
  for (const t of allTerritories) {
    const prefix = (t.number as string).charAt(0);
    if (prefix >= "1" && prefix <= "9") {
      const existing = usedPrefixes.get(prefix);
      if (!existing) usedPrefixes.set(prefix, t.name as string);
    }
  }

  let suggestedPrefix: string;
  if (city) {
    // Find if city already has a prefix
    const existingPrefix = [...usedPrefixes.entries()].find(
      ([, name]) => name.toLowerCase() === city!.toLowerCase(),
    );
    if (existingPrefix) {
      suggestedPrefix = existingPrefix[0];
    } else {
      suggestedPrefix = "1";
      for (let i = 1; i <= 9; i++) {
        if (!usedPrefixes.has(String(i))) {
          suggestedPrefix = String(i);
          break;
        }
      }
    }
  } else {
    suggestedPrefix = "1";
    for (let i = 1; i <= 9; i++) {
      if (!usedPrefixes.has(String(i))) {
        suggestedPrefix = String(i);
        break;
      }
    }
  }

  // 5. Find existing numbers in this group and suggest next
  const groupNumbers = allTerritories
    .filter((t) => (t.number as string).startsWith(suggestedPrefix))
    .map((t) => t.number as string)
    .sort();

  let suggestedNumber = `${suggestedPrefix}01`;
  for (let i = 1; i <= 99; i++) {
    const candidate = `${suggestedPrefix}${String(i).padStart(2, "0")}`;
    if (!groupNumbers.includes(candidate)) {
      suggestedNumber = candidate;
      break;
    }
  }

  return { city, suggestedPrefix, suggestedNumber, existingInGroup: groupNumbers };
}

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

  // Detect violations across all territories for map badges
  app.get(
    "/territories/violations",
    { preHandler: [requirePermission(PERMISSIONS.TERRITORIES_VIEW)] },
    async (_request, reply) => {
      try {
        const territories = await prisma.territory.findMany({
          where: { type: "territory", boundaries: { not: { equals: null } } },
          select: { id: true, number: true, name: true, boundaries: true },
        });

        const congregation = await prisma.territory.findFirst({
          where: { type: "congregation_boundary", boundaries: { not: { equals: null } } },
          select: { boundaries: true },
        });

        const violations: Array<{
          territoryId: string;
          number: string;
          name: string;
          violations: string[];
        }> = [];

        for (const territory of territories) {
          const territoryViolations: string[] = [];

          // Check congregation boundary violation (with 1 m² tolerance for floating-point artifacts)
          if (congregation?.boundaries) {
            const exceedsResult = await prisma.$queryRaw<Array<{ exceeds_area: number }>>`
              SELECT ST_Area(ST_Difference(
                ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(territory.boundaries)})),
                ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(congregation.boundaries)}))
              )::geography) as exceeds_area
            `;
            if ((exceedsResult[0]?.exceeds_area ?? 0) > 1.0) {
              territoryViolations.push("exceeds_boundary");
            }
          }

          // Check neighbor overlaps
          const overlaps = await detectOverlaps(
            prisma,
            territory.boundaries as object,
            territory.id
          );
          for (const overlap of overlaps) {
            territoryViolations.push(`overlaps_${overlap.number}`);
          }

          if (territoryViolations.length > 0) {
            violations.push({
              territoryId: territory.id,
              number: territory.number,
              name: territory.name,
              violations: territoryViolations,
            });
          }
        }

        return reply.send(violations);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("does not exist") || msg.includes("postgis")) {
          _request.log.warn("PostGIS not available — skipping violation detection");
          return reply.send([]);
        }
        throw err;
      }
    }
  );

  // Preview auto-fix for new territory (no ID to exclude)
  app.post<{ Body: { boundaries: unknown } }>(
    "/territories/preview-fix",
    { preHandler: [requirePermission(PERMISSIONS.TERRITORIES_EDIT)] },
    async (request, reply) => {
      const { boundaries } = request.body;
      if (!boundaries) {
        return reply.code(400).send({ error: "boundaries required" });
      }
      try {
        const result = await runAutoFixPipeline(prisma, boundaries as object, null);
        return reply.send(result);
      } catch (err: any) {
        if (err.statusCode === 422) {
          return reply.code(422).send({ error: err.message });
        }
        if (isPostgisMissing(err)) {
          return reply.send({ original: boundaries, clipped: boundaries, applied: [], overlaps: [], geometryModified: false });
        }
        throw err;
      }
    }
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
      const data = request.body;
      let autoFix: AutoFixResult | undefined;

      if (data.boundaries) {
        try {
          autoFix = await runAutoFixPipeline(prisma, data.boundaries as object, null);
          data.boundaries = autoFix.clipped;
        } catch (err: any) {
          if (err.statusCode === 422) {
            return reply.code(422).send({ error: err.message });
          }
          if (!isPostgisMissing(err)) throw err;
          // PostGIS not available — save boundaries as-is
        }
      }

      const territory = await prisma.territory.create({
        data: data as any,
      });

      // Create v1 if boundaries were provided
      if (data.boundaries) {
        const changeSummary = autoFix?.applied.length
          ? autoFix.applied.join("; ")
          : undefined;
        await createBoundaryVersion(
          territory.id,
          data.boundaries as object,
          "creation",
          changeSummary
        );
      }

      return reply.code(201).send({ ...territory, autoFix });
    },
  );

  // Suggest territory number + city from drawn polygon
  app.post<{ Body: { boundaries: unknown } }>(
    "/territories/suggest",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_EDIT),
      schema: {
        body: Type.Object({
          boundaries: Type.Any(),
        }),
      },
    },
    async (request, reply) => {
      const { boundaries } = request.body;
      if (!boundaries || typeof boundaries !== "object") {
        return reply.code(400).send({ error: "boundaries required" });
      }

      const geo = boundaries as { type?: string; coordinates?: number[][][] };
      if (geo.type !== "Polygon" || !geo.coordinates?.length) {
        return reply.code(400).send({ error: "boundaries must be a GeoJSON Polygon" });
      }

      try {
        const suggestion = await suggestFromBoundaries(prisma, geo as any);

        // Optionally run auto-fix
        let autoFix = null;
        try {
          autoFix = await runAutoFixPipeline(prisma, boundaries as object, null);
        } catch {
          // auto-fix failure is non-fatal for suggest
        }

        return reply.send({ ...suggestion, autoFix });
      } catch (err: any) {
        request.log.error(err, "suggest failed");
        return reply.code(500).send({ error: "Suggest failed" });
      }
    },
  );

  // Preview auto-fix without saving (dry run)
  app.post<{ Params: { id: string }; Body: { boundaries: unknown } }>(
    "/territories/:id/preview-fix",
    { preHandler: [requirePermission(PERMISSIONS.TERRITORIES_EDIT)] },
    async (request, reply) => {
      const { id } = request.params;
      const { boundaries } = request.body;
      if (!boundaries) {
        return reply.code(400).send({ error: "boundaries required" });
      }
      try {
        const result = await runAutoFixPipeline(prisma, boundaries as object, id);
        return reply.send(result);
      } catch (err: any) {
        if (err.statusCode === 422) {
          return reply.code(422).send({ error: err.message });
        }
        if (isPostgisMissing(err)) {
          return reply.send({ original: boundaries, clipped: boundaries, applied: [], overlaps: [], geometryModified: false });
        }
        throw err;
      }
    }
  );

  // List boundary versions (without full boundaries JSON)
  app.get<{ Params: { id: string } }>(
    "/territories/:id/versions",
    { preHandler: [requirePermission(PERMISSIONS.TERRITORIES_VIEW)] },
    async (request, reply) => {
      const { id } = request.params;
      const versions = await prisma.territoryBoundaryVersion.findMany({
        where: { territoryId: id },
        select: {
          id: true,
          version: true,
          changeType: true,
          changeSummary: true,
          createdAt: true,
        },
        orderBy: { version: "desc" },
      });
      return reply.send(versions);
    }
  );

  // Preview restoring a previous version (dry run — no DB write)
  app.post<{ Params: { id: string }; Body: { versionId: string } }>(
    "/territories/:id/restore",
    { preHandler: [requirePermission(PERMISSIONS.TERRITORIES_EDIT)] },
    async (request, reply) => {
      const { id } = request.params;
      const { versionId } = request.body;
      const version = await prisma.territoryBoundaryVersion.findFirst({
        where: { id: versionId, territoryId: id },
      });
      if (!version) {
        return reply.code(404).send({ error: "Version not found" });
      }
      try {
        const result = await runAutoFixPipeline(
          prisma,
          version.boundaries as object,
          id
        );
        return reply.send(result);
      } catch (err: any) {
        if (err.statusCode === 422) {
          return reply.code(422).send({ error: err.message });
        }
        if (isPostgisMissing(err)) {
          return reply.send({ original: version.boundaries, clipped: version.boundaries, applied: [], overlaps: [], geometryModified: false });
        }
        throw err;
      }
    }
  );

  // Update territory — requires territories.edit
  app.put<{ Params: IdParamsType; Body: TerritoryUpdateBodyType }>(
    "/territories/:id",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_EDIT),
      schema: { params: IdParams, body: TerritoryUpdateBody },
    },
    async (request, reply) => {
      const { id } = request.params;
      const existing = await prisma.territory.findUnique({
        where: { id },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Not found" });
      }

      const data = request.body;

      if (data.boundaries) {
        try {
          const autoFix = await runAutoFixPipeline(prisma, data.boundaries as object, id);
          data.boundaries = autoFix.clipped;

          const territory = await prisma.territory.update({
            where: { id },
            data: data as any,
          });

          const changeSummary = autoFix.applied.length > 0
            ? autoFix.applied.join("; ")
            : undefined;
          await createBoundaryVersion(
            id,
            autoFix.clipped as object,
            "manual_edit",
            changeSummary
          );

          return reply.send({ ...territory, autoFix });
        } catch (err: any) {
          if (err.statusCode === 422) {
            return reply.code(422).send({ error: err.message });
          }
          if (isPostgisMissing(err)) {
            // PostGIS not available — save boundaries as-is
            const territory = await prisma.territory.update({
              where: { id },
              data: data as any,
            });
            await createBoundaryVersion(id, data.boundaries as object, "manual_edit");
            return reply.send(territory);
          }
          throw err;
        }
      } else {
        const territory = await prisma.territory.update({
          where: { id },
          data: data as any,
        });
        return reply.send(territory);
      }
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

  // Delete territory boundary (polygon only) — preserves territory + addresses
  app.delete<{ Params: IdParamsType }>(
    "/territories/:id/boundaries",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_EDIT),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const { id } = request.params;
      const territory = await prisma.territory.findUnique({ where: { id } });

      if (!territory) {
        return reply.code(404).send({ error: "Territory not found" });
      }
      if (!territory.boundaries) {
        return reply.code(400).send({ error: "Territory has no boundary" });
      }

      // Save PREVIOUS boundary in version history (enables future restore)
      await createBoundaryVersion(
        id,
        territory.boundaries as object,
        "boundary_deleted",
        `Boundary deleted for territory #${territory.number}`
      );

      // Null out boundaries, preserve everything else
      const updated = await prisma.territory.update({
        where: { id },
        data: { boundaries: null } as any,
      });

      return reply.code(200).send(updated);
    },
  );

  // Bulk fix violations — auto-fix pipeline on multiple territories
  app.post<{ Body: BulkFixBodyType }>(
    "/territories/fix/bulk",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_EDIT),
      schema: { body: BulkFixBody },
    },
    async (request, reply) => {
      const { territoryIds } = request.body;

      // Fetch all requested territories
      const territories = await prisma.territory.findMany({
        where: { id: { in: territoryIds } },
        orderBy: { number: "asc" },
      });

      if (territories.length === 0) {
        return reply.code(404).send({ error: "No territories found" });
      }

      let fixed = 0;
      const failed: Array<{ id: string; number: string; error: string }> = [];

      // Two-pass approach per spec:
      // Pass 1: Clip all to congregation boundary (no neighbor dependencies)
      // Pass 2: Resolve overlaps in number order (clips against latest DB state)

      // Track intermediate state: territoryId → clipped boundary after pass 1
      const pass1Results = new Map<string, object>();

      // Pass 1 — Congregation clip
      for (const territory of territories) {
        if (!territory.boundaries) {
          failed.push({ id: territory.id, number: territory.number, error: "No boundary" });
          continue;
        }

        try {
          // Save previous boundary for undo
          await createBoundaryVersion(
            territory.id,
            territory.boundaries as object,
            "bulk_fix",
            `Previous boundary before bulk fix`
          );

          // Validate + clip to congregation boundary
          const validated = await prisma.$queryRaw<Array<{ valid: string }>>`
            SELECT ST_AsGeoJSON(ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(territory.boundaries)}))) as valid
          `;
          let current: object = JSON.parse(validated[0].valid);

          const congResult = await clipToCongregation(prisma, current);
          if (congResult?.wasModified) {
            current = congResult.clipped;
          }

          pass1Results.set(territory.id, current);

          // Persist pass 1 result immediately so pass 2 reads latest state
          await prisma.territory.update({
            where: { id: territory.id },
            data: { boundaries: current } as any,
          });
        } catch (err) {
          failed.push({
            id: territory.id,
            number: territory.number,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Pass 2 — Neighbor overlap resolution (in number order, reads latest DB state)
      for (const territory of territories) {
        const pass1Boundary = pass1Results.get(territory.id);
        if (!pass1Boundary) continue; // Failed in pass 1 or had no boundary

        try {
          const neighborResult = await clipToNeighbors(prisma, pass1Boundary, territory.id);

          if (neighborResult.removedFrom.length > 0) {
            await prisma.territory.update({
              where: { id: territory.id },
              data: { boundaries: neighborResult.clipped } as any,
            });
          }

          fixed++;
        } catch (err) {
          failed.push({
            id: territory.id,
            number: territory.number,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return reply.send({ fixed, failed });
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
