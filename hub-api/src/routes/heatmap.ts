/**
 * Heatmap routes — territory and address heatmap data.
 * Supports 6 modes: recency, density, dnc, language, gaps, status.
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";

// ─── Schemas ────────────────────────────────────────────────────────

const HeatmapQuerystring = Type.Object({
  mode: Type.Union([
    Type.Literal("recency"),
    Type.Literal("density"),
    Type.Literal("dnc"),
    Type.Literal("language"),
    Type.Literal("gaps"),
    Type.Literal("status"),
  ]),
  bbox: Type.Optional(Type.String({ description: "minLng,minLat,maxLng,maxLat" })),
  territoryId: Type.Optional(Type.String({ format: "uuid" })),
});
type HeatmapQuerystringType = Static<typeof HeatmapQuerystring>;

/** Max points before clustering by geohash. */
const MAX_POINTS = 2000;

/**
 * Simple geohash encoder for clustering.
 * Returns a short hash string for grouping nearby points.
 */
function simpleGeohash(lat: number, lng: number, precision = 5): string {
  const base32 = "0123456789bcdefghjkmnpqrstuvwxyz";
  let minLat = -90, maxLat = 90;
  let minLng = -180, maxLng = 180;
  let hash = "";
  let isEven = true;
  let bit = 0;
  let ch = 0;

  while (hash.length < precision) {
    if (isEven) {
      const mid = (minLng + maxLng) / 2;
      if (lng > mid) {
        ch |= 1 << (4 - bit);
        minLng = mid;
      } else {
        maxLng = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat > mid) {
        ch |= 1 << (4 - bit);
        minLat = mid;
      } else {
        maxLat = mid;
      }
    }
    isEven = !isEven;
    bit++;
    if (bit === 5) {
      hash += base32[ch];
      bit = 0;
      ch = 0;
    }
  }

  return hash;
}

/**
 * Parse and validate bbox query parameter.
 */
function parseBbox(bbox: string | undefined): [number, number, number, number] | null {
  if (!bbox) return null;
  const parts = bbox.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => isNaN(n))) return null;
  return parts as [number, number, number, number];
}

export async function heatmapRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: HeatmapQuerystringType }>(
    "/territories/heatmap",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_VIEW),
      schema: { querystring: HeatmapQuerystring },
    },
    async (request, reply) => {
      const { mode, bbox: bboxStr, territoryId } = request.query;
      const bbox = parseBbox(bboxStr);

      if (bboxStr && !bbox) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "bbox must be 4 comma-separated numbers: minLng,minLat,maxLng,maxLat",
        });
      }

      // Territory-level modes aggregate from Territory/Address tables
      if (mode === "status" || mode === "gaps") {
        return territoryLevelHeatmap(mode, territoryId);
      }

      // Address-level modes return GeoJSON points
      return addressLevelHeatmap(mode, bbox, territoryId, reply);
    },
  );
}

