import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { generateApiToken, hashToken } from '../lib/tokens.js';

const TOKEN_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export async function tokenExchangeRoutes(app: FastifyInstance): Promise<void> {
  // Bootstrap -> runtime token exchange (ADR-0072)
  app.post('/tenants/:id/token-exchange', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { bootstrapToken?: string } | null;

    if (!body?.bootstrapToken) {
      return reply.status(400).send({ error: 'bootstrapToken required' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Authorization header required' });
    }

    const bearerToken = authHeader.slice(7);
    if (bearerToken !== body.bootstrapToken) {
      return reply.status(401).send({ error: 'Token mismatch' });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) {
      return reply.status(404).send({ error: 'Tenant not found' });
    }
    if (tenant.status !== 'APPROVED' && tenant.status !== 'ACTIVE') {
      return reply.status(400).send({ error: 'Tenant not in valid state' });
    }

    // Validate bootstrap token against DB
    const tokenHash = hashToken(bearerToken);
    const existingToken = await prisma.tenantApiToken.findFirst({
      where: { tenantId: id, tokenHash, revokedAt: null },
    });

    if (!existingToken) {
      return reply.status(401).send({ error: 'Invalid or revoked bootstrap token' });
    }

    // Revoke bootstrap token
    await prisma.tenantApiToken.update({
      where: { id: existingToken.id },
      data: { revokedAt: new Date() },
    });

    // Generate runtime token
    const { plaintext, hash } = generateApiToken(id);
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS);

    await prisma.tenantApiToken.create({
      data: { tenantId: id, tokenHash: hash, expiresAt },
    });

    return reply.send({
      runtimeToken: plaintext,
      expiresAt: expiresAt.toISOString(),
      message: 'Bootstrap token consumed. Store runtime token in Vault.',
    });
  });
}
