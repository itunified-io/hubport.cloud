/**
 * Admin portal — server-rendered HTML dashboard for platform administration.
 * Served at admin-uat.hubport.cloud (CF Zero Trust protected).
 */

import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { provisionTenant } from '../lib/provision.js';
import { sendEmail, onboardingEmailHtml, rejectionEmailHtml } from '../lib/email.js';
import { shell, tenantRow, tenantDetail, statsCard } from './ui.js';

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
         <div class="space-y-3 mb-8">${pendingTenants.map(t => tenantRow(t, true)).join('')}</div>`
      : '<p class="text-zinc-400 mb-8">No pending requests.</p>';

    const allHtml = `
      <h2 class="text-xl font-bold mb-4">All Tenants</h2>
      <div class="space-y-3">${recentTenants.map(t => tenantRow(t, false)).join('')}</div>
    `;

    reply.type('text/html').send(shell('Dashboard', stats + pendingHtml + allHtml));
  });

  // Tenant detail page
  app.get('/tenant/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return reply.status(404).type('text/html').send(shell('Not Found', '<p>Tenant not found.</p>'));
    reply.type('text/html').send(shell(`Tenant: ${tenant.subdomain}`, tenantDetail(tenant)));
  });

  // Approve tenant — provisions CF resources + sends onboarding email
  app.post('/tenant/:id/approve', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return reply.redirect('/admin');
    if (tenant.status !== 'PENDING') return reply.redirect(`/admin/tenant/${id}`);

    let tunnelId = '';
    let tunnelToken = '';
    let provisionError = '';

    try {
      const result = await provisionTenant(tenant.subdomain, tenant.email);
      tunnelId = result.tunnelId;
      tunnelToken = result.tunnelToken;
    } catch (err) {
      provisionError = (err as Error).message;
      app.log.error({ err, tenantId: id }, 'CF provisioning failed');
    }

    const updated = await prisma.tenant.update({
      where: { id },
      data: {
        status: 'APPROVED',
        tunnelId: tunnelId || null,
        tunnelToken: tunnelToken || null,
      },
    });

    // Send onboarding email via Gmail API
    try {
      await sendEmail(
        tenant.email,
        `Welcome to hubport.cloud — ${tenant.name}`,
        onboardingEmailHtml({
          name: tenant.name,
          subdomain: tenant.subdomain,
          id: tenant.id,
          tunnelToken: tunnelToken || undefined,
        }),
      );
      app.log.info({ tenantId: id, email: tenant.email }, 'Onboarding email sent');
    } catch (err) {
      app.log.error({ err, tenantId: id }, 'Onboarding email failed');
    }

    // Slack notification
    const slackWh = process.env.SLACK_WEBHOOK_URL;
    if (slackWh) {
      fetch(slackWh, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `✅ Tenant approved: *${tenant.name}* (${tenant.subdomain}.hubport.cloud)${provisionError ? `\n⚠️ Provisioning error: ${provisionError}` : ''}`,
        }),
      }).catch(() => {});
    }

    reply.redirect(`/admin/tenant/${id}`);
  });

  // Reject tenant — sends rejection email
  app.post('/tenant/:id/reject', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { reason?: string } | null;
    const reason = body?.reason || '';

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return reply.redirect('/admin');

    await prisma.tenant.update({
      where: { id },
      data: { status: 'REJECTED', rejectReason: reason || null },
    });

    // Send rejection email
    try {
      await sendEmail(
        tenant.email,
        `hubport.cloud — Registration Update`,
        rejectionEmailHtml({ name: tenant.name }, reason || undefined),
      );
    } catch (err) {
      app.log.error({ err, tenantId: id }, 'Rejection email failed');
    }

    reply.redirect('/admin');
  });
}
