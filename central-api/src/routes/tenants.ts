import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { prisma } from '../lib/prisma.js';

const TenantRequestBody = Type.Object({
  name: Type.String({ minLength: 2 }),
  email: Type.String({ format: 'email' }),
  subdomain: Type.String({ minLength: 3, maxLength: 63, pattern: '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' }),
});

const RejectBody = Type.Object({
  reason: Type.Optional(Type.String()),
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

    // TODO: Send Slack notification to admin for review
    // await notifyAdmin(tenant);

    return reply.status(201).send({ id: tenant.id, status: tenant.status });
  });

  // List pending tenant requests (admin-only)
  app.get('/pending', async (_request, reply) => {
    // TODO: Add admin auth middleware
    const pending = await prisma.tenant.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(pending);
  });

  // Approve a tenant — provisions CF resources (admin-only)
  app.post('/:id/approve', async (request, reply) => {
    // TODO: Add admin auth middleware
    const { id } = request.params as { id: string };

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return reply.status(404).send({ error: 'Tenant not found' });
    if (tenant.status !== 'PENDING') return reply.status(400).send({ error: 'Tenant not in PENDING state' });

    // TODO: Implement CF API provisioning
    // 1. Create CF Tunnel via CF API
    // 2. Get tunnel token
    // 3. Create CF ZT app for <tenant>.hubport.cloud (email OTP, no app install)
    // 4. Create CF ZT allow policy
    // 5. Create explicit DNS CNAME (no wildcard)
    // 6. Grant GHCR read access
    // 7. Send email with tenant ID + credentials + Docker instructions
    // 8. Slack notification: "Tenant provisioned"

    const updated = await prisma.tenant.update({
      where: { id },
      data: { status: 'APPROVED' },
    });

    return reply.send({ id: updated.id, status: updated.status, subdomain: updated.subdomain });
  });

  // Reject a tenant (admin-only)
  app.post('/:id/reject', { schema: { body: RejectBody } }, async (request, reply) => {
    // TODO: Add admin auth middleware
    const { id } = request.params as { id: string };
    const { reason } = request.body as { reason?: string };

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return reply.status(404).send({ error: 'Tenant not found' });

    // TODO: Send rejection email with reason

    const updated = await prisma.tenant.update({
      where: { id },
      data: { status: 'REJECTED', rejectReason: reason },
    });

    return reply.send({ id: updated.id, status: updated.status });
  });

  // One-time call-home from setup wizard
  app.post('/:id/activate', async (request, reply) => {
    const { id } = request.params as { id: string };

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return reply.status(404).send({ error: 'Tenant not found' });
    if (tenant.status !== 'APPROVED') return reply.status(400).send({ error: 'Tenant not approved' });

    const updated = await prisma.tenant.update({
      where: { id },
      data: { status: 'ACTIVE', activatedAt: new Date() },
    });

    return reply.send({ id: updated.id, status: updated.status });
  });

  // Get tenant info (tenant-authenticated)
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return reply.status(404).send({ error: 'Tenant not found' });
    return reply.send(tenant);
  });
}
