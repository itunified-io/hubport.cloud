/**
 * H3 Hex Grid Engine
 *
 * Converts GeoJSON polygons to H3 hexagonal grids for spatial queries.
 * Uses h3-js v4 (pure JS, no native bindings).
 *
 * Coordinate convention:
 *   - GeoJSON uses [lng, lat]
 *   - h3-js uses [lat, lng]
 *   All public functions accept/return GeoJSON format and convert internally.
 */

import { polygonToCells, cellToBoundary, cellToChildren, latLngToCell } from "h3-js";
import { createHash } from "crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaLike = any;

// ─── Core Functions ─────────────────────────────────────────────

/**
 * Convert a GeoJSON polygon to H3 hex indexes at the given resolution.
 * Uses h3-js isGeoJson mode to accept [lng, lat] coordinates directly.
 */
export function polygonToHexes(
  geojson: { type: string; coordinates: unknown },
  resolution: number,
): string[] {
  const coords = extractOuterRing(geojson);
  if (!coords || coords.length < 4) return [];

  // Pass as [outerRing] with isGeoJson=true so h3-js accepts [lng, lat] directly
  return polygonToCells([coords], resolution, true);
}

/**
 * Get bounding box for an H3 hex cell.
 * Returns { south, west, north, east } for Overpass queries.
 */
export function hexToBBox(h3Index: string): {
  south: number;
  west: number;
  north: number;
  east: number;
} {
  const boundary = cellToBoundary(h3Index); // [lat, lng][]

  let south = Infinity, north = -Infinity;
  let west = Infinity, east = -Infinity;

  for (const [lat, lng] of boundary) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
  }

  return { south, west, north, east };
}

/**
 * Convert an H3 hex cell to a GeoJSON Polygon for map rendering.
 */
export function hexToGeoJSON(h3Index: string): {
  type: "Polygon";
  coordinates: [number, number][][];
} {
  const boundary = cellToBoundary(h3Index); // [lat, lng][]
  // Convert h3-js [lat, lng] → GeoJSON [lng, lat], close the ring
  const ring = boundary.map(([lat, lng]) => [lng, lat] as [number, number]);
  ring.push(ring[0]!); // close ring
  return { type: "Polygon", coordinates: [ring] };
}

/**
 * Subdivide hex indexes to children at a finer resolution.
 * E.g., res-8 → res-10 for heatmap display.
 */
export function subdivideHexes(
  h3Indexes: string[],
  targetRes: number,
): string[] {
  const children: string[] = [];
  for (const idx of h3Indexes) {
    children.push(...cellToChildren(idx, targetRes));
  }
  return children;
}

/**
 * Assign a lat/lng point to its H3 hex at the given resolution.
 */
export function pointToHex(lat: number, lng: number, resolution: number): string {
  return latLngToCell(lat, lng, resolution);
}

// ─── Cache ──────────────────────────────────────────────────────

/**
 * Hash a GeoJSON boundary for cache key.
 */
export function hashBoundary(geojson: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(geojson))
    .digest("hex");
}

/**
 * Get cached hex indexes or compute and store them.
 * Prunes stale cache entries older than 30 days.
 */
export async function getOrComputeHexes(
  prisma: PrismaLike,
  congregationGeoJSON: { type: string; coordinates: unknown },
  resolution: number,
): Promise<string[]> {
  const hash = hashBoundary(congregationGeoJSON);

  // Check cache
  const cached = await prisma.hexGridCache.findUnique({
    where: { boundaryHash_resolution: { boundaryHash: hash, resolution } },
  });

  if (cached) {
    return cached.hexIndexes;
  }

  // Compute
  const hexes = polygonToHexes(congregationGeoJSON, resolution);

  // Store
  await prisma.hexGridCache.create({
    data: {
      boundaryHash: hash,
      resolution,
      hexIndexes: hexes,
    },
  });

  // Prune stale entries (older than 30 days)
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await prisma.hexGridCache.deleteMany({
    where: { createdAt: { lt: cutoff } },
  }).catch(() => { /* non-critical cleanup */ });

  return hexes;
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Extract outer ring coordinates from a GeoJSON geometry.
 * Handles Polygon and MultiPolygon (takes largest polygon).
 */
function extractOuterRing(
  geojson: { type: string; coordinates: unknown },
): [number, number][] | null {
  if (geojson.type === "Polygon") {
    const coords = geojson.coordinates as [number, number][][];
    return coords[0] ?? null;
  }

  if (geojson.type === "MultiPolygon") {
    const polys = geojson.coordinates as [number, number][][][];
    if (polys.length === 0) return null;
    // Take largest polygon by vertex count
    let largest = polys[0]!;
    for (let i = 1; i < polys.length; i++) {
      if ((polys[i]![0]?.length ?? 0) > (largest[0]?.length ?? 0)) {
        largest = polys[i]!;
      }
    }
    return largest[0] ?? null;
  }

  return null;
}
