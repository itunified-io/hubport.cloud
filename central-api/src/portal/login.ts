import type { FastifyInstance } from 'fastify';
import { TOTP } from 'otpauth';
import { prisma } from '../lib/prisma.js';
import { verifyPassword, verifyToken, createAccessToken, createRefreshToken } from '../lib/crypto.js';
import { portalShell, loginPage } from './ui.js';

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export async function loginRoutes(app: FastifyInstance): Promise<void> {
  // GET /portal/login — show login form
  app.get('/login', async (_req, reply) => {
    reply.type('text/html').send(portalShell('Log In', loginPage()));
  });

  // POST /portal/login — authenticate
  app.post('/login', async (req, reply) => {
    const body = req.body as { email?: string; password?: string } | null;

    if (!body?.email || !body?.password) {
      return reply.type('text/html').send(portalShell('Log In', loginPage('Email and password are required.')));
    }

    const tenant = await prisma.tenant.findFirst({
      where: { email: body.email.toLowerCase().trim(), status: { in: ['APPROVED', 'ACTIVE'] } },
      include: { auth: true },
    });

    if (!tenant?.auth?.passwordHash) {
      return reply.type('text/html').send(portalShell('Log In', loginPage('Invalid email or password.')));
    }

    const auth = tenant.auth;

    // Check lockout
    if (auth.lockedUntil && auth.lockedUntil > new Date()) {
      const remainingMin = Math.ceil((auth.lockedUntil.getTime() - Date.now()) / 60000);
      return reply.type('text/html').send(portalShell('Log In', loginPage(`Account locked. Try again in ${remainingMin} minutes.`)));
    }

    const valid = await verifyPassword(auth.passwordHash, body.password);

    if (!valid) {
      const attempts = auth.failedAttempts + 1;
      const update: Record<string, unknown> = { failedAttempts: attempts };
      if (attempts >= LOCKOUT_THRESHOLD) {
        update.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
      }
      await prisma.tenantAuth.update({ where: { id: auth.id }, data: update });
      return reply.type('text/html').send(portalShell('Log In', loginPage('Invalid email or password.')));
    }

    // Check mfaCompleted gate — authoritative, checked before method-specific 2FA
    if (!auth.mfaCompleted) {
      const tempAccessToken = await createAccessToken({ tenantId: tenant.id, email: tenant.email });
      return reply
        .header('Set-Cookie', `hubport_access=${tempAccessToken}; HttpOnly; Secure; SameSite=Strict; Path=/portal; Max-Age=${15 * 60}`)
        .redirect('/portal/mfa-setup');
    }

    // Check TOTP if enabled
    if (auth.totpEnabled) {
      const tempToken = await createAccessToken({ tenantId: tenant.id, email: tenant.email });
      return reply.type('text/html').send(portalShell('Two-Factor Authentication', totpPage(tempToken)));
    }

    // Success — clear failed attempts, issue tokens
    await prisma.tenantAuth.update({
      where: { id: auth.id },
      data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const accessToken = await createAccessToken({ tenantId: tenant.id, email: tenant.email });
    const refreshToken = await createRefreshToken({ tenantId: tenant.id });

    reply
      .header('Set-Cookie', `hubport_refresh=${refreshToken}; HttpOnly; Secure; SameSite=Strict; Path=/portal; Max-Age=${7 * 24 * 60 * 60}`)
      .header('Set-Cookie', `hubport_access=${accessToken}; HttpOnly; Secure; SameSite=Strict; Path=/portal; Max-Age=${15 * 60}`)
      .redirect('/portal/dashboard');
  });

  // POST /portal/login/2fa — verify TOTP code
  app.post('/login/2fa', async (req, reply) => {
    const body = req.body as { tempToken?: string; code?: string } | null;

    if (!body?.tempToken || !body?.code) {
      return reply.type('text/html').send(portalShell('Log In', loginPage('Authentication code required.')));
    }

    const payload = await verifyToken(body.tempToken);
    if (!payload) {
      return reply.type('text/html').send(portalShell('Log In', loginPage('Session expired. Please log in again.')));
    }

    const auth = await prisma.tenantAuth.findUnique({ where: { tenantId: payload.tenantId } });
    if (!auth?.totpSecret) {
      return reply.type('text/html').send(portalShell('Log In', loginPage('2FA not configured.')));
    }

    const totp = new TOTP({
      issuer: 'hubport.cloud',
      label: '',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: auth.totpSecret,
    });

    const delta = totp.validate({ token: body.code, window: 1 });
    if (delta === null) {
      return reply.type('text/html').send(portalShell('Two-Factor Authentication', totpPage(body.tempToken, 'Invalid code. Please try again.')));
    }

    // Success
    await prisma.tenantAuth.update({
      where: { id: auth.id },
      data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const tenant = await prisma.tenant.findUnique({ where: { id: payload.tenantId } });
    const accessToken = await createAccessToken({ tenantId: payload.tenantId, email: tenant?.email ?? '' });
    const refreshToken = await createRefreshToken({ tenantId: payload.tenantId });

    reply
      .header('Set-Cookie', `hubport_refresh=${refreshToken}; HttpOnly; Secure; SameSite=Strict; Path=/portal; Max-Age=${7 * 24 * 60 * 60}`)
      .header('Set-Cookie', `hubport_access=${accessToken}; HttpOnly; Secure; SameSite=Strict; Path=/portal; Max-Age=${15 * 60}`)
      .redirect('/portal/dashboard');
  });

  // POST /portal/logout
  app.post('/logout', async (_req, reply) => {
    reply
      .header('Set-Cookie', 'hubport_refresh=; HttpOnly; Secure; SameSite=Strict; Path=/portal; Max-Age=0')
      .header('Set-Cookie', 'hubport_access=; HttpOnly; Secure; SameSite=Strict; Path=/portal; Max-Age=0')
      .redirect('/portal/login');
  });
}

function totpPage(tempToken: string, error?: string): string {
  return `
    <div class="max-w-md mx-auto">
      <h2 class="text-2xl text-amber-500 mb-6 text-center">Two-Factor Authentication</h2>
      ${error ? `<div class="bg-red-900/20 border border-red-700/30 rounded-lg p-3 mb-4 text-sm text-red-400">${error}</div>` : ''}
      <form method="POST" action="/portal/login/2fa" class="space-y-4">
        <input type="hidden" name="tempToken" value="${tempToken}">
        <div>
          <label class="block text-sm text-zinc-400 mb-1">Authentication Code</label>
          <input type="text" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"
            class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-zinc-200 text-center text-2xl tracking-widest focus:border-amber-500 focus:outline-none"
            placeholder="000000" required autofocus>
        </div>
        <button type="submit" class="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold py-3 rounded-lg transition">Verify</button>
      </form>
    </div>
  `;
}
