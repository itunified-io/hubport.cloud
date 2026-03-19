import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { hashPassword, createAccessToken } from '../lib/crypto.js';
import { portalShell, setupPage } from './ui.js';

export async function setupRoutes(app: FastifyInstance): Promise<void> {
  // GET /portal/setup?token=xxx — show setup form
  app.get('/setup', async (req, reply) => {
    const token = (req.query as Record<string, string>).token;
    if (!token) {
      return reply.status(400).type('text/html').send(portalShell('Invalid Link', '<p class="text-red-400">Setup link is invalid or missing.</p>'));
    }

    const auth = await prisma.tenantAuth.findUnique({
      where: { setupToken: token },
      include: { tenant: true },
    });

    if (!auth) {
      return reply.status(404).type('text/html').send(portalShell('Expired Link', '<p class="text-red-400">This setup link has expired or already been used.</p>'));
    }

    if (auth.setupTokenExpiresAt && auth.setupTokenExpiresAt < new Date()) {
      return reply.status(410).type('text/html').send(portalShell('Expired Link', '<p class="text-red-400">This setup link has expired. Contact support for a new one.</p>'));
    }

    if (auth.passwordHash) {
      return reply.status(409).type('text/html').send(portalShell('Already Set Up', '<p class="text-amber-400">Your account is already set up. <a href="/portal/login" class="text-amber-500 underline">Log in here</a>.</p>'));
    }

    reply.type('text/html').send(portalShell(`Set Up Your Account - ${auth.tenant.name}`, setupPage(auth.tenant.name, token)));
  });

  // POST /portal/setup — set password
  app.post('/setup', async (req, reply) => {
    const body = req.body as { token?: string; password?: string; confirmPassword?: string } | null;

    if (!body?.token || !body?.password || !body?.confirmPassword) {
      return reply.status(400).type('text/html').send(portalShell('Error', '<p class="text-red-400">All fields are required.</p>'));
    }

    if (body.password.length < 12) {
      return reply.status(400).type('text/html').send(portalShell('Error', '<p class="text-red-400">Password must be at least 12 characters.</p>'));
    }

    if (body.password !== body.confirmPassword) {
      return reply.status(400).type('text/html').send(portalShell('Error', '<p class="text-red-400">Passwords do not match.</p>'));
    }

    const auth = await prisma.tenantAuth.findUnique({
      where: { setupToken: body.token },
      include: { tenant: true },
    });

    if (!auth || (auth.setupTokenExpiresAt && auth.setupTokenExpiresAt < new Date())) {
      return reply.status(404).type('text/html').send(portalShell('Error', '<p class="text-red-400">Invalid or expired setup link.</p>'));
    }

    const hash = await hashPassword(body.password);

    await prisma.tenantAuth.update({
      where: { id: auth.id },
      data: {
        passwordHash: hash,
        setupToken: null,
        setupTokenExpiresAt: null,
      },
    });

    // After password set, redirect to mandatory MFA enrollment
    const accessToken = await createAccessToken({ tenantId: auth.tenantId, email: auth.tenant.email });

    reply
      .header('Set-Cookie', `hubport_access=${accessToken}; HttpOnly; Secure; SameSite=Strict; Path=/portal; Max-Age=${15 * 60}`)
      .redirect('/portal/mfa-setup');
  });
}
