/**
 * Campaign report generation.
 *
 * Produces summary, per-territory, per-publisher, and per-meeting-point
 * statistics from campaign data fetched via Prisma.
 */

export interface CampaignReport {
  summary: {
    totalTerritories: number;
    totalAddresses: number;
    visitsByOutcome: Record<string, number>;
  };
  perTerritory: Array<{
    territoryId: string;
    number: string;
    visits: number;
    coverage: number;
  }>;
  perPublisher: Array<{
    publisherId: string;
    name: string;
    visits: number;
  }>;
  perMeetingPoint: Array<{
    meetingPointId: string;
    name: string;
    visits: number;
    territories: number;
  }>;
}

export interface CampaignReportInput {
  campaign: {
    startDate: Date;
    endDate: Date;
  };
  meetingPoints: Array<{
    id: string;
    name: string | null;
    territoryIds: string[];
  }>;
  territories: Array<{
    id: string;
    number: string;
    addresses: Array<{
      id: string;
      visits: Array<{
        publisherId: string;
        outcome: string;
        visitedAt: Date;
      }>;
    }>;
  }>;
  publishers: Map<string, string>; // publisherId → displayName
}

export function generateCampaignReport(
  input: CampaignReportInput,
): CampaignReport {
  const { campaign, meetingPoints, territories, publishers } = input;

  const visitsByOutcome: Record<string, number> = {};
  const publisherVisits: Record<string, number> = {};
  let totalAddresses = 0;

  const perTerritory: CampaignReport["perTerritory"] = [];

  for (const territory of territories) {
    const addressCount = territory.addresses.length;
    totalAddresses += addressCount;
    let territoryVisitCount = 0;
    let addressesVisited = 0;

    for (const address of territory.addresses) {
      // Filter visits within campaign date range
      const campaignVisits = address.visits.filter(
        (v) => v.visitedAt >= campaign.startDate && v.visitedAt <= campaign.endDate,
      );

      if (campaignVisits.length > 0) {
        addressesVisited++;
      }

      for (const visit of campaignVisits) {
        territoryVisitCount++;
        visitsByOutcome[visit.outcome] =
          (visitsByOutcome[visit.outcome] ?? 0) + 1;
        publisherVisits[visit.publisherId] =
          (publisherVisits[visit.publisherId] ?? 0) + 1;
      }
    }

    perTerritory.push({
      territoryId: territory.id,
      number: territory.number,
      visits: territoryVisitCount,
      coverage: addressCount > 0 ? addressesVisited / addressCount : 0,
    });
  }

  // Build per-publisher results
  const perPublisher: CampaignReport["perPublisher"] = Object.entries(
    publisherVisits,
  )
    .map(([publisherId, visits]) => ({
      publisherId,
      name: publishers.get(publisherId) ?? "Unknown",
      visits,
    }))
    .sort((a, b) => b.visits - a.visits);

  // Build per-meeting-point results
  const territoryVisitMap = new Map(
    perTerritory.map((t) => [t.territoryId, t.visits]),
  );

  const perMeetingPoint: CampaignReport["perMeetingPoint"] = meetingPoints.map(
    (mp) => ({
      meetingPointId: mp.id,
      name: mp.name ?? "Unnamed",
      visits: mp.territoryIds.reduce(
        (sum, tid) => sum + (territoryVisitMap.get(tid) ?? 0),
        0,
      ),
      territories: mp.territoryIds.length,
    }),
  );

  return {
    summary: {
      totalTerritories: territories.length,
      totalAddresses,
      visitsByOutcome,
    },
    perTerritory,
    perPublisher,
    perMeetingPoint,
  };
}

/**
 * Convert a CampaignReport to CSV format.
 */
export function campaignReportToCsv(report: CampaignReport): string {
  const lines: string[] = [];

  // Summary section
  lines.push("# Summary");
  lines.push(`Total Territories,${report.summary.totalTerritories}`);
  lines.push(`Total Addresses,${report.summary.totalAddresses}`);
  for (const [outcome, count] of Object.entries(
    report.summary.visitsByOutcome,
  )) {
    lines.push(`Visits: ${outcome},${count}`);
  }
  lines.push("");

  // Per-territory section
  lines.push("# Per Territory");
  lines.push("Territory ID,Number,Visits,Coverage %");
  for (const t of report.perTerritory) {
    lines.push(
      `${t.territoryId},${t.number},${t.visits},${(t.coverage * 100).toFixed(1)}`,
    );
  }
  lines.push("");

  // Per-publisher section
  lines.push("# Per Publisher");
  lines.push("Publisher ID,Name,Visits");
  for (const p of report.perPublisher) {
    lines.push(`${p.publisherId},"${p.name}",${p.visits}`);
  }
  lines.push("");

  // Per-meeting-point section
  lines.push("# Per Meeting Point");
  lines.push("Meeting Point ID,Name,Visits,Territories");
  for (const mp of report.perMeetingPoint) {
    lines.push(
      `${mp.meetingPointId},"${mp.name}",${mp.visits},${mp.territories}`,
    );
  }

  return lines.join("\n");
}
