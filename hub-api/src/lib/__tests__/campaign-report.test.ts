import { describe, it, expect } from "vitest";
import {
  generateCampaignReport,
  campaignReportToCsv,
  type CampaignReportInput,
} from "../campaign-report.js";

function makeInput(
  overrides?: Partial<CampaignReportInput>,
): CampaignReportInput {
  return {
    campaign: {
      startDate: new Date("2026-03-01"),
      endDate: new Date("2026-03-31"),
    },
    meetingPoints: [],
    territories: [],
    publishers: new Map(),
    ...overrides,
  };
}

describe("generateCampaignReport", () => {
  it("returns empty report for no territories", () => {
    const report = generateCampaignReport(makeInput());
    expect(report.summary.totalTerritories).toBe(0);
    expect(report.summary.totalAddresses).toBe(0);
    expect(report.summary.visitsByOutcome).toEqual({});
    expect(report.perTerritory).toHaveLength(0);
    expect(report.perPublisher).toHaveLength(0);
    expect(report.perMeetingPoint).toHaveLength(0);
  });

  it("counts visits within campaign date range", () => {
    const report = generateCampaignReport(
      makeInput({
        territories: [
          {
            id: "t1",
            number: "001",
            addresses: [
              {
                id: "a1",
                visits: [
                  {
                    publisherId: "p1",
                    outcome: "contacted",
                    visitedAt: new Date("2026-03-15"),
                  },
                  {
                    publisherId: "p1",
                    outcome: "not_at_home",
                    visitedAt: new Date("2026-02-15"), // before campaign
                  },
                ],
              },
            ],
          },
        ],
        publishers: new Map([["p1", "Alice"]]),
      }),
    );

    expect(report.summary.visitsByOutcome).toEqual({ contacted: 1 });
    expect(report.perTerritory[0].visits).toBe(1);
    expect(report.perPublisher).toEqual([
      { publisherId: "p1", name: "Alice", visits: 1 },
    ]);
  });

  it("calculates territory coverage correctly", () => {
    const report = generateCampaignReport(
      makeInput({
        territories: [
          {
            id: "t1",
            number: "001",
            addresses: [
              {
                id: "a1",
                visits: [
                  {
                    publisherId: "p1",
                    outcome: "contacted",
                    visitedAt: new Date("2026-03-10"),
                  },
                ],
              },
              {
                id: "a2",
                visits: [], // not visited
              },
              {
                id: "a3",
                visits: [
                  {
                    publisherId: "p2",
                    outcome: "not_at_home",
                    visitedAt: new Date("2026-03-20"),
                  },
                ],
              },
            ],
          },
        ],
        publishers: new Map([
          ["p1", "Alice"],
          ["p2", "Bob"],
        ]),
      }),
    );

    // 2 out of 3 addresses visited
    expect(report.perTerritory[0].coverage).toBeCloseTo(2 / 3, 5);
    expect(report.summary.totalAddresses).toBe(3);
  });

  it("handles territory with zero addresses (coverage = 0)", () => {
    const report = generateCampaignReport(
      makeInput({
        territories: [{ id: "t1", number: "001", addresses: [] }],
      }),
    );
    expect(report.perTerritory[0].coverage).toBe(0);
    expect(report.perTerritory[0].visits).toBe(0);
  });

  it("aggregates meeting point visits from assigned territories", () => {
    const report = generateCampaignReport(
      makeInput({
        meetingPoints: [
          { id: "mp1", name: "Park", territoryIds: ["t1", "t2"] },
          { id: "mp2", name: null, territoryIds: ["t3"] },
        ],
        territories: [
          {
            id: "t1",
            number: "001",
            addresses: [
              {
                id: "a1",
                visits: [
                  {
                    publisherId: "p1",
                    outcome: "contacted",
                    visitedAt: new Date("2026-03-10"),
                  },
                ],
              },
            ],
          },
          {
            id: "t2",
            number: "002",
            addresses: [
              {
                id: "a2",
                visits: [
                  {
                    publisherId: "p1",
                    outcome: "contacted",
                    visitedAt: new Date("2026-03-11"),
                  },
                  {
                    publisherId: "p2",
                    outcome: "not_at_home",
                    visitedAt: new Date("2026-03-12"),
                  },
                ],
              },
            ],
          },
          {
            id: "t3",
            number: "003",
            addresses: [],
          },
        ],
        publishers: new Map([
          ["p1", "Alice"],
          ["p2", "Bob"],
        ]),
      }),
    );

    expect(report.perMeetingPoint).toHaveLength(2);
    expect(report.perMeetingPoint[0]).toEqual({
      meetingPointId: "mp1",
      name: "Park",
      visits: 3, // t1 has 1, t2 has 2
      territories: 2,
    });
    expect(report.perMeetingPoint[1]).toEqual({
      meetingPointId: "mp2",
      name: "Unnamed",
      visits: 0,
      territories: 1,
    });
  });

  it("sorts publishers by visit count descending", () => {
    const report = generateCampaignReport(
      makeInput({
        territories: [
          {
            id: "t1",
            number: "001",
            addresses: [
              {
                id: "a1",
                visits: [
                  {
                    publisherId: "p1",
                    outcome: "contacted",
                    visitedAt: new Date("2026-03-10"),
                  },
                  {
                    publisherId: "p2",
                    outcome: "contacted",
                    visitedAt: new Date("2026-03-11"),
                  },
                  {
                    publisherId: "p2",
                    outcome: "not_at_home",
                    visitedAt: new Date("2026-03-12"),
                  },
                  {
                    publisherId: "p2",
                    outcome: "contacted",
                    visitedAt: new Date("2026-03-13"),
                  },
                ],
              },
            ],
          },
        ],
        publishers: new Map([
          ["p1", "Alice"],
          ["p2", "Bob"],
        ]),
      }),
    );

    expect(report.perPublisher[0].name).toBe("Bob");
    expect(report.perPublisher[0].visits).toBe(3);
    expect(report.perPublisher[1].name).toBe("Alice");
    expect(report.perPublisher[1].visits).toBe(1);
  });

  it("uses 'Unknown' for publishers not in the map", () => {
    const report = generateCampaignReport(
      makeInput({
        territories: [
          {
            id: "t1",
            number: "001",
            addresses: [
              {
                id: "a1",
                visits: [
                  {
                    publisherId: "p-unknown",
                    outcome: "contacted",
                    visitedAt: new Date("2026-03-10"),
                  },
                ],
              },
            ],
          },
        ],
        publishers: new Map(),
      }),
    );

    expect(report.perPublisher[0].name).toBe("Unknown");
  });
});

describe("campaignReportToCsv", () => {
  it("generates valid CSV with all sections", () => {
    const report = generateCampaignReport(
      makeInput({
        meetingPoints: [{ id: "mp1", name: "Park", territoryIds: ["t1"] }],
        territories: [
          {
            id: "t1",
            number: "001",
            addresses: [
              {
                id: "a1",
                visits: [
                  {
                    publisherId: "p1",
                    outcome: "contacted",
                    visitedAt: new Date("2026-03-10"),
                  },
                ],
              },
            ],
          },
        ],
        publishers: new Map([["p1", "Alice"]]),
      }),
    );

    const csv = campaignReportToCsv(report);
    expect(csv).toContain("# Summary");
    expect(csv).toContain("Total Territories,1");
    expect(csv).toContain("Total Addresses,1");
    expect(csv).toContain("Visits: contacted,1");
    expect(csv).toContain("# Per Territory");
    expect(csv).toContain("t1,001,1,100.0");
    expect(csv).toContain("# Per Publisher");
    expect(csv).toContain('p1,"Alice",1');
    expect(csv).toContain("# Per Meeting Point");
    expect(csv).toContain('mp1,"Park",1,1');
  });
});
