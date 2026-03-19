import type { FastifyInstance } from 'fastify';
import { TOTP } from 'otpauth';
import * as QRCode from 'qrcode';
import { prisma } from '../lib/prisma.js';
import { verifyPassword } from '../lib/crypto.js';
import { portalAuth } from './auth.js';
import { portalShell } from './ui.js';

export async function totpRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', portalAuth);

  // GET /portal/totp/enroll — show QR code
  app.get('/totp/enroll', async (req, reply) => {
    const tenantId = (req as unknown as Record<string, unknown>).tenantId as string;
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { auth: true },
    });

    if (!tenant?.auth) {
      return reply.status(404).type('text/html').send(portalShell('Error', '<p class="text-red-400">Account not found.</p>'));
    }

    if (tenant.auth.totpEnabled) {
      return reply.type('text/html').send(portalShell('2FA Already Enabled', `
        <div class="max-w-md mx-auto text-center">
          <p class="text-zinc-400 mb-4">Two-factor authentication is already enabled on your account.</p>
          <a href="/portal/dashboard" class="text-amber-500 underline">Back to Dashboard</a>
        </div>
      `));
    }

    // Generate TOTP secret
    const totp = new TOTP({
      issuer: 'hubport.cloud',
      label: tenant.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });

    const secret = totp.secret.base32;
    const uri = totp.toString();

    // Store secret temporarily (not yet enabled)
    await prisma.tenantAuth.update({
      where: { id: tenant.auth.id },
      data: { totpSecret: secret },
    });

    // Generate QR code as data URI
    const qrDataUrl = await QRCode.toDataURL(uri, { width: 256, margin: 2 });

    reply.type('text/html').send(portalShell('Enable Two-Factor Authentication', `
      <div class="max-w-md mx-auto">
        <h2 class="text-2xl text-amber-500 mb-4 text-center">Enable 2FA</h2>
        <p class="text-zinc-400 text-sm mb-6 text-center">Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password, etc.)</p>

        <div class="flex justify-center mb-6">
          <div class="bg-white p-4 rounded-xl">
            <img src="${qrDataUrl}" alt="TOTP QR Code" width="256" height="256">
          </div>
        </div>

        <div class="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 mb-6">
          <p class="text-xs text-zinc-500 mb-1">Manual entry key:</p>
          <p class="font-mono text-sm text-amber-400 break-all select-all">${secret}</p>
        </div>

        <form method="POST" action="/portal/totp/verify" class="space-y-4">
          <div>
            <label class="block text-sm text-zinc-400 mb-1">Enter the 6-digit code from your app</label>
            <input type="text" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"
              class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-zinc-200 text-center text-2xl tracking-widest focus:border-amber-500 focus:outline-none"
              placeholder="000000" required autofocus>
          </div>
          <button type="submit" class="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold py-3 rounded-lg transition">Verify &amp; Enable 2FA</button>
        </form>

        <p class="text-center mt-4">
          <a href="/portal/dashboard" class="text-sm text-zinc-500 hover:text-zinc-300">Cancel</a>
        </p>
      </div>
    `));
  });

  // POST /portal/totp/verify — verify code and enable 2FA
  app.post('/totp/verify', async (req, reply) => {
    const tenantId = (req as unknown as Record<string, unknown>).tenantId as string;
    const body = req.body as { code?: string } | null;

    if (!body?.code || body.code.length !== 6) {
      return reply.type('text/html').send(portalShell('Error', '<p class="text-red-400">Please enter a valid 6-digit code. <a href="/portal/totp/enroll" class="text-amber-500 underline">Try again</a>.</p>'));
    }

    const auth = await prisma.tenantAuth.findUnique({ where: { tenantId } });
    if (!auth?.totpSecret) {
      return reply.status(400).type('text/html').send(portalShell('Error', '<p class="text-red-400">No TOTP enrollment in progress. <a href="/portal/totp/enroll" class="text-amber-500 underline">Start enrollment</a>.</p>'));
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
      return reply.type('text/html').send(portalShell('Invalid Code', '<p class="text-red-400">The code is incorrect or expired. <a href="/portal/totp/enroll" class="text-amber-500 underline">Try again</a>.</p>'));
    }

    // Enable 2FA
    await prisma.tenantAuth.update({
      where: { id: auth.id },
      data: { totpEnabled: true },
    });

    reply.type('text/html').send(portalShell('2FA Enabled', `
      <div class="text-center py-8">
        <div class="text-4xl mb-4 text-green-400">&#10003;</div>
        <h2 class="text-2xl text-amber-500 mb-4">Two-Factor Authentication Enabled</h2>
        <p class="text-zinc-400 mb-6">Your account is now protected with 2FA. You will need your authenticator app code every time you log in.</p>
        <a href="/portal/dashboard" class="inline-block bg-amber-600 hover:bg-amber-700 text-white font-semibold py-3 px-8 rounded-lg transition">Back to Dashboard</a>
      </div>
    `));
  });

  // POST /portal/totp/disable — disable 2FA (requires password)
  app.post('/totp/disable', async (req, reply) => {
    const tenantId = (req as unknown as Record<string, unknown>).tenantId as string;
    const body = req.body as { password?: string } | null;

    if (!body?.password) {
      return reply.status(400).send({ error: 'Password required to disable 2FA' });
    }

    const auth = await prisma.tenantAuth.findUnique({ where: { tenantId } });
    if (!auth) {
      return reply.status(404).send({ error: 'Account not found' });
    }

    const valid = await verifyPassword(auth.passwordHash, body.password);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid password' });
    }

    await prisma.tenantAuth.update({
      where: { id: auth.id },
      data: { totpEnabled: false, totpSecret: null },
    });

    reply.redirect('/portal/dashboard');
  });
}
