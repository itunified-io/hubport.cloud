import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { portalAuth } from './auth.js';
import { portalShell, dashboardPage } from './ui.js';
import { readApiTokenCookie, setApiTokenCookie } from '../lib/encrypted-cookie.js';
import { generateApiToken, TOKEN_EXPIRY_MS } from '../lib/tokens.js';

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

    // Check for existing API token in cookie first
    let apiToken = readApiTokenCookie(req.headers.cookie);

    // If no cookie, check if tenant has an active token at all.
    // If not, auto-generate one (handles pre-existing tenants approved before token system).
    if (!apiToken) {
      const activeToken = await prisma.tenantApiToken.findFirst({
        where: { tenantId, revokedAt: null },
        orderBy: { createdAt: 'desc' },
      });

      if (!activeToken) {
        const { plaintext, hash } = generateApiToken(tenantId);
        const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS);
        await prisma.tenantApiToken.create({
          data: { tenantId, tokenHash: hash, expiresAt },
        });
        apiToken = plaintext;
        setApiTokenCookie(reply, plaintext);
        await prisma.tenantAuditLog.create({
          data: { tenantId, action: 'token_generated', ip: req.ip, userAgent: req.headers['user-agent'] ?? null },
        }).catch(() => {});
      }
    }

    reply.type('text/html').send(portalShell(`Dashboard - ${tenant.name}`, dashboardPage(tenant, apiToken)));
  });

  // POST /portal/reveal-token — requires valid OIDC session (user is already authenticated)
  app.post('/reveal-token', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const tenantId = (req as unknown as Record<string, unknown>).tenantId as string;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { auth: true },
    });

    if (!tenant?.auth) {
      return reply.status(404).send({ error: 'Account not found' });
    }

    // User is authenticated via Keycloak OIDC session (portalAuth middleware).
    // No additional password verification needed.
    return reply.send({
      tunnelToken: tenant.tunnelToken,
      tenantId: tenant.id,
    });
  });
}
