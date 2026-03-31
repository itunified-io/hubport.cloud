import { describe, it, expect } from "vitest";
import { distanceKm } from "../haversine.js";

describe("haversine distanceKm", () => {
  it("returns 0 for identical coordinates", () => {
    expect(distanceKm(48.1351, 11.582, 48.1351, 11.582)).toBe(0);
  });

  it("calculates Berlin to Munich (~504 km)", () => {
    // Berlin: 52.52, 13.405 — Munich: 48.1351, 11.582
    const d = distanceKm(52.52, 13.405, 48.1351, 11.582);
    expect(d).toBeGreaterThan(490);
    expect(d).toBeLessThan(510);
  });

  it("calculates New York to London (~5570 km)", () => {
    const d = distanceKm(40.7128, -74.006, 51.5074, -0.1278);
    expect(d).toBeGreaterThan(5500);
    expect(d).toBeLessThan(5600);
  });

  it("is symmetric", () => {
    const d1 = distanceKm(52.52, 13.405, 48.1351, 11.582);
    const d2 = distanceKm(48.1351, 11.582, 52.52, 13.405);
    expect(d1).toBeCloseTo(d2, 10);
  });

  it("handles antipodal points (~20000 km)", () => {
    const d = distanceKm(0, 0, 0, 180);
    expect(d).toBeGreaterThan(19900);
    expect(d).toBeLessThan(20100);
  });
});
