import { Prisma } from "@prisma/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaLike = any;

/**
 * PostGIS helper functions wrapping raw SQL for geometry operations.
 * Prisma has no native PostGIS support — all geometry reads/writes use $executeRaw/$queryRaw.
 */

/** Insert or update a territory boundary (polygon) and cache its GeoJSON.
 *  When waterMaskGeoJson is provided, subtracts water bodies via ST_Difference.
 */
export async function upsertBoundary(
  prisma: PrismaLike,
  territoryId: string,
  geojson: object,
  tenantId: string,
  waterMaskGeoJson?: object | null,
): Promise<void> {
  const geojsonStr = JSON.stringify(geojson);
  const waterStr = waterMaskGeoJson ? JSON.stringify(waterMaskGeoJson) : null;

  await prisma.$executeRaw`
    WITH polys AS (
      SELECT (ST_Dump(
        ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON(${geojsonStr})), 3)
      )).geom AS geom
    ),
    largest AS (
      SELECT geom FROM polys ORDER BY ST_Area(geom) DESC LIMIT 1
    ),
    water_clipped AS (
      SELECT CASE
        WHEN ${waterStr}::text IS NOT NULL THEN
          ST_MakeValid(ST_Difference(
            largest.geom,
            ST_MakeValid(ST_GeomFromGeoJSON(${waterStr}::text))
          ))
        ELSE largest.geom
      END AS geom
      FROM largest
    ),
    clean AS (
      SELECT ST_MakeValid(geom) AS geom FROM water_clipped
      WHERE NOT ST_IsEmpty(geom)
    )
    UPDATE "Territory"
    SET "boundaries" = ST_AsGeoJSON(clean.geom)::jsonb,
        "updatedAt" = now()
    FROM clean
    WHERE id = ${territoryId}::uuid
  `;
}

