import { describe, it, expect } from "vitest";
import { snapVertex, snapAll, type SnapTarget } from "../SnapEngine";

describe("SnapEngine", () => {
  describe("snapVertex", () => {
    it("returns original position when no targets exist", () => {
      const result = snapVertex([10.0, 48.0], [], 0.001);
      expect(result.position).toEqual([10.0, 48.0]);
      expect(result.snappedTo).toBeNull();
      expect(result.label).toBeNull();
    });

    it("snaps to nearest road within tolerance", () => {
      const targets: SnapTarget[] = [
        {
          type: "road",
          label: "Main Street",
          geometry: {
            type: "LineString",
            coordinates: [
              [10.0, 48.0],
              [10.1, 48.0],
            ],
          },
        },
      ];

      // Point slightly above the road
      const result = snapVertex([10.05, 48.0005], targets, 0.001);
      expect(result.snappedTo).toBe("road");
      expect(result.label).toBe("Main Street");
      // Should snap to the road (y=48.0)
      expect(result.position[1]).toBeCloseTo(48.0, 5);
      expect(result.position[0]).toBeCloseTo(10.05, 5);
    });

    it("does not snap when beyond tolerance", () => {
      const targets: SnapTarget[] = [
        {
          type: "road",
          label: "Far Road",
          geometry: {
            type: "LineString",
            coordinates: [
              [10.0, 48.0],
              [10.1, 48.0],
            ],
          },
        },
      ];

      // Point far from the road
      const result = snapVertex([10.05, 48.1], targets, 0.001);
      expect(result.snappedTo).toBeNull();
      expect(result.position).toEqual([10.05, 48.1]);
    });

    it("prioritizes neighbor edges over roads", () => {
      const targets: SnapTarget[] = [
        {
          type: "road",
          label: "Road",
          geometry: {
            type: "LineString",
            coordinates: [
              [10.0, 48.0],
              [10.1, 48.0],
            ],
          },
        },
        {
          type: "neighbor",
          label: "Territory 5",
          geometry: {
            type: "LineString",
            coordinates: [
              [10.0, 48.0001],
              [10.1, 48.0001],
            ],
          },
        },
      ];

      // Point between road and neighbor — should snap to neighbor (higher priority)
      const result = snapVertex([10.05, 48.00005], targets, 0.001);
      expect(result.snappedTo).toBe("neighbor");
    });

    it("prioritizes road over congregation boundary", () => {
      const targets: SnapTarget[] = [
        {
          type: "boundary",
          label: "Congregation Boundary",
          geometry: {
            type: "LineString",
            coordinates: [
              [10.0, 48.0],
              [10.1, 48.0],
            ],
          },
        },
        {
          type: "road",
          label: "Road",
          geometry: {
            type: "LineString",
            coordinates: [
              [10.0, 48.0001],
              [10.1, 48.0001],
            ],
          },
        },
      ];

      const result = snapVertex([10.05, 48.00005], targets, 0.001);
      expect(result.snappedTo).toBe("road");
    });

    it("snaps to building points", () => {
      const targets: SnapTarget[] = [
        {
          type: "building",
          label: "Building",
          geometry: {
            type: "Point",
            coordinates: [10.05, 48.05],
          },
        },
      ];

      const result = snapVertex([10.0501, 48.0501], targets, 0.001);
      expect(result.snappedTo).toBe("building");
      expect(result.position).toEqual([10.05, 48.05]);
    });

    it("snaps to polygon edges (water bodies)", () => {
      const targets: SnapTarget[] = [
        {
          type: "boundary",
          label: "Lake",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [10.0, 48.0],
                [10.1, 48.0],
                [10.1, 48.1],
                [10.0, 48.1],
                [10.0, 48.0],
              ],
            ],
          },
        },
      ];

      // Point near bottom edge
      const result = snapVertex([10.05, 48.0002], targets, 0.001);
      expect(result.snappedTo).toBe("boundary");
      expect(result.position[1]).toBeCloseTo(48.0, 5);
    });
  });

  describe("snapAll", () => {
    const roadTargets: SnapTarget[] = [
      {
        type: "road",
        label: "Hauptstraße",
        geometry: {
          type: "LineString",
          coordinates: [[10.0, 48.0], [10.1, 48.0]],
        },
      },
    ];

    it("snaps all vertices within tolerance", () => {
      const vertices: [number, number][] = [
        [10.02, 48.0003],
        [10.05, 48.0002],
        [10.08, 48.0004],
      ];

      const result = snapAll(vertices, roadTargets, 0.001);
      expect(result.snapped.length).toBe(3);
      for (const v of result.snapped) {
        expect(v[1]).toBeCloseTo(48.0, 4);
      }
      expect(result.report.length).toBe(3);
      expect(result.report[0]!.snappedTo).toBe("road");
    });

    it("leaves vertices unchanged when beyond tolerance", () => {
      const vertices: [number, number][] = [
        [10.02, 48.1],
        [10.05, 48.0002],
      ];

      const result = snapAll(vertices, roadTargets, 0.001);
      expect(result.snapped[0]).toEqual([10.02, 48.1]);
      expect(result.snapped[1]![1]).toBeCloseTo(48.0, 4);
      expect(result.report[0]!.snappedTo).toBeNull();
      expect(result.report[1]!.snappedTo).toBe("road");
    });

    it("returns empty arrays for empty input", () => {
      const result = snapAll([], roadTargets, 0.001);
      expect(result.snapped).toEqual([]);
      expect(result.report).toEqual([]);
    });
  });
});
