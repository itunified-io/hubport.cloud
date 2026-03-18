import type { FastifyInstance } from "fastify";
import prisma from "../lib/prisma.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    return {
      status: "ok",
      version: process.env.APP_VERSION ?? "unknown",
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/health/db", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ok", database: "connected" };
    } catch (err) {
      reply.code(503).send({
        status: "error",
        database: "disconnected",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  });
}
