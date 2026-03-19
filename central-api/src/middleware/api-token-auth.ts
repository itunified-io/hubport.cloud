import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { hashToken, validateTokenFormat, ROTATION_GRACE_MS } from '../lib/tokens.js';

/** Extract Bearer token from Authorization header. */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Fastify preHandler — validates M2M API token from Authorization header.
 * On success, attaches tenantId to request.
 */
export async function apiTokenAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const plaintext = extractBearerToken(request.headers.authorization);

  if (!plaintext || !validateTokenFormat(plaintext)) {
    reply.status(401).send({ error: 'invalid_token', message: 'Missing or malformed API token' });
    return;
  }

  const tokenHash = hashToken(plaintext);
  const now = new Date();

  // Look up active, non-expired token
  let tokenRecord = await prisma.tenantApiToken.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
      expiresAt: { gt: now },
    },
  });

  // Concurrent rotation grace: if token was revoked within last 60s, find replacement
  if (!tokenRecord) {
    const graceWindow = new Date(now.getTime() - ROTATION_GRACE_MS);
    const recentlyRevoked = await prisma.tenantApiToken.findFirst({
      where: {
        tokenHash,
        revokedAt: { gt: graceWindow },
      },
    });

    if (recentlyRevoked) {
      // Return the newest active token for this tenant
      tokenRecord = await prisma.tenantApiToken.findFirst({
        where: {
          tenantId: recentlyRevoked.tenantId,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
      });
    }
  }

  if (!tokenRecord) {
    // Deliberate UX trade-off: distinguish expired from invalid tokens.
    // An attacker would need the plaintext token to compute the hash,
    // so the information leak is low-severity. The portal_url helps
    // legitimate M2M clients discover where to get a new token.
    // Check if it was an expired token
    const expired = await prisma.tenantApiToken.findFirst({
      where: { tokenHash },
    });

    if (expired) {
      reply.status(401).send({
        error: 'token_expired',
        message: 'API token has expired',
        portal_url: process.env.PORTAL_URL || 'https://portal.hubport.cloud',
      });
      return;
    }

    reply.status(401).send({ error: 'invalid_token', message: 'Invalid API token' });
    return;
  }

  (request as unknown as Record<string, unknown>).tenantId = tokenRecord.tenantId;
}
