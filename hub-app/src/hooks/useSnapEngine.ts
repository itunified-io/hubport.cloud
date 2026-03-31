import { useCallback, useMemo, useRef } from "react";
import {
  snapVertex,
  type SnapTarget,
  type SnapResult,
  DEFAULT_SNAP_TOLERANCE,
} from "../pages/territories/SnapEngine";

interface SnapContextFeature {
  type: "Feature";
  properties: {
    snapType: string;
    osmId?: string;
    name?: string;
    [key: string]: unknown;
  };
  geometry: {
    type: string;
    coordinates: any;
  };
}

export interface UseSnapEngineReturn {
  /** Snap a vertex position against current targets */
  snap: (
    position: [number, number],
    altPressed: boolean,
  ) => SnapResult;
  /** Number of available snap targets */
  targetCount: number;
}

/**
 * Hook wrapping the SnapEngine with state management.
 * Converts GeoJSON FeatureCollection snap context into SnapTarget format.
 * Uses throttling to prevent excessive snap calculations during drag.
 */
export function useSnapEngine(
  snapContextFeatures: SnapContextFeature[] | null,
  neighborGeometries: object[] = [],
  congregationBoundary: object | null = null,
  toleranceCoordUnits: number = 0.0001, // ~11m at equator
): UseSnapEngineReturn {
  const lastSnapTimeRef = useRef(0);
  const lastResultRef = useRef<SnapResult | null>(null);

  // Convert snap context features to SnapTarget format
  const snapTargets = useMemo((): SnapTarget[] => {
    const targets: SnapTarget[] = [];

    // Add neighbor territory edges (highest priority)
    for (const geom of neighborGeometries) {
      targets.push({
        type: "neighbor",
        label: "Neighbor",
        geometry: geom as SnapTarget["geometry"],
      });
    }

    // Add features from snap context
    if (snapContextFeatures) {
      for (const feature of snapContextFeatures) {
        const snapType = feature.properties.snapType;
        if (snapType === "road") {
          targets.push({
            type: "road",
            label: feature.properties.name ?? "Road",
            geometry: feature.geometry,
          });
        } else if (snapType === "building") {
          targets.push({
            type: "building",
            label: feature.properties.streetAddress as string ?? "Building",
            geometry: feature.geometry,
          });
        }
        // Water bodies are not snap targets (they are exclusion zones)
      }
    }

    // Add congregation boundary
    if (congregationBoundary) {
      targets.push({
        type: "boundary",
        label: "Boundary",
        geometry: congregationBoundary as SnapTarget["geometry"],
      });
    }

    return targets;
  }, [snapContextFeatures, neighborGeometries, congregationBoundary]);

  const snap = useCallback(
    (position: [number, number], altPressed: boolean): SnapResult => {
      // Alt override: no snapping
      if (altPressed) {
        return { position, label: null, snappedTo: null };
      }

      // Throttle: max 60fps (16ms)
      const now = Date.now();
      if (now - lastSnapTimeRef.current < 16 && lastResultRef.current) {
        return lastResultRef.current;
      }
      lastSnapTimeRef.current = now;

      const result = snapVertex(
        position,
        snapTargets,
        toleranceCoordUnits,
      );
      lastResultRef.current = result;
      return result;
    },
    [snapTargets, toleranceCoordUnits],
  );

  return {
    snap,
    targetCount: snapTargets.length,
  };
}

export { DEFAULT_SNAP_TOLERANCE };
