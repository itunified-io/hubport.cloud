import { describe, it, expect } from "vitest";
import { filterByDepth } from "../sharing-depth-filter.js";

const SAMPLE_TERRITORIES = [
  {
    number: "T-01",
    name: "Downtown",
    boundaries: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    addresses: [
      {
        id: "addr-1",
        lat: 48.1,
        lng: 11.5,
        street: "Main St",
        houseNumber: "42",
        city: "Munich",
        postcode: "80331",
        status: "active",
        lastVisitAt: "2026-01-15T10:00:00Z",
        notes: "Friendly resident",
      },
      {
        id: "addr-2",
        lat: 48.2,
        lng: 11.6,
        street: "Oak Ave",
        houseNumber: "7",
        city: "Munich",
        postcode: "80333",
        status: "do_not_call",
        lastVisitAt: null,
        notes: "DNC since 2025",
      },
    ],
  },
];

describe("filterByDepth", () => {
  it("boundary: returns only number, name, boundaries", () => {
    const result = filterByDepth(SAMPLE_TERRITORIES, "boundary");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      number: "T-01",
      name: "Downtown",
      boundaries: SAMPLE_TERRITORIES[0]!.boundaries,
    });
    expect(result[0]).not.toHaveProperty("addresses");
  });

  it("addresses: includes address list without visit data", () => {
    const result = filterByDepth(SAMPLE_TERRITORIES, "addresses");
    expect(result).toHaveLength(1);
    expect(result[0]!.addresses).toHaveLength(2);

    const addr = result[0]!.addresses![0]!;
    expect(addr.id).toBe("addr-1");
    expect(addr.lat).toBe(48.1);
    expect(addr.street).toBe("Main St");
    // Should NOT have visit data
    expect(addr).not.toHaveProperty("status");
    expect(addr).not.toHaveProperty("lastVisitAt");
    expect(addr).not.toHaveProperty("notes");
  });

  it("full: includes everything including visit data", () => {
    const result = filterByDepth(SAMPLE_TERRITORIES, "full");
    expect(result).toHaveLength(1);
    expect(result[0]!.addresses).toHaveLength(2);

    const addr = result[0]!.addresses![0]!;
    expect(addr.id).toBe("addr-1");
    expect(addr.status).toBe("active");
    expect(addr.lastVisitAt).toBe("2026-01-15T10:00:00Z");
    expect(addr.notes).toBe("Friendly resident");
  });

  it("handles empty territory list", () => {
    expect(filterByDepth([], "full")).toEqual([]);
  });

  it("handles territories without addresses", () => {
    const territories = [{ number: "T-02", name: "Empty", boundaries: null }];
    const result = filterByDepth(territories, "addresses");
    expect(result[0]!.addresses).toEqual([]);
  });
});
