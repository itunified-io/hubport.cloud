import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { prisma } from '../lib/prisma.js';
import { apiTokenAuth } from '../middleware/api-token-auth.js';

const VALID_CATEGORIES = ['speakers', 'territories'] as const;

const RequestBody = Type.Object({
  partnerSubdomain: Type.String({ minLength: 3, maxLength: 63 }),
  offeredCategories: Type.Array(Type.String(), { minItems: 1 }),
  contactName: Type.Optional(Type.String()),
  contactEmail: Type.Optional(Type.String()),
  message: Type.Optional(Type.String({ maxLength: 500 })),
});

const ApproveBody = Type.Object({
  approvalId: Type.String({ format: 'uuid' }),
  acceptedCategories: Type.Array(Type.String(), { minItems: 1 }),
  termsVersion: Type.String({ minLength: 1 }),
});

const RejectBody = Type.Object({
  approvalId: Type.String({ format: 'uuid' }),
  reason: Type.Optional(Type.String({ maxLength: 500 })),
});

// Legacy approve body (backward compat for existing hub-api versions)
const LegacyApproveBody = Type.Object({
  requesterId: Type.String({ format: 'uuid' }),
  approverId: Type.String({ format: 'uuid' }),
});

function validateCategories(categories: string[]): string[] {
  return categories.filter((c) => (VALID_CATEGORIES as readonly string[]).includes(c));
}

