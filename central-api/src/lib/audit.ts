import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

export async function auditLog(params: {
  tenantId: string;
  action: string;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.tenantAuditLog.create({
      data: {
        tenantId: params.tenantId,
        action: params.action,
        ip: params.ip,
        userAgent: params.userAgent,
        metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (err) {
    // Audit logging should never break the main flow
    console.error('[audit] Failed to log:', err);
  }
}