/** Clear a territory boundary. */
export async function clearBoundary(
  prisma: PrismaLike,
  territoryId: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "Territory"
    SET "boundaries" = NULL,
        "updatedAt" = now()
    WHERE id = ${territoryId}::uuid
  `;
}

/** Get a territory boundary as GeoJSON. */
export async function getBoundaryAsGeoJSON(
  prisma: PrismaLike,
  territoryId: string,
): Promise<object | null> {
  const result = await prisma.$queryRaw<{ boundaries: object }[]>`
    SELECT "boundaries"
    FROM "Territory"
    WHERE id = ${territoryId}::uuid
      AND "boundaries" IS NOT NULL
  `;
  return result[0]?.boundaries ?? null;
}

/** Get all territory boundaries as a GeoJSON FeatureCollection. */
export async function getAllBoundariesAsFeatureCollection(
  prisma: PrismaLike,
): Promise<object> {
  const rows = await prisma.$queryRaw<
    { id: string; number: string; name: string; boundaries: object }[]
  >`
    SELECT id, number, name, "boundaries"
    FROM "Territory"
    WHERE "boundaries" IS NOT NULL
  `;

  return {
    type: "FeatureCollection",
    features: rows.map((r: any) => ({
      type: "Feature",
      properties: {
        territoryId: r.id,
        number: r.number,
        name: r.name,
      },
      geometry: r.boundaries,
    })),
  };
}

/** Validate a GeoJSON geometry string for basic polygon structure. */
export function validateGeoJSONPolygon(
  geojson: unknown,
): { valid: boolean; reason: string | null } {
  if (!geojson || typeof geojson !== "object") {
    return { valid: false, reason: "GeoJSON must be an object" };
  }

  const geo = geojson as Record<string, unknown>;
  if (geo.type !== "Polygon" && geo.type !== "MultiPolygon") {
    return { valid: false, reason: "Geometry must be Polygon or MultiPolygon" };
  }

  if (!Array.isArray(geo.coordinates)) {
    return { valid: false, reason: "Missing coordinates array" };
  }

  if (geo.type === "Polygon") {
    const ring = (geo.coordinates as number[][][])[0];
    if (!ring || ring.length < 4) {
      return {
        valid: false,
        reason: "Polygon ring must have at least 4 coordinates",
      };
    }
  }

  return { valid: true, reason: null };
}

/**
 * Clip a geometry to the congregation boundary using ST_Intersection.
 * Returns null if no congregation boundary exists (skip step).
 * Throws 422 if result is empty (territory entirely outside congregation).
 */
export async function clipToCongregation(
  prisma: PrismaLike,
  geojson: object
): Promise<{ clipped: object; wasModified: boolean } | null> {
  // Find congregation boundary
  const congregation = await prisma.territory.findFirst({
    where: { type: "congregation_boundary", boundaries: { not: Prisma.DbNull } },
    select: { boundaries: true },
  });
  if (!congregation || !congregation.boundaries) return null;

  const result = await prisma.$queryRaw<
    Array<{ clipped: string; is_empty: boolean; original_area: number; clipped_area: number }>
  >`
    SELECT
      ST_AsGeoJSON(ST_Intersection(
        ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(geojson)})),
        ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(congregation.boundaries)}))
      )) as clipped,
      ST_IsEmpty(ST_Intersection(
        ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(geojson)})),
        ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(congregation.boundaries)}))
      )) as is_empty,
      ST_Area(ST_GeomFromGeoJSON(${JSON.stringify(geojson)})::geography) as original_area,
      ST_Area(ST_Intersection(
        ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(geojson)})),
        ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(congregation.boundaries)}))
      )::geography) as clipped_area
  `;

  if (!result[0] || result[0].is_empty) {
    const error = new Error("Territory polygon does not intersect the congregation boundary. Please redraw.");
    (error as any).statusCode = 422;
    throw error;
  }

  const clipped = JSON.parse(result[0].clipped);
  const wasModified = Math.abs(result[0].original_area - result[0].clipped_area) > 0.1; // >0.1 m²
  return { clipped, wasModified };
}

/**
 * Subtract all neighboring territory polygons from the input geometry.
 * Returns the clipped geometry and list of territories that were clipped from.
 */
export async function clipToNeighbors(
  prisma: PrismaLike,
  geojson: object,
  excludeTerritoryId: string | null
): Promise<{ clipped: object; removedFrom: Array<{ id: string; number: string; name: string }> }> {
  // Find all territories that intersect with our geometry
  const neighbors = await prisma.$queryRaw<
    Array<{ id: string; number: string; name: string; boundaries: string }>
  >`
    SELECT t.id, t.number, t.name, t.boundaries::text as boundaries
    FROM "Territory" t
    WHERE t.boundaries IS NOT NULL
      AND t.type = 'territory'
      ${excludeTerritoryId ? Prisma.sql`AND t.id != ${excludeTerritoryId}` : Prisma.empty}
      AND ST_Intersects(
        ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(geojson)})),
        ST_MakeValid(ST_GeomFromGeoJSON(t.boundaries::text))
      )
  `;

  if (neighbors.length === 0) {
    return { clipped: geojson, removedFrom: [] };
  }

  let currentGeojson = geojson;
  const removedFrom: Array<{ id: string; number: string; name: string }> = [];

  for (const neighbor of neighbors) {
    const result = await prisma.$queryRaw<Array<{ diff: string; was_modified: boolean }>>`
      SELECT
        ST_AsGeoJSON(ST_Difference(
          ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(currentGeojson)})),
          ST_MakeValid(ST_GeomFromGeoJSON(${neighbor.boundaries}))
        )) as diff,
        NOT ST_Equals(
          ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(currentGeojson)})),
          ST_Difference(
            ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(currentGeojson)})),
            ST_MakeValid(ST_GeomFromGeoJSON(${neighbor.boundaries}))
          )
        ) as was_modified
    `;

    if (result[0]?.was_modified) {
      currentGeojson = JSON.parse(result[0].diff);
      removedFrom.push({ id: neighbor.id, number: neighbor.number, name: neighbor.name });
    }
  }

  return { clipped: currentGeojson, removedFrom };
}

export interface OverlapInfo {
  territoryId: string;
  number: string;
  name: string;
  overlapAreaM2: number;
}

/**
 * Detect remaining overlaps with other territories (informational only).
 */
export async function detectOverlaps(
  prisma: PrismaLike,
  geojson: object,
  excludeTerritoryId: string | null
): Promise<OverlapInfo[]> {
  const overlaps = await prisma.$queryRaw<OverlapInfo[]>`
    SELECT
      t.id as "territoryId",
      t.number,
      t.name,
      ST_Area(ST_Intersection(
        ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(geojson)})),
        ST_MakeValid(ST_GeomFromGeoJSON(t.boundaries::text))
      )::geography) as "overlapAreaM2"
    FROM "Territory" t
    WHERE t.boundaries IS NOT NULL
      AND t.type = 'territory'
      ${excludeTerritoryId ? Prisma.sql`AND t.id != ${excludeTerritoryId}` : Prisma.empty}
      AND ST_Intersects(
        ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(geojson)})),
        ST_MakeValid(ST_GeomFromGeoJSON(t.boundaries::text))
      )
      AND ST_Area(ST_Intersection(
        ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(geojson)})),
        ST_MakeValid(ST_GeomFromGeoJSON(t.boundaries::text))
      )::geography) > 0.1
  `;

  return overlaps;
}

export interface AutoFixResult {
  original: object;
  clipped: object;
  applied: string[];
  overlaps: OverlapInfo[];
  geometryModified: boolean;
}

/**
 * Run the full auto-fix pipeline: validate → congregation clip → neighbor clip → overlap detect.
 */
export async function runAutoFixPipeline(
  prisma: PrismaLike,
  geojson: object,
  excludeTerritoryId: string | null
): Promise<AutoFixResult> {
  const original = geojson;
  const applied: string[] = [];
  let current = geojson;

  // Step 1: Validate geometry
  const validated = await prisma.$queryRaw<Array<{ valid: string }>>`
    SELECT ST_AsGeoJSON(ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(current)}))) as valid
  `;
  current = JSON.parse(validated[0].valid);

  // Step 2: Congregation clip
  const congResult = await clipToCongregation(prisma, current);
  if (congResult) {
    if (congResult.wasModified) {
      applied.push("Clipped to congregation boundary");
    }
    current = congResult.clipped;
  }

  // Step 3: Neighbor clip
  const neighborResult = await clipToNeighbors(prisma, current, excludeTerritoryId);
  current = neighborResult.clipped;
  for (const removed of neighborResult.removedFrom) {
    applied.push(`Removed overlap with #${removed.number} ${removed.name}`);
  }

  // Step 4: Overlap detect (informational)
  const overlaps = await detectOverlaps(prisma, current, excludeTerritoryId);

  const geometryModified = applied.length > 0;

  return { original, clipped: current, applied, overlaps, geometryModified };
}
