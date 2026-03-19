import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerAuth } from "./lib/auth.js";
import { healthRoutes } from "./routes/health.js";
import { publisherRoutes } from "./routes/publishers.js";
import { territoryRoutes } from "./routes/territories.js";
import { meetingRoutes } from "./routes/meetings.js";
import prisma from "./lib/prisma.js";
import { startTokenRotationJob } from './jobs/token-rotation.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
  },
});

async function start(): Promise<void> {
  // CORS
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? true,
    credentials: true,
  });

  // Auth (JWT via Keycloak JWKS)
  await registerAuth(app);

  // Routes
  await app.register(healthRoutes);
  await app.register(publisherRoutes);
  await app.register(territoryRoutes);
  await app.register(meetingRoutes);

  // Auto-migrate on startup (deploy pending migrations)
  if (process.env.AUTO_MIGRATE !== "false") {
    const { execFileSync } = await import("node:child_process");
    try {
      app.log.info("Running Prisma migrations...");
      execFileSync("npx", ["prisma", "migrate", "deploy"], {
        stdio: "inherit",
        cwd: new URL("..", import.meta.url).pathname,
      });
      app.log.info("Migrations complete");
    } catch {
      app.log.error("Migration failed — starting anyway");
    }
  }

  // Verify DB connection
  try {
    await prisma.$connect();
    app.log.info("Database connected");
  } catch {
    app.log.error("Database connection failed — endpoints may fail");
  }

  // Graceful shutdown
  const shutdown = async () => {
    app.log.info("Shutting down...");
    await prisma.$disconnect();
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start
  const port = Number(process.env.API_PORT ?? 3001);
  const host = process.env.API_HOST ?? "0.0.0.0";

  await app.listen({ port, host });
  // Start API token auto-rotation
  startTokenRotationJob(app.log);
  app.log.info(`hub-api listening on ${host}:${port}`);
}

start().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
