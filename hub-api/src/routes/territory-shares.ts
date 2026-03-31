/**
 * Territory share link routes — create, revoke, list, and redeem share links.
 *
 * Authenticated routes require TERRITORIES_SHARE permission.
 * Public redeem route has no auth but is rate-limited.
 */
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import {
  generateCode,
  hashCode,
  hashPin,
  verifyCode,
  verifyPin,
  checkExpiration,
  hashIp,
  incrementPinAttempts,
} from "../lib/share-service.js";

// ─── Schemas ───────────────────────────────────────────────────────────

const IdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});

const ShareIdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
  shareId: Type.String({ format: "uuid" }),
});

const CreateShareBody = Type.Object({
  scope: Type.Union([
    Type.Literal("boundary"),
    Type.Literal("addresses"),
    Type.Literal("full"),
  ]),
  pin: Type.Optional(Type.String({ minLength: 4, maxLength: 8 })),
  expiresInDays: Type.Optional(Type.Number({ minimum: 1, maximum: 365 })),
});

const RedeemParams = Type.Object({
  code: Type.String({ minLength: 20, maxLength: 30 }),
});

const RedeemQuery = Type.Object({
  pin: Type.Optional(Type.String()),
});

type IdParamsType = Static<typeof IdParams>;
type ShareIdParamsType = Static<typeof ShareIdParams>;
type CreateShareBodyType = Static<typeof CreateShareBody>;
type RedeemParamsType = Static<typeof RedeemParams>;
type RedeemQueryType = Static<typeof RedeemQuery>;

// ─── Route Registration ────────────────────────────────────────────────

