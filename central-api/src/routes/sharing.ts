import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { prisma } from '../lib/prisma.js';

const ApproveBody = Type.Object({
  requesterId: Type.String({ format: 'uuid' }),
  approverId: Type.String({ format: 'uuid' }),
});

export async function sharingRoutes(app: FastifyInstance) {
  // Approve a sharing partner (bidirectional consent)
  app.post('/approve', { schema: { body: ApproveBody } }, async (request, reply) => {
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
  app.delete('/approve/:requesterId/:approverId', async (request, reply) => {
    const { requesterId, approverId } = request.params as { requesterId: string; approverId: string };

    await prisma.sharingApproval.deleteMany({
      where: { requesterId, approverId },
    });

    return reply.status(204).send();
  });

  // Get approved sharing partners for a tenant
  app.get('/approved/:tenantId', async (request, reply) => {
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
  app.put('/territories/:tenantId', async (request, reply) => {
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
  app.get('/territories', async (request, reply) => {
    const { tenantIds } = request.query as { tenantIds?: string };
    if (!tenantIds) return reply.status(400).send({ error: 'tenantIds query param required' });

    const ids = tenantIds.split(',');
    const territories = await prisma.sharedTerritory.findMany({
      where: { tenantId: { in: ids } },
    });

    return reply.send(territories);
  });

  // Push talk data
  app.put('/talks/:tenantId', async (request, reply) => {
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
  app.get('/talks', async (request, reply) => {
    const { tenantIds } = request.query as { tenantIds?: string };
    if (!tenantIds) return reply.status(400).send({ error: 'tenantIds query param required' });

    const ids = tenantIds.split(',');
    const talks = await prisma.sharedTalk.findMany({
      where: { tenantId: { in: ids } },
    });

    return reply.send(talks);
  });
}
