/**
 * Chat routes — Matrix DM creation, member listing, admin provisioning.
 * Hub-api manages Matrix rooms via the Synapse Admin API.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import prisma from "../lib/prisma.js";
import { createRoom, setDirectRoom, ensureMatrixUser } from "../lib/matrix-admin.js";
import {
  ensureSpacesProvisioned,
  provisionAllActivePublishers,
  provisionMatrixUserForPublisher,
} from "../lib/matrix-provisioning.js";

const SERVER_NAME = process.env.SYNAPSE_SERVER_NAME || "localhost";

/** Resolve JWT sub → Publisher */
async function getPublisherFromRequest(request: FastifyRequest) {
  const sub = (request.user as unknown as Record<string, unknown>)?.sub as string | undefined;
  if (!sub) return null;
  return prisma.publisher.findFirst({
    where: { keycloakSub: sub, status: "active" },
    select: { id: true, firstName: true, lastName: true, displayName: true, congregationRole: true },
  });
}

export async function chatRoutes(app: FastifyInstance) {
  // ─── DM Creation ────────────────────────────────────────────────────

  /**
   * POST /chat/dm — Create a direct message room between current user and target.
   * Deduplicates: returns existing DM room if one already exists.
   */
  app.post(
    "/chat/dm",
    { preHandler: [requirePermission(PERMISSIONS.CHAT_SEND)] },
    async (request, reply) => {
      const body = request.body as { targetPublisherId?: string };
      if (!body.targetPublisherId) {
        return reply.code(400).send({ error: "targetPublisherId is required" });
      }

      const me = await getPublisherFromRequest(request);
      if (!me) return reply.code(404).send({ error: "Publisher not found" });

      const target = await prisma.publisher.findUnique({
        where: { id: body.targetPublisherId },
        select: { id: true, firstName: true, lastName: true, displayName: true, status: true },
      });
      if (!target || target.status !== "active") {
        return reply.code(404).send({ error: "Target publisher not found or inactive" });
      }

      if (me.id === target.id) {
        return reply.code(400).send({ error: "Cannot create DM with yourself" });
      }

      const myMatrixId = `@${me.id}:${SERVER_NAME}`;
      const targetMatrixId = `@${target.id}:${SERVER_NAME}`;

      // Ensure both Matrix users exist (idempotent)
      const myName = me.displayName ?? `${me.firstName} ${me.lastName}`;
      const targetName = target.displayName ?? `${target.firstName} ${target.lastName}`;
      await ensureMatrixUser(me.id, myName);
      await ensureMatrixUser(target.id, targetName);

      // Create DM room
      const roomName = `${myName} & ${targetName}`;
      const roomId = await createRoom({
        name: roomName,
        isDirect: true,
        invite: [targetMatrixId],
      });

      // Set m.direct account data for both users so clients show it as DM
      await setDirectRoom(myMatrixId, targetMatrixId, roomId);
      await setDirectRoom(targetMatrixId, myMatrixId, roomId);

      return reply.code(201).send({ roomId, targetPublisherId: target.id, targetName });
    },
  );

  // ─── Members List ───────────────────────────────────────────────────

  /**
   * GET /chat/members — List active publishers for the DM picker.
   * Returns id + display name only (no PII).
   */
  app.get(
    "/chat/members",
    { preHandler: [requirePermission(PERMISSIONS.CHAT_VIEW)] },
    async (request, reply) => {
      const me = await getPublisherFromRequest(request);
      if (!me) return reply.code(404).send({ error: "Publisher not found" });

      const publishers = await prisma.publisher.findMany({
        where: { status: "active", id: { not: me.id } },
        select: { id: true, firstName: true, lastName: true, displayName: true, avatarUrl: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      });

      const members = publishers.map((p) => ({
        id: p.id,
        name: p.displayName ?? `${p.firstName} ${p.lastName}`,
        avatarUrl: p.avatarUrl,
      }));

      return reply.send(members);
    },
  );

  // ─── Admin: Space Provisioning ─────────────────────────────────────

  /**
   * POST /chat/spaces/provision — Trigger space provisioning + backfill all active users.
   * Admin-only. Used for initial setup and existing tenant migration.
   */
  app.post(
    "/chat/spaces/provision",
    { preHandler: [requirePermission(PERMISSIONS.SHARING_CONFIGURE)] },
    async (_request, reply) => {
      // 1. Ensure spaces exist
      const spaces = await ensureSpacesProvisioned();

      // 2. Provision all active publishers (idempotent)
      const result = await provisionAllActivePublishers();

      return reply.send({
        spaces: spaces.map((s) => ({ name: s.name, roomCount: s.rooms.length })),
        users: result,
      });
    },
  );

  // ─── Ensure own Matrix user (lazy provisioning) ────────────────────

  /**
   * POST /chat/ensure — Ensure the current user has a Matrix account.
   * Called lazily by the frontend when opening chat for the first time.
   */
  app.post(
    "/chat/ensure",
    { preHandler: [requirePermission(PERMISSIONS.CHAT_VIEW)] },
    async (request, reply) => {
      const me = await getPublisherFromRequest(request);
      if (!me) return reply.code(404).send({ error: "Publisher not found" });

      try {
        await provisionMatrixUserForPublisher(me);
        return reply.send({ ok: true, matrixUserId: `@${me.id}:${SERVER_NAME}` });
      } catch (err) {
        app.log.error({ err }, "Failed to provision Matrix user");
        return reply.code(500).send({ error: "Matrix provisioning failed" });
      }
    },
  );
}
