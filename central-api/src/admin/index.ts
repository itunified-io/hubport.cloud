/**
 * Admin portal — server-rendered HTML dashboard for platform administration.
 * Served at admin-uat.hubport.cloud (CF Zero Trust protected).
 *
 * Read-only: provisioning is managed via the hubport-admin MCP skill.
 */

import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { sendEmail } from '../lib/email.js';
import { shell, tenantRow, tenantDetail, statsCard, readOnlyBanner } from './ui.js';

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
    reply.type('text/html').send(shell(`Tenant: ${tenant.subdomain}`, tenantDetail(tenant)));
  });

  // Internal-only endpoint for MCP skill to send emails
  app.post('/internal/send-email', async (req, reply) => {
    const body = req.body as {
      to: string;
      subject: string;
      templateName: string;
      templateData: Record<string, unknown>;
    } | null;

    if (!body?.to || !body?.subject || !body?.templateName) {
      return reply.status(400).send({ error: 'Missing required fields: to, subject, templateName' });
    }

    try {
      // Import email templates dynamically based on templateName
      const { onboardingEmailHtml, rejectionEmailHtml } = await import('../lib/email.js');

      let html: string;
      if (body.templateName === 'onboarding') {
        html = onboardingEmailHtml(body.templateData as {
          name: string;
          subdomain: string;
          id: string;
        });
      } else if (body.templateName === 'rejection') {
        html = rejectionEmailHtml(
          body.templateData as { name: string },
          (body.templateData as { reason?: string }).reason,
        );
      } else {
        return reply.status(400).send({ error: `Unknown template: ${body.templateName}` });
      }

      await sendEmail(body.to, body.subject, html);
      return reply.send({ ok: true });
    } catch (err) {
      app.log.error({ err }, 'Internal send-email failed');
      return reply.status(500).send({ error: (err as Error).message });
    }
  });
}
