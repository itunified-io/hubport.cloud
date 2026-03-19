import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { apiTokenAuth } from '../middleware/api-token-auth.js';
import { portalAuth } from '../portal/auth.js';
import { generateApiToken, hashToken, TOKEN_EXPIRY_MS } from '../lib/tokens.js';

const rotationRateLimit = new Map<string, number>();
const ROTATION_COOLDOWN_MS = 60 * 1000;

export async function tokenRoutes(app: FastifyInstance): Promise<void> {
  app.get('/info', { preHandler: apiTokenAuth }, async (req, reply) => {
    const tenantId = (req as unknown as Record<string, unknown>).tenantId as string;
    const token = await prisma.tenantApiToken.findFirst({
      where: { tenantId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!token) return reply.status(404).send({ error: 'no_active_token' });
    return reply.send({
      expiresAt: token.expiresAt.toISOString(),
      rotatedAt: token.rotatedAt?.toISOString() ?? null,
      createdAt: token.createdAt.toISOString(),
      daysUntilExpiry: Math.max(0, Math.floor((token.expiresAt.getTime() - Date.now()) / 86400000)),
    });
  });

  app.post('/rotate', { preHandler: apiTokenAuth }, async (req, reply) => {
    const tenantId = (req as unknown as Record<string, unknown>).tenantId as string;
    const lastRotation = rotationRateLimit.get(tenantId) ?? 0;
    if (Date.now() - lastRotation < ROTATION_COOLDOWN_MS) {
      return reply.status(429).send({
        error: 'rate_limited',
        message: 'Token rotation limited to once per minute',
        retryAfter: Math.ceil((ROTATION_COOLDOWN_MS - (Date.now() - lastRotation)) / 1000),
      });
    }
    const currentToken = await prisma.tenantApiToken.findFirst({
      where: { tenantId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!currentToken) return reply.status(404).send({ error: 'no_active_token' });

    const { plaintext, hash } = generateApiToken(tenantId);
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS);
    await prisma.$transaction([
      prisma.tenantApiToken.update({
        where: { id: currentToken.id },
        data: { revokedAt: new Date(), rotatedAt: new Date() },
      }),
      prisma.tenantApiToken.create({
        data: { tenantId, tokenHash: hash, expiresAt },
      }),
    ]);
    rotationRateLimit.set(tenantId, Date.now());
    setTimeout(() => rotationRateLimit.delete(tenantId), ROTATION_COOLDOWN_MS + 1000);
    await prisma.tenantAuditLog.create({
      data: { tenantId, action: 'token_rotated', ip: req.ip, userAgent: req.headers['user-agent'] ?? null },
    }).catch(() => {});
    return reply.send({ token: plaintext, expiresAt: expiresAt.toISOString() });
  });

  app.post('/revoke', { preHandler: portalAuth }, async (req, reply) => {
    const tenantId = (req as unknown as Record<string, unknown>).tenantId as string;
    const result = await prisma.tenantApiToken.updateMany({
      where: { tenantId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await prisma.tenantAuditLog.create({
      data: { tenantId, action: 'token_revoked', ip: req.ip, userAgent: req.headers['user-agent'] ?? null, metadata: { count: result.count } },
    }).catch(() => {});
    return reply.send({ revoked: result.count });
  });
}