async function territoryLevelHeatmap(
  mode: "status" | "gaps",
  territoryId?: string,
) {
  const where: Record<string, unknown> = {};
  if (territoryId) where.id = territoryId;

  const territories = await prisma.territory.findMany({
    where,
    include: {
      addresses: {
        select: {
          id: true,
          status: true,
          lat: true,
          lng: true,
        },
      },
      assignments: {
        where: { returnedAt: null },
        select: { id: true, assignedAt: true },
      },
      gapDetectionRuns: {
        where: { status: "completed" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { gapCount: true, totalBuildings: true, coveredCount: true },
      },
    },
  });

  if (mode === "status") {
    return territories.map((t) => ({
      territoryId: t.id,
      number: t.number,
      name: t.name,
      totalAddresses: t.addresses.length,
      activeAddresses: t.addresses.filter((a) => a.status === "active").length,
      dncAddresses: t.addresses.filter((a) => a.status === "do_not_call").length,
      isAssigned: t.assignments.length > 0,
      boundaries: t.boundaries,
    }));
  }

  // mode === "gaps"
  return territories.map((t) => {
    const latestRun = t.gapDetectionRuns[0];
    return {
      territoryId: t.id,
      number: t.number,
      name: t.name,
      totalBuildings: latestRun?.totalBuildings ?? null,
      coveredCount: latestRun?.coveredCount ?? null,
      gapCount: latestRun?.gapCount ?? null,
      coveragePercent: latestRun?.totalBuildings
        ? Math.round(((latestRun.coveredCount ?? 0) / latestRun.totalBuildings) * 100)
        : null,
      boundaries: t.boundaries,
    };
  });
}

async function addressLevelHeatmap(
  mode: "recency" | "density" | "dnc" | "language",
  bbox: [number, number, number, number] | null,
  territoryId: string | undefined,
  reply: any,
) {
  const where: Record<string, unknown> = {};
  if (territoryId) where.territoryId = territoryId;

  let addresses = await prisma.address.findMany({
    where,
    select: {
      id: true,
      lat: true,
      lng: true,
      status: true,
      lastVisitAt: true,
      languages: true,
      territoryId: true,
    },
  });

  // Apply bbox filter
  if (bbox) {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    addresses = addresses.filter(
      (a) => a.lng >= minLng && a.lng <= maxLng && a.lat >= minLat && a.lat <= maxLat,
    );
  }

  // Compute per-point properties based on mode
  let points = addresses.map((a) => {
    let value: number | string | string[] | null = null;

    switch (mode) {
      case "recency": {
        if (a.lastVisitAt) {
          const daysAgo = Math.floor((Date.now() - new Date(a.lastVisitAt).getTime()) / (1000 * 60 * 60 * 24));
          value = daysAgo;
        } else {
          value = -1; // Never visited
        }
        break;
      }
      case "density":
        value = 1; // Each point counts as 1 — client clusters
        break;
      case "dnc":
        value = a.status === "do_not_call" ? 1 : 0;
        break;
      case "language":
        value = a.languages.length > 0 ? a.languages : null;
        break;
    }

    return {
      lat: a.lat,
      lng: a.lng,
      value,
      territoryId: a.territoryId,
    };
  });

  // If too many points, cluster by geohash
  let clustered = false;
  if (points.length > MAX_POINTS) {
    clustered = true;
    const clusters = new Map<
      string,
      { lat: number; lng: number; count: number; values: (number | string | string[] | null)[] }
    >();

    for (const p of points) {
      const hash = simpleGeohash(p.lat, p.lng, 6);
      const existing = clusters.get(hash);
      if (existing) {
        existing.lat = (existing.lat * existing.count + p.lat) / (existing.count + 1);
        existing.lng = (existing.lng * existing.count + p.lng) / (existing.count + 1);
        existing.count++;
        existing.values.push(p.value);
      } else {
        clusters.set(hash, {
          lat: p.lat,
          lng: p.lng,
          count: 1,
          values: [p.value],
        });
      }
    }

    return {
      type: "FeatureCollection",
      clustered: true,
      totalPoints: points.length,
      features: [...clusters.values()].map((c) => ({
        type: "Feature",
        properties: {
          mode,
          count: c.count,
          aggregatedValue:
            mode === "recency"
              ? Math.min(...(c.values.filter((v) => typeof v === "number") as number[]))
              : mode === "density"
                ? c.count
                : mode === "dnc"
                  ? (c.values.filter((v) => v === 1) as number[]).length
                  : null,
        },
        geometry: {
          type: "Point",
          coordinates: [c.lng, c.lat],
        },
      })),
    };
  }

  return {
    type: "FeatureCollection",
    clustered: false,
    totalPoints: points.length,
    features: points.map((p) => ({
      type: "Feature",
      properties: {
        mode,
        value: p.value,
        territoryId: p.territoryId,
      },
      geometry: {
        type: "Point",
        coordinates: [p.lng, p.lat],
      },
    })),
  };
}