export async function sharingRoutes(app: FastifyInstance) {
  // Resolve a subdomain to tenantId (for partner lookup)
  app.get('/resolve/:subdomain', { preHandler: apiTokenAuth }, async (request, reply) => {
    const { subdomain } = request.params as { subdomain: string };

    const tenant = await prisma.tenant.findUnique({
      where: { subdomain },
      select: { id: true, name: true, subdomain: true, status: true },
    });

    if (!tenant || !['APPROVED', 'ACTIVE'].includes(tenant.status)) {
      return reply.status(404).send({ error: 'Tenant not found or not active' });
    }

    return reply.send(tenant);
  });

  // Request a sharing partnership (creates PENDING — needs receiver approval)
  app.post('/request', { preHandler: apiTokenAuth, schema: { body: RequestBody } }, async (request, reply) => {
    const tenantId = (request as unknown as Record<string, unknown>).tenantId as string;
    const body = request.body as {
      partnerSubdomain: string;
      offeredCategories: string[];
      contactName?: string;
      contactEmail?: string;
      message?: string;
    };

    const offered = validateCategories(body.offeredCategories);
    if (offered.length === 0) {
      return reply.status(400).send({ error: 'At least one valid category required (speakers, territories)' });
    }

    // Look up the partner tenant
    const partner = await prisma.tenant.findUnique({
      where: { subdomain: body.partnerSubdomain },
      select: { id: true, name: true, subdomain: true, status: true },
    });

    if (!partner || !['APPROVED', 'ACTIVE'].includes(partner.status)) {
      return reply.status(404).send({ error: 'Partner tenant not found or not active' });
    }

    if (partner.id === tenantId) {
      return reply.status(400).send({ error: 'Cannot partner with self' });
    }

    // Check if already exists (in either direction)
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

    const approval = await prisma.sharingApproval.create({
      data: {
        requesterId: tenantId,
        approverId: partner.id,
        status: 'PENDING',
        offeredCategories: offered,
        requesterContactName: body.contactName || null,
        requesterContactEmail: body.contactEmail || null,
        message: body.message || null,
      },
    });

    return reply.status(201).send({
      approval,
      partner: { id: partner.id, name: partner.name, subdomain: partner.subdomain },
    });
  });

  // Approve a sharing request (receiver accepts with selected categories + terms)
  app.post('/approve', { preHandler: apiTokenAuth, schema: { body: ApproveBody } }, async (request, reply) => {
    const body = request.body as { approvalId: string; acceptedCategories: string[]; termsVersion: string };
    const tenantId = (request as unknown as Record<string, unknown>).tenantId as string;

    const approval = await prisma.sharingApproval.findUnique({ where: { id: body.approvalId } });
    if (!approval) {
      return reply.status(404).send({ error: 'Sharing request not found' });
    }

    // Only the receiver (approver) can approve
    if (approval.approverId !== tenantId) {
      return reply.status(403).send({ error: 'Only the receiving congregation can approve' });
    }

    if (approval.status !== 'PENDING') {
      return reply.status(400).send({ error: `Cannot approve a request with status ${approval.status}` });
    }

    // Accepted categories must be a subset of offered
    const offered = approval.offeredCategories as string[];
    const accepted = validateCategories(body.acceptedCategories).filter((c) => offered.includes(c));
    if (accepted.length === 0) {
      return reply.status(400).send({ error: 'At least one offered category must be accepted' });
    }

    const updated = await prisma.sharingApproval.update({
      where: { id: body.approvalId },
      data: {
        status: 'APPROVED',
        acceptedCategories: accepted,
        termsAcceptedAt: new Date(),
        termsVersion: body.termsVersion,
        respondedAt: new Date(),
      },
      include: { requester: true, approver: true },
    });

    return reply.send(updated);
  });

  // Legacy approve endpoint (backward compat — auto-approves with all categories)
  app.post('/approve-legacy', { preHandler: apiTokenAuth, schema: { body: LegacyApproveBody } }, async (request, reply) => {
    const { requesterId, approverId } = request.body as { requesterId: string; approverId: string };

    if (requesterId === approverId) {
      return reply.status(400).send({ error: 'Cannot approve self' });
    }

    const approval = await prisma.sharingApproval.upsert({
      where: { requesterId_approverId: { requesterId, approverId } },
      update: {
        status: 'APPROVED',
        acceptedCategories: ['speakers', 'territories'],
        respondedAt: new Date(),
      },
      create: {
        requesterId,
        approverId,
        status: 'APPROVED',
        offeredCategories: ['speakers', 'territories'],
        acceptedCategories: ['speakers', 'territories'],
        respondedAt: new Date(),
      },
    });

    return reply.status(201).send(approval);
  });

  // Reject a sharing request
  app.post('/reject', { preHandler: apiTokenAuth, schema: { body: RejectBody } }, async (request, reply) => {
    const body = request.body as { approvalId: string; reason?: string };
    const tenantId = (request as unknown as Record<string, unknown>).tenantId as string;

    const approval = await prisma.sharingApproval.findUnique({ where: { id: body.approvalId } });
    if (!approval) {
      return reply.status(404).send({ error: 'Sharing request not found' });
    }

    if (approval.approverId !== tenantId) {
      return reply.status(403).send({ error: 'Only the receiving congregation can reject' });
    }

    if (approval.status !== 'PENDING') {
      return reply.status(400).send({ error: `Cannot reject a request with status ${approval.status}` });
    }

    const updated = await prisma.sharingApproval.update({
      where: { id: body.approvalId },
      data: {
        status: 'REJECTED',
        rejectedReason: body.reason || null,
        respondedAt: new Date(),
      },
    });

    return reply.send(updated);
  });

  // Revoke sharing approval (sets status to REVOKED)
  app.delete('/approve/:requesterId/:approverId', { preHandler: apiTokenAuth }, async (request, reply) => {
    const { requesterId, approverId } = request.params as { requesterId: string; approverId: string };

    await prisma.sharingApproval.updateMany({
      where: {
        OR: [
          { requesterId, approverId },
          { requesterId: approverId, approverId: requesterId },
        ],
      },
      data: { status: 'REVOKED', respondedAt: new Date() },
    });

    return reply.status(204).send();
  });

  // Get all sharing partnerships for a tenant (supports ?status= filter)
  app.get('/partners/:tenantId', { preHandler: apiTokenAuth }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const { status } = request.query as { status?: string };

    const where: Record<string, unknown> = {
      OR: [{ requesterId: tenantId }, { approverId: tenantId }],
    };

    if (status) {
      where.status = status;
    }

    const approvals = await prisma.sharingApproval.findMany({
      where,
      include: {
        requester: { select: { id: true, name: true, subdomain: true, status: true } },
        approver: { select: { id: true, name: true, subdomain: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send(approvals);
  });

  // Keep legacy endpoint for backward compat
  app.get('/approved/:tenantId', { preHandler: apiTokenAuth }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };

    const approvals = await prisma.sharingApproval.findMany({
      where: {
        OR: [{ requesterId: tenantId }, { approverId: tenantId }],
        status: 'APPROVED',
      },
      include: { requester: true, approver: true },
    });

    return reply.send(approvals);
  });

  // Get pending incoming requests for a tenant
  app.get('/pending/:tenantId', { preHandler: apiTokenAuth }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };

    const pending = await prisma.sharingApproval.findMany({
      where: {
        approverId: tenantId,
        status: 'PENDING',
      },
      include: {
        requester: { select: { id: true, name: true, subdomain: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send(pending);
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

  // Query shared territories (only approved partners with 'territories' category)
  app.get('/territories', { preHandler: apiTokenAuth }, async (request, reply) => {
    const tenantId = (request as unknown as Record<string, unknown>).tenantId as string;
    const { tenantIds } = request.query as { tenantIds?: string };
    if (!tenantIds) return reply.status(400).send({ error: 'tenantIds query param required' });

    const ids = tenantIds.split(',');

    // Filter to only partners with 'territories' in acceptedCategories
    const approvedPartners = await prisma.sharingApproval.findMany({
      where: {
        status: 'APPROVED',
        OR: [
          { requesterId: tenantId, approverId: { in: ids } },
          { approverId: tenantId, requesterId: { in: ids } },
        ],
      },
      select: { requesterId: true, approverId: true, acceptedCategories: true },
    });

    const allowedIds = approvedPartners
      .filter((a) => {
        const cats = (a.acceptedCategories as string[]) || [];
        return cats.includes('territories');
      })
      .map((a) => (a.requesterId === tenantId ? a.approverId : a.requesterId));

    const filteredIds = ids.filter((id) => allowedIds.includes(id));
    if (filteredIds.length === 0) return reply.send([]);

    const territories = await prisma.sharedTerritory.findMany({
      where: { tenantId: { in: filteredIds } },
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

  // Query shared talks (only approved partners with 'talks' category)
  app.get('/talks', { preHandler: apiTokenAuth }, async (request, reply) => {
    const tenantId = (request as unknown as Record<string, unknown>).tenantId as string;
    const { tenantIds } = request.query as { tenantIds?: string };
    if (!tenantIds) return reply.status(400).send({ error: 'tenantIds query param required' });

    const ids = tenantIds.split(',');

    const approvedPartners = await prisma.sharingApproval.findMany({
      where: {
        status: 'APPROVED',
        OR: [
          { requesterId: tenantId, approverId: { in: ids } },
          { approverId: tenantId, requesterId: { in: ids } },
        ],
      },
      select: { requesterId: true, approverId: true, acceptedCategories: true },
    });

    const allowedIds = approvedPartners
      .filter((a) => {
        const cats = (a.acceptedCategories as string[]) || [];
        return cats.includes('talks');
      })
      .map((a) => (a.requesterId === tenantId ? a.approverId : a.requesterId));

    const filteredIds = ids.filter((id) => allowedIds.includes(id));
    if (filteredIds.length === 0) return reply.send([]);

    const talks = await prisma.sharedTalk.findMany({
      where: { tenantId: { in: filteredIds } },
    });

    return reply.send(talks);
  });
}
