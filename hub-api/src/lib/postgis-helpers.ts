import { PrismaClient } from "@prisma/client";

/**
 * PostGIS helper functions wrapping raw SQL for geometry operations.
 * Prisma has no native PostGIS support — all geometry reads/writes use $executeRaw/$queryRaw.
 */

/** Insert or update a territory boundary (polygon) and cache its GeoJSON.
 *  When waterMaskGeoJson is provided, subtracts water bodies via ST_Difference.
 */
export async function upsertBoundary(
  prisma: PrismaClient,
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
  prisma: PrismaClient,
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
  prisma: PrismaClient,
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
  prisma: PrismaClient,
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
    features: rows.map((r) => ({
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
