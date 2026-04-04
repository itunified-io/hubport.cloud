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

  // Guard against invalid boundaries (null coordinates from bad normalization)
  const congGeo = congregation.boundaries as { coordinates?: unknown };
  if (!congGeo.coordinates || !Array.isArray(congGeo.coordinates)) return null;

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
      AND t.boundaries->>'coordinates' IS NOT NULL
      AND jsonb_typeof(t.boundaries->'coordinates') = 'array'
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
      AND t.boundaries->>'coordinates' IS NOT NULL
      AND jsonb_typeof(t.boundaries->'coordinates') = 'array'
      ${excludeTerritoryId ? Prisma.sql`AND t.id != ${excludeTerritoryId}` : Prisma.empty}
      AND ST_Intersects(
        ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(geojson)})),
        ST_MakeValid(ST_GeomFromGeoJSON(t.boundaries::text))
      )
      AND ST_Area(ST_Intersection(
        ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(geojson)})),
        ST_MakeValid(ST_GeomFromGeoJSON(t.boundaries::text))
      )::geography) > 1.0
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

  // Step 4: Normalize non-Polygon geometries → Polygon via PostGIS
  // PostGIS operations (ST_MakeValid, ST_Difference, ST_Intersection) often produce
  // MultiPolygon or GeometryCollection with tiny sliver/point artifacts.
  // Use ST_CollectionExtract + ST_Dump to reliably extract the largest polygon.
  const currentObj = current as { type?: string; coordinates?: unknown };
  if (currentObj.type !== "Polygon") {
    const normalized = await prisma.$queryRaw<Array<{ geojson: string }>>`
      SELECT ST_AsGeoJSON(
        (SELECT geom FROM (
          SELECT (ST_Dump(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(current)})), 3))).geom
        ) d ORDER BY ST_Area(geom) DESC LIMIT 1)
      ) as geojson
    `;
    if (normalized[0]?.geojson) {
      const parsed = JSON.parse(normalized[0].geojson);
      if (parsed?.coordinates && Array.isArray(parsed.coordinates)) {
        current = parsed;
        applied.push(`Normalized ${currentObj.type} to Polygon`);
      }
    }
  }

  // Step 5: Overlap detect (informational)
  const overlaps = await detectOverlaps(prisma, current, excludeTerritoryId);

  const geometryModified = applied.length > 0;

  return { original, clipped: current, applied, overlaps, geometryModified };
}

export interface GapPolygon {
  geojson: object;
  areaMeter2: number;
  bbox: { south: number; west: number; north: number; east: number };
}

/**
 * Compute gap polygons — areas inside the congregation boundary
 * that are NOT covered by any territory polygon.
 * Returns null if no congregation boundary exists.
 */
export async function computeGapPolygons(
  prisma: PrismaLike,
): Promise<GapPolygon[] | null> {
  // Check congregation boundary exists
  const congregation = await prisma.territory.findFirst({
    where: { type: "congregation_boundary", boundaries: { not: Prisma.DbNull } },
    select: { boundaries: true },
  });
  if (!congregation?.boundaries) return null;

  const congGeo = congregation.boundaries as { coordinates?: unknown };
  if (!congGeo.coordinates || !Array.isArray(congGeo.coordinates)) return null;

  const rows = await prisma.$queryRaw<
    Array<{
      geojson: string;
      area_m2: number;
      west: number;
      south: number;
      east: number;
      north: number;
    }>
  >`
    WITH all_territories AS (
      SELECT ST_Union(
        ST_MakeValid(ST_GeomFromGeoJSON(boundaries::text))
      ) AS combined
      FROM "Territory"
      WHERE boundaries IS NOT NULL
        AND type = 'territory'
        AND boundaries->>'coordinates' IS NOT NULL
        AND jsonb_typeof(boundaries->'coordinates') = 'array'
    ),
    congregation AS (
      SELECT ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(congregation.boundaries)})) AS geom
    ),
    gaps AS (
      SELECT (ST_Dump(
        CASE
          WHEN (SELECT combined FROM all_territories) IS NOT NULL
          THEN ST_Difference(congregation.geom, (SELECT combined FROM all_territories))
          ELSE congregation.geom
        END
      )).geom AS geom
      FROM congregation
    )
    SELECT
      ST_AsGeoJSON(geom) AS geojson,
      ST_Area(geom::geography) AS area_m2,
      ST_XMin(geom) AS west,
      ST_YMin(geom) AS south,
      ST_XMax(geom) AS east,
      ST_YMax(geom) AS north
    FROM gaps
    WHERE ST_Area(geom::geography) > 100
      AND ST_Area(geom::geography) / NULLIF(
        ST_Perimeter(geom::geography) * ST_Perimeter(geom::geography), 0
      ) > 0.001
    ORDER BY ST_Area(geom::geography) DESC
  `;

  return rows.map((r: { geojson: string; area_m2: number; south: number; west: number; north: number; east: number }) => ({
    geojson: JSON.parse(r.geojson),
    areaMeter2: Number(r.area_m2),
    bbox: {
      south: Number(r.south),
      west: Number(r.west),
      north: Number(r.north),
      east: Number(r.east),
    },
  }));
}

