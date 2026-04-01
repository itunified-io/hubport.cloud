/**
 * Snap Engine — pure function for vertex snapping during territory drawing.
 *
 * Snaps a dragged vertex to the nearest snap target within tolerance.
 * Priority order: neighbor edge > road > congregation boundary > building
 */

export type SnapTargetType = "neighbor" | "road" | "boundary" | "building";

export interface SnapTarget {
  type: SnapTargetType;
  /** GeoJSON geometry of the snap target */
  geometry: {
    type: string;
    coordinates: any;
  };
  /** Human-readable label for the snap indicator */
  label?: string;
}

export interface SnapResult {
  /** Final snapped position [lng, lat] */
  position: [number, number];
  /** Display label for the snap indicator */
  label: string | null;
  /** Which target type was snapped to, or null if no snap */
  snappedTo: SnapTargetType | null;
}

/** Default snap tolerance in pixels */
export const DEFAULT_SNAP_TOLERANCE = 15;

/**
 * Squared distance between two points.
 */
function distSq(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

/**
 * Find the closest point on a line segment to a given point.
 * Returns [closestPoint, distance].
 */
function closestPointOnSegment(
  point: [number, number],
  segStart: [number, number],
  segEnd: [number, number],
): { point: [number, number]; dist: number } {
  const dx = segEnd[0] - segStart[0];
  const dy = segEnd[1] - segStart[1];
  const lenSq = dx * dx + dy * dy;

  if (lenSq < 1e-15) {
    const d = Math.sqrt(distSq(point, segStart));
    return { point: [segStart[0], segStart[1]], dist: d };
  }

  let t =
    ((point[0] - segStart[0]) * dx + (point[1] - segStart[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const proj: [number, number] = [
    segStart[0] + t * dx,
    segStart[1] + t * dy,
  ];
  const d = Math.sqrt(distSq(point, proj));
  return { point: proj, dist: d };
}

/**
 * Find the closest snap from a LineString or Polygon geometry.
 */
function findClosestOnGeometry(
  point: [number, number],
  geometry: { type: string; coordinates: any },
): { point: [number, number]; dist: number } | null {
  let bestDist = Infinity;
  let bestPoint: [number, number] | null = null;

  const processLineCoords = (coords: [number, number][]) => {
    for (let i = 0; i < coords.length - 1; i++) {
      const result = closestPointOnSegment(point, coords[i]!, coords[i + 1]!);
      if (result.dist < bestDist) {
        bestDist = result.dist;
        bestPoint = result.point;
      }
    }
  };

  if (geometry.type === "LineString") {
    processLineCoords(geometry.coordinates);
  } else if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) {
      processLineCoords(ring);
    }
  } else if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) {
        processLineCoords(ring);
      }
    }
  } else if (geometry.type === "Point") {
    const coord = geometry.coordinates as [number, number];
    const d = Math.sqrt(distSq(point, coord));
    if (d < bestDist) {
      bestDist = d;
      bestPoint = [coord[0], coord[1]];
    }
  }

  if (bestPoint === null) return null;
  return { point: bestPoint, dist: bestDist };
}

/**
 * Snap a vertex to the nearest snap target.
 *
 * @param dragPosition - Current drag position [lng, lat]
 * @param snapTargets - Available snap targets
 * @param tolerance - Snap tolerance in coordinate units (pre-converted from pixels)
 * @returns Snap result with final position and metadata
 */
export function snapVertex(
  dragPosition: [number, number],
  snapTargets: SnapTarget[],
  tolerance: number,
): SnapResult {
  // Group targets by priority
  const priorityOrder: SnapTargetType[] = [
    "neighbor",
    "road",
    "boundary",
    "building",
  ];

  const grouped = new Map<SnapTargetType, SnapTarget[]>();
  for (const target of snapTargets) {
    const list = grouped.get(target.type) ?? [];
    list.push(target);
    grouped.set(target.type, list);
  }

  // Try each priority level
  for (const type of priorityOrder) {
    const targets = grouped.get(type);
    if (!targets?.length) continue;

    let bestDist = Infinity;
    let bestPoint: [number, number] | null = null;
    let bestLabel: string | null = null;

    for (const target of targets) {
      const result = findClosestOnGeometry(dragPosition, target.geometry);
      if (result && result.dist < bestDist && result.dist <= tolerance) {
        bestDist = result.dist;
        bestPoint = result.point;
        bestLabel = target.label ?? type;
      }
    }

    if (bestPoint) {
      return {
        position: bestPoint,
        label: bestLabel,
        snappedTo: type,
      };
    }
  }

  // No snap — return original position
  return {
    position: dragPosition,
    label: null,
    snappedTo: null,
  };
}

export interface SnapReport {
  /** Original position */
  original: [number, number];
  /** Snapped position (same as original if no snap) */
  snapped: [number, number];
  /** What it snapped to, or null */
  snappedTo: SnapTargetType | null;
  /** Label of snap target */
  label: string | null;
  /** Distance moved (coordinate units) */
  distance: number;
}

/**
 * Snap all vertices in a polygon to nearest snap targets.
 * Returns new vertex array and per-vertex report.
 */
export function snapAll(
  vertices: [number, number][],
  snapTargets: SnapTarget[],
  tolerance: number,
): { snapped: [number, number][]; report: SnapReport[] } {
  const snapped: [number, number][] = [];
  const report: SnapReport[] = [];

  for (const vertex of vertices) {
    const result = snapVertex(vertex, snapTargets, tolerance);
    snapped.push(result.position);
    report.push({
      original: vertex,
      snapped: result.position,
      snappedTo: result.snappedTo,
      label: result.label,
      distance: Math.sqrt(
        (result.position[0] - vertex[0]) ** 2 +
        (result.position[1] - vertex[1]) ** 2,
      ),
    });
  }

  return { snapped, report };
}
