/**
 * Admin portal — server-rendered HTML dashboard for platform administration.
 * Served at admin-uat.hubport.cloud (CF Zero Trust protected).
 *
 * Read-only: provisioning is managed via the hubport-admin MCP skill.
 */

import { timingSafeEqual } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { sendEmail } from '../lib/email.js';
import { shell, tenantRow, tenantDetail, statsCard, readOnlyBanner } from './ui.js';
import { generateApiToken, TOKEN_EXPIRY_MS } from '../lib/tokens.js';

interface SentEmail {
  to: string;
  subject: string;
  html: string;
  sentAt: string;
}

const sentEmails: SentEmail[] = [];
const MAX_SENT_EMAILS = 10;

export function recordSentEmail(email: SentEmail): void {
  sentEmails.push(email);
  if (sentEmails.length > MAX_SENT_EMAILS) sentEmails.shift();
}

export function getLastSentEmail(): SentEmail | null {
  return sentEmails.length > 0 ? sentEmails[sentEmails.length - 1]! : null;
}

// ── Auth Secrets (ADR-0079) ─────────────────────────────────────────
// Two separate secrets with distinct privilege boundaries:
//   MAIL_RELAY_SECRET — shared with tenants for email relay only
//   ADMIN_SECRET      — operator-only, NOT distributed to tenants
const MAIL_RELAY_SECRET = process.env.MAIL_RELAY_SECRET || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

function validateSecret(authHeader: string | undefined, secret: string): boolean {
  if (!secret) return false; // unconfigured = closed
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7).trim();
  if (token.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
}

/** Validate MAIL_RELAY_SECRET — for /internal/send-email (tenant-accessible) */
function validateMailRelayAuth(authHeader: string | undefined): boolean {
  return validateSecret(authHeader, MAIL_RELAY_SECRET);
}

/** Validate ADMIN_SECRET — for /internal/provision-auth (operator-only, NOT tenant-accessible) */
function validateAdminAuth(authHeader: string | undefined): boolean {
  return validateSecret(authHeader, ADMIN_SECRET);
}

// ── Rate Limiter (defense-in-depth per ADR-0079) ──────────────────
const EMAIL_RATE_LIMIT = 20; // max sends per source per hour
const EMAIL_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const emailSendTimestamps = new Map<string, number[]>();

function checkRateLimit(source: string): boolean {
  const now = Date.now();
  const timestamps = emailSendTimestamps.get(source) || [];
  const recent = timestamps.filter(t => now - t < EMAIL_RATE_WINDOW_MS);
  emailSendTimestamps.set(source, recent);
  if (recent.length >= EMAIL_RATE_LIMIT) return false;
  recent.push(now);
  return true;
}