/**
 * Bulk check which building points are covered by ANY territory polygon.
 * Uses PostGIS ST_Contains against ST_Union of all territories — handles
 * holes, complex geometries, and edge cases correctly (unlike JS ray-casting).
 *
 * Returns the set of osmIds that ARE covered by a territory.
 */
export async function checkBuildingCoveragePostGIS(
  prisma: PrismaLike,
  buildings: Array<{ osmId: string; lat: number; lng: number }>,
): Promise<Set<string>> {
  if (buildings.length === 0) return new Set();

  // Pass building data as JSON array to PostGIS
  const buildingsJson = JSON.stringify(
    buildings.map((b) => ({ osmId: b.osmId, lng: b.lng, lat: b.lat })),
  );

  const rows = await prisma.$queryRaw<Array<{ osm_id: string }>>`
    WITH territory_union AS (
      SELECT ST_Union(
        ST_MakeValid(ST_GeomFromGeoJSON(boundaries::text))
      ) AS geom
      FROM "Territory"
      WHERE boundaries IS NOT NULL
        AND type = 'territory'
        AND boundaries->>'coordinates' IS NOT NULL
        AND jsonb_typeof(boundaries->'coordinates') = 'array'
    ),
    buildings AS (
      SELECT
        elem->>'osmId' AS osm_id,
        (elem->>'lng')::float8 AS lng,
        (elem->>'lat')::float8 AS lat
      FROM jsonb_array_elements(${buildingsJson}::jsonb) elem
    )
    SELECT b.osm_id
    FROM buildings b, territory_union tu
    WHERE tu.geom IS NOT NULL
      AND ST_Contains(tu.geom, ST_SetSRID(ST_MakePoint(b.lng, b.lat), 4326))
  `;

  return new Set(rows.map((r: { osm_id: string }) => r.osm_id));
}

/**
 * Check which building points are inside the congregation boundary using PostGIS.
 * Returns the set of osmIds that are inside the congregation boundary.
 */
export async function checkCongregationContainsPostGIS(
  prisma: PrismaLike,
  buildings: Array<{ osmId: string; lat: number; lng: number }>,
  congregationBoundaries: object,
): Promise<Set<string>> {
  if (buildings.length === 0) return new Set();

  const buildingsJson = JSON.stringify(
    buildings.map((b) => ({ osmId: b.osmId, lng: b.lng, lat: b.lat })),
  );
  const congStr = JSON.stringify(congregationBoundaries);

  const rows = await prisma.$queryRaw<Array<{ osm_id: string }>>`
    WITH congregation AS (
      SELECT ST_MakeValid(ST_GeomFromGeoJSON(${congStr})) AS geom
    ),
    buildings AS (
      SELECT
        elem->>'osmId' AS osm_id,
        (elem->>'lng')::float8 AS lng,
        (elem->>'lat')::float8 AS lat
      FROM jsonb_array_elements(${buildingsJson}::jsonb) elem
    )
    SELECT b.osm_id
    FROM buildings b, congregation c
    WHERE ST_Contains(c.geom, ST_SetSRID(ST_MakePoint(b.lng, b.lat), 4326))
  `;

  return new Set(rows.map((r: { osm_id: string }) => r.osm_id));
}
