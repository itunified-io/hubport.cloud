/**
 * BullMQ Worker for OSM address refresh.
 * Processes jobs from the "osm-refresh" queue.
 *
 * For each territory:
 * 1. Fetch territory polygon (boundaries)
 * 2. Query buildings via Overpass API
 * 3. Match existing addresses by osmId, create new ones, update changed
 * 4. Update OsmRefreshQueue status with counters
 */

import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import prisma from "../lib/prisma.js";
import { queryBuildingsInBBox, type OverpassBuilding } from "../lib/osm-overpass.js";

export interface OsmRefreshJobData {
  territoryId: string;
  queueRecordId: string;
}

/**
 * Compute bounding box from GeoJSON polygon boundaries.
 */
function bboxFromGeoJSON(boundaries: unknown): {
  south: number;
  west: number;
  north: number;
  east: number;
} | null {
  if (!boundaries || typeof boundaries !== "object") return null;

  const geo = boundaries as { type?: string; coordinates?: number[][][] | number[][][][] };
  if (!geo.coordinates) return null;

  let allCoords: number[][] = [];

  if (geo.type === "Polygon") {
    const rings = geo.coordinates as number[][][];
    for (const ring of rings) {
      allCoords = allCoords.concat(ring);
    }
  } else if (geo.type === "MultiPolygon") {
    const polys = geo.coordinates as number[][][][];
    for (const poly of polys) {
      for (const ring of poly) {
        allCoords = allCoords.concat(ring);
      }
    }
  } else {
    return null;
  }

  if (allCoords.length === 0) return null;

  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;

  for (const coord of allCoords) {
    const [lng, lat] = coord as [number, number];
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
  }

  return { south, west, north, east };
}

/**
 * Process a single OSM refresh job.
 */
export async function processOsmRefresh(job: Job<OsmRefreshJobData>): Promise<void> {
  const { territoryId, queueRecordId } = job.data;

  // Mark as processing
  await prisma.osmRefreshQueue.update({
    where: { id: queueRecordId },
    data: { status: "processing", startedAt: new Date() },
  });

  try {
    // 1. Fetch territory polygon
    const territory = await prisma.territory.findUnique({
      where: { id: territoryId },
    });

    if (!territory) {
      throw new Error(`Territory ${territoryId} not found`);
    }

    if (!territory.boundaries) {
      throw new Error(`Territory ${territoryId} has no boundaries`);
    }

    // 2. Compute bbox and query buildings
    const bbox = bboxFromGeoJSON(territory.boundaries);
    if (!bbox) {
      throw new Error(`Could not compute bounding box for territory ${territoryId}`);
    }

    const buildings = await queryBuildingsInBBox(
      bbox.south,
      bbox.west,
      bbox.north,
      bbox.east,
    );

    // 3. Filter to only buildings with addresses
    const addressableBuildings = buildings.filter((b: OverpassBuilding) => b.hasAddress);

    // 4. Get existing addresses for this territory
    const existingAddresses = await prisma.address.findMany({
      where: { territoryId },
      select: { id: true, osmId: true, street: true, houseNumber: true },
    });

    const existingByOsmId = new Map(
      existingAddresses.filter((a) => a.osmId).map((a) => [a.osmId!, a]),
    );

    let addressesCreated = 0;
    let addressesUpdated = 0;

    // 5. Match/create/update addresses
    for (const building of addressableBuildings) {
      const existing = existingByOsmId.get(building.osmId);

      if (existing) {
        // Update if street or house number changed
        if (
          existing.street !== building.street ||
          existing.houseNumber !== building.houseNumber
        ) {
          await prisma.address.update({
            where: { id: existing.id },
            data: {
              street: building.street,
              houseNumber: building.houseNumber,
              lat: building.lat,
              lng: building.lng,
              buildingType: building.buildingType,
            },
          });
          addressesUpdated++;
        }
      } else {
        // Create new address
        await prisma.address.create({
          data: {
            territoryId,
            osmId: building.osmId,
            lat: building.lat,
            lng: building.lng,
            street: building.street,
            houseNumber: building.houseNumber,
            buildingType: building.buildingType,
            source: "osm",
          },
        });
        addressesCreated++;
      }
    }

    // 6. Update queue record with results
    await prisma.osmRefreshQueue.update({
      where: { id: queueRecordId },
      data: {
        status: "completed",
        completedAt: new Date(),
        buildingsFound: buildings.length,
        addressesCreated,
        addressesUpdated,
      },
    });
  } catch (err) {
    // Mark as failed
    await prisma.osmRefreshQueue.update({
      where: { id: queueRecordId },
      data: {
        status: "failed",
        completedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      },
    });
    throw err; // Re-throw so BullMQ can handle retries
  }
}

/**
 * Start the OSM refresh worker.
 * Only starts if REDIS_URL is configured.
 */
export function startOsmRefreshWorker(): Worker<OsmRefreshJobData> | null {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  const worker = new Worker<OsmRefreshJobData>(
    "osm-refresh",
    processOsmRefresh,
    {
      connection,
      concurrency: 1,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(`OSM refresh job ${job?.id} failed:`, err.message);
  });

  worker.on("completed", (job) => {
    console.log(`OSM refresh job ${job.id} completed for territory ${job.data.territoryId}`);
  });

  return worker;
}