export async function adminRoutes(app: FastifyInstance) {
  // Dashboard — overview with stats + pending requests
  app.get('/', async (_req, reply) => {
    const [pending, approved, active, rejected, total] = await Promise.all([
      prisma.tenant.count({ where: { status: 'PENDING' } }),
      prisma.tenant.count({ where: { status: 'APPROVED' } }),
      prisma.tenant.count({ where: { status: 'ACTIVE' } }),
      prisma.tenant.count({ where: { status: 'REJECTED' } }),
      prisma.tenant.count(),
    ]);

    const pendingTenants = await prisma.tenant.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });

    const recentTenants = await prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const stats = `
      <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        ${statsCard('Pending', pending, '#d97706')}
        ${statsCard('Approved', approved, '#3b82f6')}
        ${statsCard('Active', active, '#22c55e')}
        ${statsCard('Rejected', rejected, '#ef4444')}
        ${statsCard('Total', total, '#a1a1aa')}
      </div>
    `;

    const pendingHtml = pendingTenants.length > 0
      ? `<h2 class="text-xl font-bold mb-4 text-[#d97706]">Pending Approval (${pendingTenants.length})</h2>
         <div class="space-y-3 mb-8">${pendingTenants.map(t => tenantRow(t)).join('')}</div>`
      : '<p class="text-zinc-400 mb-8">No pending requests.</p>';

    const allHtml = `
      <h2 class="text-xl font-bold mb-4">All Tenants</h2>
      <div class="space-y-3">${recentTenants.map(t => tenantRow(t)).join('')}</div>
    `;

    reply.type('text/html').send(shell('Dashboard', readOnlyBanner() + stats + pendingHtml + allHtml));
  });

  // Tenant detail page
  app.get('/tenant/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return reply.status(404).type('text/html').send(shell('Not Found', '<p>Tenant not found.</p>'));
    const devices = await prisma.tenantDevice.findMany({
      where: { tenantId: id, status: 'approved' },
      orderBy: { approvedAt: 'desc' },
      select: { id: true, hostname: true, os: true, arch: true, ip: true, approvedAt: true },
    });
    reply.type('text/html').send(shell(`Tenant: ${tenant.subdomain}`, tenantDetail(tenant, devices)));
  });

  // Internal-only endpoint for MCP skill to provision auth (Keycloak user creation + DB link)
  // Called during tenant approval — creates Keycloak user, stores link in TenantAuth.
  // Auth: ADMIN_SECRET — operator-only, NOT shared with tenants (SEC-003 privilege boundary fix)
  app.post('/internal/provision-auth', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!validateAdminAuth(req.headers.authorization)) {
      return reply.status(401).send({ error: 'unauthorized', message: 'Invalid or missing admin secret' });
    }

    const body = req.body as { tenantId: string; keycloakUserId?: string } | null;
    if (!body?.tenantId) {
      return reply.status(400).send({ error: 'Missing tenantId' });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: body.tenantId } });
    if (!tenant) return reply.status(404).send({ error: 'Tenant not found' });

    // Check for existing TenantAuth with keycloakUserId (idempotent)
    const existingAuth = await prisma.tenantAuth.findUnique({ where: { tenantId: body.tenantId } });
    let keycloakUserId = existingAuth?.keycloakUserId ?? body.keycloakUserId ?? null;
    let tempPassword: string | null = null;

    // Create Keycloak user if not already linked
    if (!keycloakUserId && tenant.email) {
      try {
        const { createPortalUser } = await import('../lib/keycloak-admin.js');
        const { setTemporaryPassword } = await import('../lib/keycloak-admin.js');
        keycloakUserId = await createPortalUser(
          tenant.email,
          tenant.ownerFirstName || tenant.name || tenant.subdomain,
          tenant.ownerLastName || '',
        );
        app.log.info({ tenantId: body.tenantId, keycloakUserId }, 'Portal Keycloak user created');

        // Set a temporary password — user must change it on first login (UPDATE_PASSWORD required action)
        const { randomBytes } = await import('node:crypto');
        const tempPw = randomBytes(12).toString('base64url');
        try {
          await setTemporaryPassword(keycloakUserId, tempPw);
          tempPassword = tempPw;
          app.log.info({ tenantId: body.tenantId }, 'Temporary password set for portal user');
        } catch (pwErr) {
          app.log.error({ err: pwErr, tenantId: body.tenantId }, 'Failed to set temporary password');
        }
      } catch (err) {
        app.log.error({ err, tenantId: body.tenantId }, 'Failed to create Keycloak user — continuing without');
      }
    }

    // Upsert: create if missing, reset if exists (for re-approve cycles)
    await prisma.tenantAuth.upsert({
      where: { tenantId: body.tenantId },
      create: {
        tenantId: body.tenantId,
        keycloakUserId,
      },
      update: {
        keycloakUserId: keycloakUserId ?? undefined,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });

    const portalUrl = process.env.PORTAL_BASE_URL || 'https://portal.hubport.cloud';
    const setupUrl = `${portalUrl}/portal/login`;

    return reply.send({ ok: true, setupUrl, ...(tempPassword ? { tempPassword } : {}) });
  });

  // Internal-only endpoint for MCP skill to provision an M2M API token.
  // Called during tenant approval so sharing and token-rotation work immediately.
  // Auth: ADMIN_SECRET — operator-only (same as provision-auth)
  app.post('/internal/provision-api-token', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!validateAdminAuth(req.headers.authorization)) {
      return reply.status(401).send({ error: 'unauthorized', message: 'Invalid or missing admin secret' });
    }

    const body = req.body as { tenantId: string } | null;
    if (!body?.tenantId) {
      return reply.status(400).send({ error: 'Missing tenantId' });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: body.tenantId } });
    if (!tenant) return reply.status(404).send({ error: 'Tenant not found' });

    // Check for existing active token
    const activeToken = await prisma.tenantApiToken.findFirst({
      where: { tenantId: body.tenantId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (activeToken) {
      return reply.send({ ok: true, exists: true, message: 'Active token already exists', expiresAt: activeToken.expiresAt.toISOString() });
    }

    const { plaintext, hash } = generateApiToken(body.tenantId);
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS);
    await prisma.tenantApiToken.create({
      data: { tenantId: body.tenantId, tokenHash: hash, expiresAt },
    });

    app.log.info({ tenantId: body.tenantId }, 'API token provisioned via admin endpoint');
    return reply.send({ ok: true, token: plaintext, expiresAt: expiresAt.toISOString() });
  });

  // Internal-only endpoint for MCP skill to delete a portal Keycloak user during decommission.
  // Auth: ADMIN_SECRET — operator-only
  app.delete('/internal/portal-user/:tenantId', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!validateAdminAuth(req.headers.authorization)) {
      return reply.status(401).send({ error: 'unauthorized', message: 'Invalid or missing admin secret' });
    }

    const { tenantId } = req.params as { tenantId: string };
    const auth = await prisma.tenantAuth.findUnique({ where: { tenantId } });

    if (!auth?.keycloakUserId) {
      return reply.send({ ok: true, message: 'No Keycloak user linked' });
    }

    try {
      const { deletePortalUser } = await import('../lib/keycloak-admin.js');
      await deletePortalUser(auth.keycloakUserId);
      app.log.info({ tenantId, keycloakUserId: auth.keycloakUserId }, 'Portal Keycloak user deleted');
    } catch (err) {
      app.log.error({ err, tenantId }, 'Failed to delete Keycloak user');
      return reply.status(500).send({ error: 'Failed to delete Keycloak user' });
    }

    return reply.send({ ok: true });
  });

  // Internal-only endpoint for sending emails via pre-defined templates.
  // Auth: dedicated MAIL_RELAY_SECRET (not tenant API tokens) — ADR-0079.
  // Callers: hub-api (invite emails), hubport-admin skill (onboarding/rejection).
  app.post('/internal/send-email', async (req, reply) => {
    // Dedicated relay secret auth — NOT tenant tokens
    if (!validateMailRelayAuth(req.headers.authorization)) {
      return reply.status(401).send({ error: 'unauthorized', message: 'Invalid or missing mail relay secret' });
    }

    const body = req.body as {
      to: string;
      subject: string;
      templateName: string;
      templateData: Record<string, unknown>;
    } | null;

    if (!body?.to || !body?.subject || !body?.templateName) {
      return reply.status(400).send({ error: 'Missing required fields: to, subject, templateName' });
    }

    // Rate limiting keyed by caller IP (defense-in-depth — ADR-0079)
    const source = req.ip || 'unknown';
    if (!checkRateLimit(source)) {
      return reply.status(429).send({ error: 'Rate limit exceeded', message: `Maximum ${EMAIL_RATE_LIMIT} emails per hour` });
    }

    try {
      // Import email templates dynamically based on templateName
      const { onboardingEmailHtml, rejectionEmailHtml, inviteEmailHtml } = await import('../lib/email.js');

      let html: string;
      if (body.templateName === 'onboarding') {
        html = onboardingEmailHtml(body.templateData as {
          name: string;
          subdomain: string;
          id: string;
          setupUrl?: string;
          tempPassword?: string;
        });
      } else if (body.templateName === 'rejection') {
        html = rejectionEmailHtml(
          body.templateData as { name: string },
          (body.templateData as { reason?: string }).reason,
        );
      } else if (body.templateName === 'invite') {
        html = inviteEmailHtml(body.templateData as {
          firstName: string;
          inviteCode: string;
          tenantSlug: string;
        });
      } else {
        return reply.status(400).send({ error: `Unknown template: ${body.templateName}` });
      }

      await sendEmail(body.to, body.subject, html);
      recordSentEmail({ to: body.to, subject: body.subject, html, sentAt: new Date().toISOString() });
      return reply.send({ ok: true });
    } catch (err) {
      app.log.error({ err }, 'Internal send-email failed');
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // Register test routes conditionally (UAT only)
  if (process.env.NODE_ENV !== 'production') {
    const { testRoutes } = await import('./test-routes.js');
    await app.register(testRoutes, { prefix: '/internal' });
  }
}
