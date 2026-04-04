/**
 * Shared spatial utility functions for territory boundary operations.
 * Used by gap detection, OSM refresh, and OSM populate.
 */

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Compute bounding box from GeoJSON Polygon or MultiPolygon boundaries.
 */
export function bboxFromGeoJSON(boundaries: unknown): BBox | null {
  if (!boundaries || typeof boundaries !== "object") return null;
  const geo = boundaries as { type?: string; coordinates?: number[][][] | number[][][][] };
  if (!geo.coordinates) return null;

  let allCoords: number[][] = [];
  if (geo.type === "Polygon") {
    for (const ring of geo.coordinates as number[][][]) allCoords = allCoords.concat(ring);
  } else if (geo.type === "MultiPolygon") {
    for (const poly of geo.coordinates as number[][][][]) {
      for (const ring of poly) allCoords = allCoords.concat(ring);
    }
  } else {
    return null;
  }

  if (allCoords.length === 0) return null;

  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  for (const [lng, lat] of allCoords as [number, number][]) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
  }
  return { south, west, north, east };
}

/**
 * Ray-casting test for a single ring.
 */
function rayInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!, yi = ring[i]![1]!;
    const xj = ring[j]![0]!, yj = ring[j]![1]!;
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Point-in-polygon test using ray casting algorithm.
 * Polygon is an array of rings (first = outer boundary, rest = holes).
 * A point is inside if it's in the outer ring AND NOT in any hole ring.
 */
export function pointInPolygon(lat: number, lng: number, polygon: number[][][]): boolean {
  if (!polygon || polygon.length === 0) return false;
  // Must be inside outer ring
  if (!rayInRing(lat, lng, polygon[0]!)) return false;
  // Must NOT be inside any hole ring
  for (let i = 1; i < polygon.length; i++) {
    if (rayInRing(lat, lng, polygon[i]!)) return false;
  }
  return true;
}

/**
 * Test whether a point is inside GeoJSON boundaries (Polygon or MultiPolygon).
 */
export function isInsideBoundaries(lat: number, lng: number, boundaries: unknown): boolean {
  if (!boundaries || typeof boundaries !== "object") return false;
  const geo = boundaries as { type?: string; coordinates?: number[][][] | number[][][][]; geometries?: Array<{ type?: string; coordinates?: unknown }> };
  if (geo.type === "Polygon") {
    return pointInPolygon(lat, lng, geo.coordinates as number[][][]);
  }
  if (geo.type === "MultiPolygon") {
    return (geo.coordinates as number[][][][]).some((poly) => pointInPolygon(lat, lng, poly));
  }
  // GeometryCollection — check each sub-geometry (PostGIS sometimes produces these)
  if (geo.type === "GeometryCollection" && Array.isArray(geo.geometries)) {
    return geo.geometries.some((g) => isInsideBoundaries(lat, lng, g));
  }
  return false;
}
