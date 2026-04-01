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
import { bboxFromGeoJSON } from "../lib/geo.js";

export interface OsmRefreshJobData {
  territoryId: string;
  queueRecordId: string;
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
