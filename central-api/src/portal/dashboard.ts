import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { verifyPassword } from '../lib/crypto.js';
import { portalAuth } from './auth.js';
import { portalShell, dashboardPage } from './ui.js';
import { readApiTokenCookie } from '../lib/encrypted-cookie.js';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  // All dashboard routes require auth
  app.addHook('preHandler', portalAuth);

  // GET /portal/dashboard
  app.get('/dashboard', async (req, reply) => {
    const tenantId = (req as unknown as Record<string, unknown>).tenantId as string;
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, include: { auth: true } });

    if (!tenant) {
      return reply.status(404).type('text/html').send(portalShell('Not Found', '<p>Tenant not found.</p>'));
    }

    const apiToken = readApiTokenCookie(req.headers.cookie);
    reply.type('text/html').send(portalShell(`Dashboard - ${tenant.name}`, dashboardPage(tenant, apiToken)));
  });

  // POST /portal/reveal-token — requires password re-entry
  app.post('/reveal-token', async (req, reply) => {
    const tenantId = (req as unknown as Record<string, unknown>).tenantId as string;
    const body = req.body as { password?: string } | null;

    if (!body?.password) {
      return reply.status(400).send({ error: 'Password required to reveal token' });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { auth: true },
    });

    if (!tenant?.auth) {
      return reply.status(404).send({ error: 'Account not found' });
    }

    const valid = await verifyPassword(tenant.auth.passwordHash, body.password);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid password' });
    }

    return reply.send({
      tunnelToken: tenant.tunnelToken,
      tenantId: tenant.id,
    });
  });
}