export async function territoryShareRoutes(app: FastifyInstance): Promise<void> {
  // ── Authenticated Routes ─────────────────────────────────────────────

  // POST /territories/:id/share — create a share link
  app.post<{ Params: IdParamsType; Body: CreateShareBodyType }>(
    "/territories/:id/share",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_SHARE),
      schema: { params: IdParams, body: CreateShareBody },
    },
    async (request, reply) => {
      const { id: territoryId } = request.params;
      const { scope, pin, expiresInDays } = request.body;

      // Look up territory
      const territory = await prisma.territory.findUnique({
        where: { id: territoryId },
      });
      if (!territory) {
        return reply.code(404).send({ error: "Territory not found" });
      }

      // Reject if share-excluded
      if (territory.shareExcluded) {
        return reply.code(409).send({
          error: "Conflict",
          message: "This territory is excluded from sharing",
        });
      }

      // Load congregation settings for validation
      const settings = await prisma.congregationSettings.findFirst();
      const maxDays = settings?.shareMaxDays ?? 90;
      const defaultDays = settings?.defaultShareDays ?? 30;
      const requirePinForFull = settings?.requirePINForFullShare ?? false;

      // Validate expiry
      const days = expiresInDays ?? defaultDays;
      if (days > maxDays) {
        return reply.code(400).send({
          error: "Bad Request",
          message: `Expiry cannot exceed ${maxDays} days`,
        });
      }

      // Require PIN for full scope if configured
      if (scope === "full" && requirePinForFull && !pin) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "PIN is required for full-scope shares",
        });
      }

      // Generate share link
      const code = generateCode();
      const codeH = hashCode(code);
      const pinH = pin ? hashPin(pin) : null;

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + days);

      const createdBy = (request.user as unknown as Record<string, unknown>)?.sub as string || "unknown";

      const share = await prisma.territoryShare.create({
        data: {
          territoryId,
          codeHash: codeH,
          scope,
          pinHash: pinH,
          expiresAt,
          createdBy,
        },
      });

      return reply.code(201).send({
        id: share.id,
        code, // Only returned once at creation time
        scope: share.scope,
        hasPIN: !!pinH,
        expiresAt: share.expiresAt,
        createdAt: share.createdAt,
      });
    },
  );

  // DELETE /territories/:id/share/:shareId — revoke a share link
  app.delete<{ Params: ShareIdParamsType }>(
    "/territories/:id/share/:shareId",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_SHARE),
      schema: { params: ShareIdParams },
    },
    async (request, reply) => {
      const { id: territoryId, shareId } = request.params;

      const share = await prisma.territoryShare.findFirst({
        where: { id: shareId, territoryId },
      });
      if (!share) {
        return reply.code(404).send({ error: "Share not found" });
      }

      const revokedBy = (request.user as unknown as Record<string, unknown>)?.sub as string || "unknown";

      await prisma.territoryShare.update({
        where: { id: shareId },
        data: { isActive: false, revokedAt: new Date(), revokedBy },
      });

      return reply.code(204).send();
    },
  );

  // GET /territories/:id/shares — list shares with access count
  app.get<{ Params: IdParamsType }>(
    "/territories/:id/shares",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_SHARE),
      schema: { params: IdParams },
    },
    async (request) => {
      const { id: territoryId } = request.params;

      const shares = await prisma.territoryShare.findMany({
        where: { territoryId },
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { accessLogs: true } },
        },
      });

      return shares.map((s) => ({
        id: s.id,
        scope: s.scope,
        hasPIN: !!s.pinHash,
        expiresAt: s.expiresAt,
        isActive: s.isActive,
        revokedAt: s.revokedAt,
        createdAt: s.createdAt,
        accessCount: s._count.accessLogs,
      }));
    },
  );

  // ── Public Route (no auth) ───────────────────────────────────────────

  // GET /territories/shared/:code — redeem a share link
  app.get<{ Params: RedeemParamsType; Querystring: RedeemQueryType }>(
    "/territories/shared/:code",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: { params: RedeemParams, querystring: RedeemQuery },
    },
    async (request, reply) => {
      const { code } = request.params;
      const { pin } = request.query;
      const codeH = hashCode(code);

      // Look up share by hash
      const share = await prisma.territoryShare.findUnique({
        where: { codeHash: codeH },
        include: {
          territory: {
            include: {
              addresses: true,
            },
          },
        },
      });

      // All invalid states return the same 404
      if (!share || !share.isActive || share.revokedAt) {
        return reply.code(404).send({ error: "Link not found or expired" });
      }

      if (checkExpiration(share)) {
        return reply.code(404).send({ error: "Link not found or expired" });
      }

      // Verify code with constant-time comparison
      if (!verifyCode(code, share.codeHash)) {
        return reply.code(404).send({ error: "Link not found or expired" });
      }

      // PIN check
      if (share.pinHash) {
        if (!pin) {
          // Tell client that a PIN is needed (without revealing share details)
          return reply.code(403).send({
            error: "PIN required",
            requiresPin: true,
          });
        }

        if (!verifyPin(pin, share.pinHash)) {
          await incrementPinAttempts(share.id);
          return reply.code(403).send({ error: "Invalid PIN" });
        }
      }

      // Log access
      const clientIp = request.ip || "unknown";
      await prisma.shareAccessLog.create({
        data: {
          shareId: share.id,
          ipHash: hashIp(clientIp),
          userAgent: request.headers["user-agent"]?.substring(0, 256) || null,
          scope: share.scope,
        },
      });

      // Build response based on scope
      const territory = share.territory;
      const response: Record<string, unknown> = {
        scope: share.scope,
        territory: {
          number: territory.number,
          name: territory.name,
          boundaries: territory.boundaries,
        },
      };

      if (share.scope === "addresses" || share.scope === "full") {
        response.territory = {
          ...response.territory as object,
          addresses: territory.addresses.map((a) => ({
            id: a.id,
            lat: a.lat,
            lng: a.lng,
            street: a.street,
            houseNumber: a.houseNumber,
            city: a.city,
            postcode: a.postcode,
          })),
        };
      }

      if (share.scope === "full") {
        response.territory = {
          ...response.territory as object,
          addresses: territory.addresses.map((a) => ({
            id: a.id,
            lat: a.lat,
            lng: a.lng,
            street: a.street,
            houseNumber: a.houseNumber,
            city: a.city,
            postcode: a.postcode,
            status: a.status,
            lastVisitAt: a.lastVisitAt,
            notes: a.notes,
          })),
        };
      }

      return reply.send(response);
    },
  );
}
