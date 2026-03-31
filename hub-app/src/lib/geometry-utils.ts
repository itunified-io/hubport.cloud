/**
 * Client-side geometry utilities for territory boundary editor.
 * Douglas-Peucker simplification, polygon cleanup, and validation.
 */

/**
 * Extract all vertex coordinates from a GeoJSON geometry.
 */
export function extractVertices(geometry: any): [number, number][] {
  if (!geometry?.coordinates) return [];
  if (geometry.type === "Polygon") return geometry.coordinates[0];
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat(2);
  return [];
}

/**
 * Check if two line segments (p1-p2) and (p3-p4) intersect.
 */
function segmentsIntersect(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number],
): boolean {
  const d1x = p2[0] - p1[0];
  const d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0];
  const d2y = p4[1] - p3[1];

  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-15) return false;

  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / denom;
  const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / denom;

  return t > 1e-10 && t < 1 - 1e-10 && u > 1e-10 && u < 1 - 1e-10;
}

/**
 * Compute the signed area of a polygon ring using the Shoelace formula.
 */
export function shoelaceArea(coords: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    sum +=
      coords[i]![0] * coords[i + 1]![1] - coords[i + 1]![0] * coords[i]![1];
  }
  return sum / 2;
}

/**
 * Validate a polygon ring:
 * 1. Minimum 4 coordinates (3 unique + closing)
 * 2. Ring is closed (first === last)
 * 3. At least 3 distinct vertices
 * 4. Non-zero area
 * 5. No self-intersection
 */
export function isValidPolygonRing(coords: [number, number][]): boolean {
  if (coords.length < 4) return false;

  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) return false;

  const unique = new Set(coords.slice(0, -1).map((c) => `${c[0]},${c[1]}`));
  if (unique.size < 3) return false;

  const area = Math.abs(shoelaceArea(coords));
  if (area < 1e-12) return false;

  for (let i = 0; i < coords.length - 1; i++) {
    for (let j = i + 2; j < coords.length - 1; j++) {
      if (i === 0 && j === coords.length - 2) continue;
      if (
        segmentsIntersect(
          coords[i]!,
          coords[i + 1]!,
          coords[j]!,
          coords[j + 1]!,
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Perpendicular distance from point to line segment (p1-p2).
 */
function perpendicularDistance(
  point: [number, number],
  p1: [number, number],
  p2: [number, number],
): number {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const lenSq = dx * dx + dy * dy;

  if (lenSq < 1e-15) {
    const pdx = point[0] - p1[0];
    const pdy = point[1] - p1[1];
    return Math.sqrt(pdx * pdx + pdy * pdy);
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - p1[0]) * dx + (point[1] - p1[1]) * dy) / lenSq,
    ),
  );
  const projX = p1[0] + t * dx;
  const projY = p1[1] + t * dy;
  const ddx = point[0] - projX;
  const ddy = point[1] - projY;
  return Math.sqrt(ddx * ddx + ddy * ddy);
}

/**
 * Douglas-Peucker line simplification.
 * Reduces number of points while preserving shape within epsilon tolerance.
 *
 * @param points - Array of [lng, lat] coordinates
 * @param epsilon - Maximum allowed distance from original line (in coordinate units)
 * @returns Simplified array of coordinates
 */
export function douglasPeucker(
  points: [number, number][],
  epsilon: number,
): [number, number][] {
  if (points.length <= 2) return [...points];

  let maxDist = 0;
  let maxIdx = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const dist = perpendicularDistance(points[i]!, points[0]!, points[end]!);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [points[0]!, points[end]!];
}

/**
 * Simplify a polygon's coordinates using Douglas-Peucker.
 * Preserves the closing coordinate and validates the result.
 *
 * @param coords - Polygon ring coordinates (closed)
 * @param epsilon - Simplification tolerance
 * @returns Simplified coordinates or original if simplification would be invalid
 */
export function simplifyPolygon(
  coords: [number, number][],
  epsilon: number,
): [number, number][] {
  if (coords.length <= 4) return coords;

  // Remove closing coordinate for simplification
  const open = coords.slice(0, -1);
  const simplified = douglasPeucker(open, epsilon);

  // Need at least 3 unique vertices
  if (simplified.length < 3) return coords;

  // Close the ring
  const closed: [number, number][] = [
    ...simplified,
    [simplified[0]![0], simplified[0]![1]],
  ];

  // Validate the result
  if (!isValidPolygonRing(closed)) return coords;

  return closed;
}

/**
 * Haversine distance between two [lng, lat] points, in meters.
 */
export function haversineDistance(
  a: [number, number],
  b: [number, number],
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/**
 * Ensure a polygon ring is in counter-clockwise winding order.
 * GeoJSON requires outer rings to be counter-clockwise.
 */
export function ensureCCW(coords: [number, number][]): [number, number][] {
  const area = shoelaceArea(coords);
  if (area > 0) return coords; // Already CCW
  return [...coords].reverse();
}

/**
 * Remove duplicate consecutive vertices from a coordinate array.
 */
export function removeDuplicateVertices(
  coords: [number, number][],
  tolerance = 1e-10,
): [number, number][] {
  if (coords.length <= 1) return coords;

  const result: [number, number][] = [coords[0]!];
  for (let i = 1; i < coords.length; i++) {
    const prev = result[result.length - 1]!;
    const curr = coords[i]!;
    const dx = Math.abs(curr[0] - prev[0]);
    const dy = Math.abs(curr[1] - prev[1]);
    if (dx > tolerance || dy > tolerance) {
      result.push(curr);
    }
  }
  return result;
}
