import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { portalAuth } from '../portal/auth.js';
import {
  generateSetupCode,
  generateDeviceCode,
  validateCodeFormat,
  getCodeExpiresAt,
  getDeviceCodeExpiresAt,
} from '../lib/setup-code.js';

// Rate limit: IP -> { count, resetAt }
const rateLimits = new Map<string, { count: number; resetAt: number }>();
// Poll rate limit (higher threshold for installer polling)
const pollRateLimits = new Map<string, { count: number; resetAt: number }>();
// Code attempt counter: code -> total attempts
const codeAttempts = new Map<string, number>();
// Replay cache: code -> { response, ip, expiresAt }
const replayCache = new Map<
  string,
  { response: unknown; ip: string; expiresAt: number }
>();

const RATE_LIMIT_PER_IP = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const POLL_RATE_LIMIT_PER_IP = 20; // ~5s interval for 15 min
const POLL_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const CODE_MAX_ATTEMPTS = 20;
const REPLAY_WINDOW_MS = 10 * 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_PER_IP) return false;
  entry.count++;
  return true;
}

function checkPollRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = pollRateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    pollRateLimits.set(ip, { count: 1, resetAt: now + POLL_RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= POLL_RATE_LIMIT_PER_IP) return false;
  entry.count++;
  return true;
}

export async function setupCodeRoutes(app: FastifyInstance): Promise<void> {
  // Generate setup code (portal-authenticated)
  app.post(
    '/portal/setup-code/generate',
    { preHandler: portalAuth },
    async (req, reply) => {
      const tenantId = (req as unknown as Record<string, unknown>)
        .tenantId as string;
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
      });
      if (!tenant) {
        return reply.status(404).send({ error: 'Tenant not found' });
      }
      if (tenant.status !== 'APPROVED' && tenant.status !== 'ACTIVE') {
        return reply
          .status(400)
          .send({ error: 'Tenant not in valid state for setup' });
      }

      // Invalidate existing active codes
      await prisma.setupCode.updateMany({
        where: {
          tenantId,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { expiresAt: new Date() },
      });

      const code = generateSetupCode();
      const expiresAt = getCodeExpiresAt();

      await prisma.setupCode.create({
        data: { code, tenantId, expiresAt },
      });

      return reply.send({ code, expiresAt: expiresAt.toISOString() });
    }
  );

  // Exchange setup code for credentials (public, rate-limited)
  app.post('/setup/exchange', async (req, reply) => {
    const ip = req.ip;
    if (!checkRateLimit(ip)) {
      return reply
        .status(429)
        .send({ error: 'Too many attempts. Try again in 1 minute.' });
    }

    const body = req.body as { code?: string; hostname?: string; os?: string; arch?: string } | null;
    if (!body?.code || !validateCodeFormat(body.code.toUpperCase())) {
      return reply
        .status(400)
        .send({ error: 'Invalid code format. Expected XXXX-XXXX.' });
    }

    const code = body.code.toUpperCase();
    const deviceHostname = body.hostname || 'unknown';
    const deviceOs = body.os || 'unknown';
    const deviceArch = body.arch || 'unknown';

    // Replay cache: same IP within window gets cached response
    const cached = replayCache.get(code);
    if (cached && cached.ip === ip && Date.now() < cached.expiresAt) {
      return reply.send(cached.response);
    }

    // Code-level attempt limit
    const attempts = (codeAttempts.get(code) ?? 0) + 1;
    codeAttempts.set(code, attempts);
    if (attempts > CODE_MAX_ATTEMPTS) {
      return reply
        .status(429)
        .send({ error: 'Code locked due to too many attempts.' });
    }

    const setupCode = await prisma.setupCode.findUnique({
      where: { code },
      include: { tenant: true },
    });

    if (!setupCode) {
      return reply
        .status(404)
        .send({ error: 'Code not found or expired.' });
    }

    if (setupCode.consumedAt) {
      return reply.status(410).send({ error: 'Code already used.' });
    }

    if (setupCode.expiresAt < new Date()) {
      return reply.status(404).send({
        error: 'Code expired. Generate a new one from the portal.',
      });
    }

    // Consume
    await prisma.setupCode.update({
      where: { id: setupCode.id },
      data: { consumedAt: new Date(), consumedIp: ip },
    });

    const tenant = setupCode.tenant;
    const centralApiUrl =
      process.env.CENTRAL_API_URL || 'https://api.hubport.cloud';
    const portalUrl =
      process.env.PORTAL_BASE_URL || 'https://portal.hubport.cloud';

    // Create device authorization record
    const deviceCode = generateDeviceCode();
    const deviceExpiresAt = getDeviceCodeExpiresAt();

    await prisma.tenantDevice.create({
      data: {
        tenantId: tenant.id,
        deviceCode,
        hostname: deviceHostname,
        os: deviceOs,
        arch: deviceArch,
        ip,
        expiresAt: deviceExpiresAt,
      },
    });

    const response = {
      tenantId: tenant.id,
      slug: tenant.subdomain,
      name: tenant.name,
      email: tenant.email,
      tunnelToken: tenant.tunnelToken,
      centralApiUrl,
      portalUrl,
      role: tenant.role,
      deviceCode,
      verifyUrl: `${portalUrl}/portal/devices/verify`,
      deviceExpiresAt: deviceExpiresAt.toISOString(),
    };

    // Cache for replay window
    replayCache.set(code, {
      response,
      ip,
      expiresAt: Date.now() + REPLAY_WINDOW_MS,
    });

    // Cleanup old cache entries
    if (replayCache.size > 100) {
      const now = Date.now();
      for (const [k, v] of replayCache) {
        if (now > v.expiresAt) replayCache.delete(k);
      }
    }

    return reply.send(response);
  });

  // Poll device approval status (public, used by installer)
  // Higher rate limit than exchange — installer polls every 5s for up to 15 min.
  app.post('/setup/device/poll', async (req, reply) => {
    const ip = req.ip;
    if (!checkPollRateLimit(ip)) {
      return reply.status(429).send({ error: 'Too many poll attempts. Wait a moment and try again.' });
    }

    const body = req.body as { deviceCode?: string } | null;
    if (!body?.deviceCode) {
      return reply.status(400).send({ error: 'deviceCode required.' });
    }

    const device = await prisma.tenantDevice.findUnique({
      where: { deviceCode: body.deviceCode.toUpperCase() },
    });

    if (!device) {
      return reply.status(404).send({ error: 'Device code not found.' });
    }

    // Check expiry
    if (device.status === 'pending' && device.expiresAt < new Date()) {
      await prisma.tenantDevice.update({
        where: { id: device.id },
        data: { status: 'expired' },
      });
      return reply.send({ status: 'expired' });
    }

    return reply.send({ status: device.status });
  });
}
