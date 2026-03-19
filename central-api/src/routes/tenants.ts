/**
 * Tenant API routes — used by the CF Worker landing page signup flow.
 * Admin actions (approve/reject/decommission) are handled by admin/index.ts.
 */

import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { prisma } from '../lib/prisma.js';
import { apiTokenAuth } from '../middleware/api-token-auth.js';

const TenantRequestBody = Type.Object({
  name: Type.String({ minLength: 2 }),
  email: Type.String({ format: 'email' }),
  subdomain: Type.String({ minLength: 3, maxLength: 63, pattern: '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' }),
});

export async function tenantRoutes(app: FastifyInstance) {
  // Create a pending tenant request (from CF Worker signup)
  app.post('/request', { schema: { body: TenantRequestBody } }, async (request, reply) => {
    const { name, email, subdomain } = request.body as { name: string; email: string; subdomain: string };

    const existing = await prisma.tenant.findUnique({ where: { subdomain } });
    if (existing) {
      return reply.status(409).send({ error: 'Subdomain already taken' });
    }

    const tenant = await prisma.tenant.create({
      data: { name, email, subdomain, status: 'PENDING' },
    });

    // Slack notification for new request
    const slackWh = process.env.SLACK_WEBHOOK_URL;
    if (slackWh) {
      fetch(slackWh, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `📋 New tenant request: *${name}* (${subdomain}.hubport.cloud)\nContact: ${email}\nReview at: https://admin-uat.hubport.cloud/admin`,
        }),
      }).catch(() => {});
    }

    return reply.status(201).send({ id: tenant.id, status: tenant.status });
  });

  // List pending tenant requests
  app.get('/pending', async (_request, reply) => {
    const pending = await prisma.tenant.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(pending);
  });

  // One-time call-home from setup wizard
  app.post('/:id/activate', { preHandler: apiTokenAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return reply.status(404).send({ error: 'Tenant not found' });
    if (tenant.status !== 'APPROVED') return reply.status(400).send({ error: 'Tenant not approved' });

    const updated = await prisma.tenant.update({
      where: { id },
      data: { status: 'ACTIVE', activatedAt: new Date() },
    });

    // Slack notification
    const slackWh = process.env.SLACK_WEBHOOK_URL;
    if (slackWh) {
      fetch(slackWh, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🚀 Tenant activated: *${tenant.name}* (${tenant.subdomain}.hubport.cloud) — setup wizard completed!`,
        }),
      }).catch(() => {});
    }

    return reply.send({ id: updated.id, status: updated.status });
  });

  // Get tenant info (tenant-authenticated)
  app.get('/:id', { preHandler: apiTokenAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return reply.status(404).send({ error: 'Tenant not found' });
    return reply.send(tenant);
  });
}
