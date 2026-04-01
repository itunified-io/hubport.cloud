import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { registerAuth } from "./lib/auth.js";
import { registerPolicyContext, requirePrivacyAccepted, requireSecurityComplete } from "./lib/rbac.js";
import { healthRoutes } from "./routes/health.js";
import { publisherRoutes } from "./routes/publishers.js";
import { territoryRoutes } from "./routes/territories.js";
import { meetingRoutes } from "./routes/meetings.js";
import { permissionRoutes } from "./routes/permissions.js";
import { userRoutes } from "./routes/users.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { auditRoutes } from "./routes/audit.js";
import { securityRoutes } from "./routes/security.js";
import { serviceGroupRoutes } from "./routes/service-groups.js";
import { cleaningRoutes } from "./routes/cleaning.js";
import { jitsiRoutes } from "./routes/jitsi.js";
import { sharingRoutes } from "./routes/sharing.js";
import { internalRoutes } from "./routes/internal.js";
import { workbookRoutes } from "./routes/workbooks.js";
import { meetingPeriodRoutes } from "./routes/meeting-periods.js";
import { meetingAssignmentRoutes } from "./routes/meeting-assignments.js";
import { weekendStudyRoutes } from "./routes/weekend-study.js";
import { speakerRoutes } from "./routes/speakers.js";
import { publicTalkRoutes } from "./routes/public-talks.js";
import { congregationSettingsRoutes } from "./routes/congregation-settings.js";
import { awayPeriodRoutes } from "./routes/away-periods.js";
import { chatRoutes } from "./routes/chat.js";
import { campaignRoutes } from "./routes/campaigns.js";
import { meetingPointRoutes } from "./routes/meeting-points.js";
import { assignmentRoutes } from "./routes/assignments.js";
import { fieldGroupRoutes } from "./routes/field-groups.js";
import { territoryShareRoutes } from "./routes/territory-shares.js";
import { addressRoutes } from "./routes/addresses.js";
import { osmRefreshRoutes } from "./routes/osm-refresh.js";
import { gapDetectionRoutes } from "./routes/gap-detection.js";
import { localOsmRoutes } from "./routes/local-osm.js";
import { heatmapRoutes } from "./routes/heatmap.js";
import { importRoutes } from "./routes/import.js";
import { fieldServiceMeetingPointRoutes } from "./routes/field-service-meeting-points.js";
import { serviceGroupMeetingRoutes } from "./routes/service-group-meetings.js";
import prisma from "./lib/prisma.js";
import { startTokenRotationJob } from './jobs/token-rotation.js';
import { startWorkbookAutoFetch } from './jobs/workbook-auto-fetch.js';
import { startAssignmentOverdueCheck } from './jobs/assignment-overdue-check.js';
import { startCampaignAutoClose } from './jobs/campaign-auto-close.js';
import { seedSystemRoles, bootstrapBoundaryVersions } from "./lib/seed-roles.js";
import { seedSlotTemplates } from "./lib/seed-slot-templates.js";


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

  // Rate limiting (CodeQL js/missing-rate-limiting)
  // 300/min global — SPA makes many parallel calls on page load;
  // sensitive endpoints (password, TOTP, redeem) have tighter per-route limits.
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
  });

  // Multipart (file uploads, max 10MB — JWPUB files can be 5-10MB)
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } }); // 100 MB

  // Auth (JWT via Keycloak JWKS)
  await registerAuth(app);

  // Policy context (builds permission context per request)
  registerPolicyContext(app);

  // Security setup enforcement (ADR-0081: server-side credential gate)
  app.addHook("preHandler", requireSecurityComplete());

  // Privacy acceptance gate (blocks API if privacy not accepted)
  app.addHook("preHandler", requirePrivacyAccepted());

  // Routes
  await app.register(healthRoutes);
  await app.register(publisherRoutes);
  await app.register(territoryRoutes);
  await app.register(meetingRoutes);
  await app.register(permissionRoutes);
  await app.register(userRoutes);
  await app.register(onboardingRoutes);
  await app.register(auditRoutes);
  await app.register(securityRoutes);
  await app.register(serviceGroupRoutes);
  await app.register(cleaningRoutes);
  await app.register(jitsiRoutes);
  await app.register(sharingRoutes);
  await app.register(internalRoutes);
  await app.register(workbookRoutes);
  await app.register(meetingPeriodRoutes);
  await app.register(meetingAssignmentRoutes);
  await app.register(weekendStudyRoutes);
  await app.register(speakerRoutes);
  await app.register(publicTalkRoutes);
  await app.register(congregationSettingsRoutes);
  await app.register(awayPeriodRoutes);
  await app.register(chatRoutes);
  await app.register(campaignRoutes);
  await app.register(meetingPointRoutes);
  await app.register(assignmentRoutes);
  await app.register(fieldGroupRoutes);
  await app.register(territoryShareRoutes);
  await app.register(addressRoutes);
  await app.register(osmRefreshRoutes);
  await app.register(gapDetectionRoutes);
  await app.register(localOsmRoutes);
  await app.register(heatmapRoutes);
  await app.register(importRoutes);
  await app.register(fieldServiceMeetingPointRoutes);
  await app.register(serviceGroupMeetingRoutes);

  // Auto-sync schema on startup (applies new columns/tables)
  if (process.env.AUTO_MIGRATE !== "false") {
    const { execFileSync } = await import("node:child_process");
    try {
      app.log.info("Syncing database schema...");
      execFileSync("npx", ["prisma", "db", "push", "--accept-data-loss"], {
        stdio: "inherit",
        cwd: new URL("..", import.meta.url).pathname,
      });
      app.log.info("Schema sync complete");
    } catch {
      app.log.error("Schema sync failed — starting anyway");
    }
  }

  // Verify DB connection + upsert system roles
  try {
    await prisma.$connect();
    app.log.info("Database connected");

    // Upsert system roles on every startup (idempotent — adds new roles, updates existing)
    app.log.info("Upserting system roles...");
    await seedSystemRoles();
    app.log.info("System roles up to date");

    app.log.info("Bootstrapping boundary version snapshots...");
    await bootstrapBoundaryVersions();
    app.log.info("Boundary versions up to date");

    app.log.info("Upserting meeting slot templates...");
    await seedSlotTemplates();
    app.log.info("Slot templates up to date");


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
  // Start workbook auto-fetch (checks for new editions every 12h)
  startWorkbookAutoFetch(app.log);
  // Start assignment overdue check (daily)
  startAssignmentOverdueCheck(app.log);
  // Start campaign auto-close (daily)
  startCampaignAutoClose(app.log);
  app.log.info(`hub-api listening on ${host}:${port}`);
}

start().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
