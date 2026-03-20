import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { registerAuth } from "./lib/auth.js";
import { registerPolicyContext } from "./lib/rbac.js";
import { seedSystemRoles } from "./lib/seed-roles.js";
import { healthRoutes } from "./routes/health.js";
import { publisherRoutes } from "./routes/publishers.js";
import { territoryRoutes } from "./routes/territories.js";
import { meetingRoutes } from "./routes/meetings.js";
import { permissionRoutes } from "./routes/permissions.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import prisma from "./lib/prisma.js";

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

  // Policy context (builds permission context per request)
  await registerPolicyContext(app);

  // Routes
  await app.register(healthRoutes);
  await app.register(publisherRoutes);
  await app.register(territoryRoutes);
  await app.register(meetingRoutes);
  await app.register(permissionRoutes);
  await app.register(onboardingRoutes);

  // Serve SPA static files (hub-app/dist) if present (Docker container)
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const spaRoot = resolve(__dirname, "../../hub-app/dist");
  if (existsSync(spaRoot)) {
    await app.register(fastifyStatic, {
      root: spaRoot,
      prefix: "/",
      wildcard: false,
    });

    // SPA fallback — serve index.html for unmatched routes (client-side routing)
    app.setNotFoundHandler((_req, reply) => {
      return reply.sendFile("index.html");
    });

    app.log.info(`Serving SPA from ${spaRoot}`);
  }

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

    // Seed system roles on first boot
    const roleCount = await prisma.appRole.count();
    if (roleCount === 0) {
      app.log.info("No AppRoles found — seeding system roles...");
      const seeded = await seedSystemRoles(prisma);
      app.log.info(`Seeded ${seeded} system roles`);
    }
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
  const port = Number(process.env.API_PORT ?? 3000);
  const host = process.env.API_HOST ?? "0.0.0.0";

  await app.listen({ port, host });
  app.log.info(`hub-api listening on ${host}:${port}`);
}

start().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
