/**
 * Jitsi JWT token endpoint — issues short-lived JWTs for authenticated meeting access.
 * SEC-004 F-18: Replace guest access + predictable room names with JWT auth + HMAC rooms.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHmac, randomBytes } from "node:crypto";
import { SignJWT } from "jose";

const JITSI_JWT_SECRET = () => {
  const secret = process.env.JITSI_JWT_SECRET;
  if (!secret) throw new Error("JITSI_JWT_SECRET is required");
  return new TextEncoder().encode(secret);
};

const JITSI_APP_ID = process.env.JITSI_APP_ID || "hubport";

/** HMAC-SHA256 room name from Matrix room ID — not guessable without the secret. */
function hmacRoomName(roomId: string): string {
  const secret = process.env.JITSI_JWT_SECRET;
  if (!secret) return roomId; // fallback if no secret (dev)
  const hmac = createHmac("sha256", secret).update(roomId).digest("hex");
  return `hp-${hmac.slice(0, 16)}`;
}

export async function jitsiRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /meetings/jitsi-token
   * Returns a signed JWT + HMAC room name for Jitsi Meet access.
   */
  app.post("/meetings/jitsi-token", async (request: FastifyRequest, reply) => {
    const user = request.user as { sub: string; preferred_username?: string; name?: string } | undefined;
    if (!user?.sub) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const body = request.body as { roomId?: string } | null;
    if (!body?.roomId) {
      return reply.status(400).send({ error: "roomId is required" });
    }

    const room = hmacRoomName(body.roomId);
    const displayName = user.name || user.preferred_username || "Participant";

    const token = await new SignJWT({
      room,
      context: {
        user: {
          id: user.sub,
          name: displayName,
        },
      },
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .setIssuer(JITSI_APP_ID)
      .setSubject("*")
      .setAudience(JITSI_APP_ID)
      .sign(JITSI_JWT_SECRET());

    return reply.send({ token, room });
  });
}
