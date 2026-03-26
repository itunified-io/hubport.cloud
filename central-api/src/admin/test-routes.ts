/**
 * Test API endpoints — UAT only.
 * Auto-rotating key (30 min TTL, 5 min overlap), logged to stdout.
 * Guarded by NODE_ENV !== 'production'.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { getLastSentEmail } from './index.js';

const KEY_TTL_MS = 30 * 60 * 1000; // 30 minutes
const KEY_OVERLAP_MS = 5 * 60 * 1000; // 5 minutes

let currentKey = randomBytes(32).toString('hex');
let previousKey: string | null = null;
let currentKeyCreatedAt = Date.now();

function rotateKeyIfNeeded(): void {
  const age = Date.now() - currentKeyCreatedAt;
  if (age >= KEY_TTL_MS) {
    previousKey = currentKey;
    currentKey = randomBytes(32).toString('hex');
    currentKeyCreatedAt = Date.now();
    console.log(`[TEST] Current test key: ${currentKey}`);
    // Clear previous key after overlap window
    setTimeout(() => { previousKey = null; }, KEY_OVERLAP_MS);
  }
}

function validateTestKey(key: string): boolean {
  rotateKeyIfNeeded();
  if (key === currentKey) return true;
  if (previousKey && key === previousKey) return true;
  return false;
}

// Log initial key on startup
console.log(`[TEST] Current test key: ${currentKey}`);

async function testAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    reply.status(404).send({ error: 'Not found' });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Missing test API key' });
    return;
  }

  const key = authHeader.slice(7);
  if (!validateTestKey(key)) {
    reply.status(401).send({ error: 'Invalid or expired test key' });
    return;
  }
}

export async function testRoutes(app: FastifyInstance): Promise<void> {
  if (process.env.NODE_ENV === 'production') return;

  app.addHook('preHandler', testAuth);

  // POST /test/reset-tenant — reset auth state for a tenant
  app.post('/test/reset-tenant', async (req, reply) => {
    const body = req.body as { tenantId?: string } | null;
    if (!body?.tenantId) {
      return reply.status(400).send({ error: 'tenantId required' });
    }

    // Delete tokens, setup codes
    await prisma.tenantApiToken.deleteMany({ where: { tenantId: body.tenantId } });
    await prisma.setupCode.deleteMany({ where: { tenantId: body.tenantId } });
    await prisma.tenantAuditLog.deleteMany({ where: { tenantId: body.tenantId } });

    // Reset auth
    await prisma.tenantAuth.updateMany({
      where: { tenantId: body.tenantId },
      data: {
        keycloakUserId: null,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });

    return reply.send({ ok: true });
  });

  // GET /test/last-email — return last sent email
  app.get('/test/last-email', async (_req, reply) => {
    const email = getLastSentEmail();
    if (!email) {
      return reply.status(404).send({ error: 'No emails sent yet' });
    }
    return reply.send(email);
  });
}
