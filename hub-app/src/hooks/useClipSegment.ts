/**
 * useClipSegment — Hook for the "Clip Segment" editing tool.
 *
 * Allows users to select two vertices on a polygon boundary, then clip
 * (replace) the segment between them with a projected line along a nearby
 * road, neighbor edge, or congregation boundary.
 *
 * Algorithm:
 * 1. User clicks vertex A and vertex B on the polygon ring
 * 2. Extract the boundary segment between A and B
 * 3. For each candidate clip target (road, neighbor, boundary):
 *    - Project A onto target line → nearestPointOnLine
 *    - Project B onto target line → nearestPointOnLine
 *    - Extract sub-line between projections → lineSlice
 * 4. Rank candidates by average distance from segment to target
 * 5. Present top candidates to user
 * 6. On selection: replace segment with target sub-line coordinates
 */

import { useCallback, useMemo, useState } from "react";
import nearestPointOnLine from "@turf/nearest-point-on-line";
import lineSlice from "@turf/line-slice";
import { lineString, point } from "@turf/helpers";
import length from "@turf/length";
import type { SnapTarget } from "../pages/territories/SnapEngine";

// ─── Types ────────────────────────────────────────────────────────

export type ClipPhase = "select_start" | "select_end" | "choose_target" | "idle";

export interface ClipCandidate {
  /** Display label (road name, "Neighbor", etc.) */
  label: string;
  /** Target type for icon/color styling */
  type: "road" | "neighbor" | "boundary";
  /** The replacement coordinates for the polygon segment */
  replacementCoords: [number, number][];
  /** Average distance from original segment to target (lower = better) */
  score: number;
}

