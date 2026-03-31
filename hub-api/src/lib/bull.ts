/**
 * BullMQ queue setup for background job processing.
 * Uses Redis connection from REDIS_URL env var.
 */

import { Queue } from "bullmq";
import { Redis } from "ioredis";

let redisConnection: Redis | null = null;
let redisAvailable = false;

function getRedisConnection(): Redis | null {
  if (redisConnection) return redisConnection;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  try {
    redisConnection = new Redis(redisUrl, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
      lazyConnect: true,
    });

    redisConnection.on("connect", () => {
      redisAvailable = true;
    });

    redisConnection.on("error", () => {
      redisAvailable = false;
    });

    redisConnection.on("close", () => {
      redisAvailable = false;
    });

    // Attempt lazy connect
    redisConnection.connect().catch(() => {
      redisAvailable = false;
    });

    return redisConnection;
  } catch {
    return null;
  }
}

/** Check if Redis is available for queue operations. */
export function isRedisAvailable(): boolean {
  const conn = getRedisConnection();
  return conn !== null && redisAvailable;
}

/** OSM refresh background job queue. */
export const osmRefreshQueue: Queue | null = (() => {
  const conn = getRedisConnection();
  if (!conn) return null;

  return new Queue("osm-refresh", {
    connection: conn,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  });
})();
