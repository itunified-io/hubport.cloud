import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { prisma } from '../lib/prisma.js';
import { apiTokenAuth } from '../middleware/api-token-auth.js';

const ApproveBody = Type.Object({
  requesterId: Type.String({ format: 'uuid' }),
  approverId: Type.String({ format: 'uuid' }),
});

const RequestBody = Type.Object({
  partnerSubdomain: Type.String({ minLength: 3, maxLength: 63 }),
});

export async function sharingRoutes(app: FastifyInstance) {
  // Resolve a subdomain to tenantId (for partner lookup)
  app.get('/resolve/:subdomain', { preHandler: apiTokenAuth }, async (request, reply) => {
    const { subdomain } = request.params as { subdomain: string };

    const tenant = await prisma.tenant.findUnique({
      where: { subdomain },
      select: { id: true, name: true, subdomain: true, status: true },
    });

    if (!tenant || tenant.status !== 'ACTIVE') {
      return reply.status(404).send({ error: 'Tenant not found or not active' });
    }

    return reply.send(tenant);
  });

  // Request a sharing partnership (called by hub-api on behalf of tenant)
  app.post('/request', { preHandler: apiTokenAuth, schema: { body: RequestBody } }, async (request, reply) => {
    const tenantId = (request as unknown as Record<string, unknown>).tenantId as string;
    const { partnerSubdomain } = request.body as { partnerSubdomain: string };

    // Look up the partner tenant
    const partner = await prisma.tenant.findUnique({
      where: { subdomain: partnerSubdomain },
      select: { id: true, name: true, subdomain: true, status: true },
    });

    if (!partner || partner.status !== 'ACTIVE') {
      return reply.status(404).send({ error: 'Partner tenant not found or not active' });
    }

    if (partner.id === tenantId) {
      return reply.status(400).send({ error: 'Cannot partner with self' });
    }

    // Check if already approved (in either direction)
    const existing = await prisma.sharingApproval.findFirst({
      where: {
        OR: [
          { requesterId: tenantId, approverId: partner.id },
          { requesterId: partner.id, approverId: tenantId },
        ],
      },
    });

    if (existing) {
      return reply.status(409).send({ error: 'Partnership already exists', approval: existing });
    }

    // Create the sharing request (auto-approve for now — bidirectional consent can be added later)
    const approval = await prisma.sharingApproval.create({
      data: { requesterId: tenantId, approverId: partner.id, approved: true },
    });

    return reply.status(201).send({ approval, partner: { id: partner.id, name: partner.name, subdomain: partner.subdomain } });
  });

  // Approve a sharing partner (bidirectional consent)
  app.post('/approve', { preHandler: apiTokenAuth, schema: { body: ApproveBody } }, async (request, reply) => {
    const { requesterId, approverId } = request.body as { requesterId: string; approverId: string };

    if (requesterId === approverId) {
      return reply.status(400).send({ error: 'Cannot approve self' });
    }

    const approval = await prisma.sharingApproval.upsert({
      where: { requesterId_approverId: { requesterId, approverId } },
      update: { approved: true },
      create: { requesterId, approverId, approved: true },
    });

    return reply.status(201).send(approval);
  });

  // Revoke sharing approval
  app.delete('/approve/:requesterId/:approverId', { preHandler: apiTokenAuth }, async (request, reply) => {
    const { requesterId, approverId } = request.params as { requesterId: string; approverId: string };

    await prisma.sharingApproval.deleteMany({
      where: { requesterId, approverId },
    });

    return reply.status(204).send();
  });

  // Get approved sharing partners for a tenant
  app.get('/approved/:tenantId', { preHandler: apiTokenAuth }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };

    const approvals = await prisma.sharingApproval.findMany({
      where: {
        OR: [{ requesterId: tenantId }, { approverId: tenantId }],
        approved: true,
      },
      include: { requester: true, approver: true },
    });

    return reply.send(approvals);
  });

  // Push territory data
  app.put('/territories/:tenantId', { preHandler: apiTokenAuth }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const data = request.body;

    const territory = await prisma.sharedTerritory.upsert({
      where: { tenantId },
      update: { data: data as object },
      create: { tenantId, data: data as object },
    });

    return reply.send(territory);
  });

  // Query shared territories (only approved partners)
  app.get('/territories', { preHandler: apiTokenAuth }, async (request, reply) => {
    const { tenantIds } = request.query as { tenantIds?: string };
    if (!tenantIds) return reply.status(400).send({ error: 'tenantIds query param required' });

    const ids = tenantIds.split(',');
    const territories = await prisma.sharedTerritory.findMany({
      where: { tenantId: { in: ids } },
    });

    return reply.send(territories);
  });

  // Push talk data
  app.put('/talks/:tenantId', { preHandler: apiTokenAuth }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const data = request.body;

    const talk = await prisma.sharedTalk.upsert({
      where: { tenantId },
      update: { data: data as object },
      create: { tenantId, data: data as object },
    });

    return reply.send(talk);
  });

  // Query shared talks (only approved partners)
  app.get('/talks', { preHandler: apiTokenAuth }, async (request, reply) => {
    const { tenantIds } = request.query as { tenantIds?: string };
    if (!tenantIds) return reply.status(400).send({ error: 'tenantIds query param required' });

    const ids = tenantIds.split(',');
    const talks = await prisma.sharedTalk.findMany({
      where: { tenantId: { in: ids } },
    });

    return reply.send(talks);
  });
}