export interface UseClipSegmentReturn {
  /** Current phase of the clip workflow */
  phase: ClipPhase;
  /** Index of first selected vertex (null if not yet selected) */
  startIndex: number | null;
  /** Index of second selected vertex (null if not yet selected) */
  endIndex: number | null;
  /** Available clip targets after both vertices are selected */
  candidates: ClipCandidate[];
  /** Start the clip workflow (enter select_start phase) */
  start: () => void;
  /** Select a vertex (called from VertexHandle click) */
  selectVertex: (index: number) => void;
  /** Apply a clip candidate — returns the new polygon coordinates */
  applyClip: (candidate: ClipCandidate) => [number, number][] | null;
  /** "Straighten" the segment — replace with direct line between endpoints */
  straighten: () => [number, number][] | null;
  /** Cancel and reset */
  cancel: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Extract the segment of polygon vertices between startIdx and endIdx.
 * Handles ring wrapping (if start > end, wraps around).
 * Returns indices of vertices IN the segment (inclusive of start and end).
 */
function getSegmentIndices(
  vertexCount: number,
  startIdx: number,
  endIdx: number,
): number[] {
  const indices: number[] = [];
  if (startIdx <= endIdx) {
    for (let i = startIdx; i <= endIdx; i++) indices.push(i);
  } else {
    // Wrap around
    for (let i = startIdx; i < vertexCount; i++) indices.push(i);
    for (let i = 0; i <= endIdx; i++) indices.push(i);
  }
  return indices;
}

/**
 * Build a replacement polygon from original coords, replacing the segment
 * between startIdx and endIdx with new coordinates.
 *
 * Always replaces the SHORTER segment (fewer original vertices) so that the
 * majority of the polygon is preserved. This prevents accidentally destroying
 * the polygon when the user selects two vertices where the forward path
 * contains most of the ring.
 */
function buildReplacedPolygon(
  originalCoords: [number, number][],
  startIdx: number,
  endIdx: number,
  replacementCoords: [number, number][],
): [number, number][] {
  // Work with open ring (exclude closing vertex)
  const vertexCount = originalCoords.length - 1;
  const open = originalCoords.slice(0, vertexCount);

  // Determine which segment is shorter: forward (start→end) or wrapped (start→wrap→end)
  const forwardLen =
    startIdx <= endIdx
      ? endIdx - startIdx + 1
      : vertexCount - startIdx + endIdx + 1;
  const wrappedLen = vertexCount - forwardLen + 2; // the other direction

  // Replace the shorter segment, keep the longer one
  const replaceForward = forwardLen <= wrappedLen;

  const result: [number, number][] = [];

  if (replaceForward) {
    // Replace startIdx→endIdx (forward), keep the rest
    for (let i = endIdx; i !== startIdx; i = (i + 1) % vertexCount) {
      result.push(open[i]!);
    }
    result.push(open[startIdx]!);
    // Add replacement coords (reversed — going from start back toward end)
    for (let j = replacementCoords.length - 1; j >= 0; j--) {
      result.push(replacementCoords[j]!);
    }
  } else {
    // Replace the wrapped segment (end→wrap→start), keep startIdx→endIdx forward
    for (let i = startIdx; i !== endIdx; i = (i + 1) % vertexCount) {
      result.push(open[i]!);
    }
    result.push(open[endIdx]!);
    // Add replacement coords going from end back toward start
    for (const coord of replacementCoords) {
      result.push(coord);
    }
  }

  // Close the ring
  if (result.length >= 3) {
    result.push([result[0]![0], result[0]![1]]);
  }

  return result;
}

/**
 * Find clip candidates from snap targets for a given polygon segment.
 */
function findClipCandidates(
  coords: [number, number][],
  startIdx: number,
  endIdx: number,
  snapTargets: SnapTarget[],
  maxCandidates = 5,
): ClipCandidate[] {
  const vertexCount = coords.length - 1; // exclude closing vertex
  const segIndices = getSegmentIndices(vertexCount, startIdx, endIdx);

  if (segIndices.length < 2) return [];

  // Get the segment vertices
  const segmentCoords = segIndices.map((i) => coords[i]!);

  // Midpoint of the segment for proximity scoring
  const midIdx = Math.floor(segmentCoords.length / 2);
  const segMid = segmentCoords[midIdx]!;

  const candidates: ClipCandidate[] = [];

  // Only consider roads, neighbors, and boundaries (not buildings)
  const clippableTargets = snapTargets.filter(
    (t) => t.type === "road" || t.type === "neighbor" || t.type === "boundary",
  );

  for (const target of clippableTargets) {
    try {
      // Only works with LineString geometries (or Polygon outer rings)
      let lineCoords: [number, number][];

      if (target.geometry.type === "LineString") {
        lineCoords = target.geometry.coordinates as [number, number][];
      } else if (target.geometry.type === "Polygon") {
        lineCoords = (target.geometry.coordinates as [number, number][][])[0]!;
      } else if (target.geometry.type === "MultiLineString") {
        // Use the closest line
        const lines = target.geometry.coordinates as [number, number][][];
        let bestLine = lines[0]!;
        let bestDist = Infinity;
        for (const line of lines) {
          if (line.length < 2) continue;
          const ls = lineString(line);
          const np = nearestPointOnLine(ls, point(segMid));
          const d = np.properties.dist ?? Infinity;
          if (d < bestDist) {
            bestDist = d;
            bestLine = line;
          }
        }
        lineCoords = bestLine;
      } else {
        continue; // Skip unsupported geometry types
      }

      if (lineCoords.length < 2) continue;

      const targetLine = lineString(lineCoords);

      // Project start and end vertices onto the target line
      const startPoint = point(coords[startIdx]!);
      const endPoint = point(coords[endIdx]!);

      const projStart = nearestPointOnLine(targetLine, startPoint);
      const projEnd = nearestPointOnLine(targetLine, endPoint);

      // Check distance — skip if either projection is too far
      // Boundaries (congregation/branch) get a generous 500m threshold since
      // territories commonly extend well beyond their boundary.
      // Roads and neighbors use a tighter 100m threshold.
      const startDist = projStart.properties.dist ?? Infinity;
      const endDist = projEnd.properties.dist ?? Infinity;
      const maxDist = target.type === "boundary" ? 0.5 : 0.1; // km
      if (startDist > maxDist || endDist > maxDist) continue;

      // Extract the sub-line between the two projected points
      const sliced = lineSlice(projStart, projEnd, targetLine);
      const slicedCoords = sliced.geometry.coordinates as [number, number][];

      if (slicedCoords.length < 2) continue;

      // Verify the sliced line isn't too long (>5x the straight-line distance)
      const slicedLen = length(sliced, { units: "meters" });
      const directDist = Math.sqrt(
        (coords[startIdx]![0] - coords[endIdx]![0]) ** 2 +
        (coords[startIdx]![1] - coords[endIdx]![1]) ** 2,
      ) * 111_320; // rough degrees to meters
      if (slicedLen > directDist * 5 && directDist > 10) continue;

      // Score: average distance of projected endpoints from original vertices
      const score = (startDist + endDist) / 2;

      // The replacement coords: exclude first and last (those are the start/end vertices)
      // We want the interior points of the sliced line
      const interiorCoords = slicedCoords.slice(1, -1);

      candidates.push({
        label: target.label ?? target.type,
        type: target.type as "road" | "neighbor" | "boundary",
        replacementCoords: interiorCoords,
        score,
      });
    } catch {
      // Skip targets that cause errors in turf operations
      continue;
    }
  }

  // Sort by score (lower = closer = better) and limit
  candidates.sort((a, b) => a.score - b.score);
  return candidates.slice(0, maxCandidates);
}

// ─── Hook ────────────────────────────────────────���────────────────

export function useClipSegment(
  editCoords: [number, number][],
  snapTargets: SnapTarget[],
): UseClipSegmentReturn {
  const [phase, setPhase] = useState<ClipPhase>("idle");
  const [startIndex, setStartIndex] = useState<number | null>(null);
  const [endIndex, setEndIndex] = useState<number | null>(null);

  // Compute candidates when both vertices are selected
  const candidates = useMemo(() => {
    if (startIndex === null || endIndex === null || editCoords.length < 4) {
      return [];
    }
    return findClipCandidates(editCoords, startIndex, endIndex, snapTargets);
  }, [startIndex, endIndex, editCoords, snapTargets]);

  const start = useCallback(() => {
    setPhase("select_start");
    setStartIndex(null);
    setEndIndex(null);
  }, []);

  const selectVertex = useCallback(
    (index: number) => {
      if (phase === "idle" || phase === "select_start") {
        setStartIndex(index);
        setEndIndex(null);
        setPhase("select_end");
      } else if (phase === "select_end") {
        if (index === startIndex) return; // Same vertex — ignore
        setEndIndex(index);
        setPhase("choose_target");
      }
    },
    [phase, startIndex],
  );

  const applyClip = useCallback(
    (candidate: ClipCandidate): [number, number][] | null => {
      if (startIndex === null || endIndex === null || editCoords.length < 4) {
        return null;
      }

      const result = buildReplacedPolygon(
        editCoords,
        startIndex,
        endIndex,
        candidate.replacementCoords,
      );

      // Reset state
      setPhase("idle");
      setStartIndex(null);
      setEndIndex(null);

      return result.length >= 4 ? result : null;
    },
    [startIndex, endIndex, editCoords],
  );

  const straighten = useCallback((): [number, number][] | null => {
    if (startIndex === null || endIndex === null || editCoords.length < 4) {
      return null;
    }

    // Replace with empty interior (just keep start and end vertices)
    const result = buildReplacedPolygon(editCoords, startIndex, endIndex, []);

    setPhase("idle");
    setStartIndex(null);
    setEndIndex(null);

    return result.length >= 4 ? result : null;
  }, [startIndex, endIndex, editCoords]);

  const cancel = useCallback(() => {
    setPhase("idle");
    setStartIndex(null);
    setEndIndex(null);
  }, []);

  return {
    phase,
    startIndex,
    endIndex,
    candidates,
    start,
    selectVertex,
    applyClip,
    straighten,
    cancel,
  };
}
