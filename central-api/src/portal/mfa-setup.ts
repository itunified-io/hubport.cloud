import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { portalAuth } from './auth.js';
import { portalShell } from './ui.js';

export async function mfaSetupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/mfa-setup', { preHandler: portalAuth }, async (req, reply) => {
    const tenantId = (req as unknown as Record<string, unknown>).tenantId as string;
    const auth = await prisma.tenantAuth.findUnique({ where: { tenantId } });
    if (auth?.mfaCompleted) return reply.redirect('/portal/dashboard');

    const passkeys = await prisma.tenantPasskey.findMany({ where: { tenantId } });
    const hasPasskey = passkeys.length > 0;
    const hasTOTP = auth?.totpEnabled ?? false;

    reply.type('text/html').send(portalShell('Set Up Two-Factor Authentication', mfaSetupPage(hasPasskey, hasTOTP)));
  });

  app.post('/mfa-setup/complete', { preHandler: portalAuth }, async (req, reply) => {
    const tenantId = (req as unknown as Record<string, unknown>).tenantId as string;
    const auth = await prisma.tenantAuth.findUnique({ where: { tenantId } });
    if (!auth) return reply.status(404).send({ error: 'Account not found' });

    const passkeys = await prisma.tenantPasskey.count({ where: { tenantId } });
    const hasTOTP = auth.totpEnabled;

    if (passkeys === 0 && !hasTOTP) return reply.redirect('/portal/mfa-setup');

    if (passkeys > 0 && !hasTOTP) {
      return reply.type('text/html').send(portalShell('Set Up Two-Factor Authentication',
        mfaSetupPage(true, false, 'Passkey registered! You must also set up TOTP as a recovery method.')));
    }

    await prisma.tenantAuth.update({
      where: { id: auth.id },
      data: { mfaCompleted: true },
    });
    reply.redirect('/portal/dashboard');
  });
}

function mfaSetupPage(hasPasskey: boolean, hasTOTP: boolean, message?: string): string {
  const canComplete = hasTOTP;
  return `
    <div class="max-w-2xl mx-auto">
      <h2 class="text-2xl text-amber-500 mb-2 text-center">Set Up Two-Factor Authentication</h2>
      <p class="text-zinc-400 text-sm mb-8 text-center">Protect your account with a second factor. This is mandatory before accessing your dashboard.</p>
      ${message ? '<div class="bg-amber-900/20 border border-amber-700/30 rounded-lg p-3 mb-6 text-sm text-amber-400">' + message + '</div>' : ''}
      <div class="grid md:grid-cols-2 gap-6 mb-8">
        <div class="bg-zinc-900/50 border ${hasPasskey ? 'border-green-700/50' : 'border-zinc-800'} rounded-xl p-6">
          <div class="flex items-center gap-2 mb-3">
            <span class="text-2xl">${hasPasskey ? '&#10003;' : '&#128274;'}</span>
            <h3 class="text-lg font-semibold text-zinc-200">Passkey</h3>
            <span class="text-xs bg-amber-600/20 text-amber-400 px-2 py-0.5 rounded-full">Recommended</span>
          </div>
          <p class="text-zinc-400 text-sm mb-4">Use your fingerprint, Face ID, or security key.</p>
          ${hasPasskey
            ? '<p class="text-green-400 text-sm">&#10003; Passkey registered</p>'
            : '<button onclick="registerPasskey()" class="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold py-2.5 rounded-lg transition">Register Passkey</button>'}
        </div>
        <div class="bg-zinc-900/50 border ${hasTOTP ? 'border-green-700/50' : 'border-zinc-800'} rounded-xl p-6">
          <div class="flex items-center gap-2 mb-3">
            <span class="text-2xl">${hasTOTP ? '&#10003;' : '&#128241;'}</span>
            <h3 class="text-lg font-semibold text-zinc-200">Authenticator App</h3>
          </div>
          <p class="text-zinc-400 text-sm mb-4">Use Google Authenticator, Authy, or similar.</p>
          ${hasTOTP
            ? '<p class="text-green-400 text-sm">&#10003; TOTP enabled</p>'
            : '<a href="/portal/totp/enroll" class="block w-full bg-zinc-700 hover:bg-zinc-600 text-white font-semibold py-2.5 rounded-lg transition text-center">Set Up TOTP</a>'}
        </div>
      </div>
      ${canComplete ? '<form method="POST" action="/portal/mfa-setup/complete" class="text-center"><button type="submit" class="bg-amber-600 hover:bg-amber-700 text-white font-semibold py-3 px-8 rounded-lg transition">Continue to Dashboard</button></form>' : '<p class="text-center text-zinc-500 text-sm">Set up at least one authentication method to continue.</p>'}
    </div>
    <script>
    async function registerPasskey() {
      try {
        const optionsRes = await fetch('/portal/passkey/register-options', { credentials: 'same-origin' });
        if (!optionsRes.ok) throw new Error('Failed to get options');
        const options = await optionsRes.json();
        options.challenge = base64URLToBuffer(options.challenge);
        options.user.id = base64URLToBuffer(options.user.id);
        if (options.excludeCredentials) {
          options.excludeCredentials = options.excludeCredentials.map(c => ({...c, id: base64URLToBuffer(c.id)}));
        }
        const credential = await navigator.credentials.create({ publicKey: options });
        if (!credential) throw new Error('No credential returned');
        const attestation = credential;
        const verifyRes = await fetch('/portal/passkey/register-verify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({
            id: attestation.id, rawId: bufferToBase64URL(attestation.rawId),
            response: { clientDataJSON: bufferToBase64URL(attestation.response.clientDataJSON), attestationObject: bufferToBase64URL(attestation.response.attestationObject), transports: attestation.response.getTransports ? attestation.response.getTransports() : [] },
            type: attestation.type, clientExtensionResults: attestation.getClientExtensionResults(),
          }),
        });
        if (verifyRes.ok) window.location.reload();
        else { const err = await verifyRes.json(); alert('Registration failed: ' + (err.error || 'Unknown error')); }
      } catch (e) { alert('Passkey registration failed: ' + e.message); }
    }
    function base64URLToBuffer(base64url) {
      const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
      const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
      return Uint8Array.from(atob(base64 + pad), c => c.charCodeAt(0)).buffer;
    }
    function bufferToBase64URL(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    }
    </script>
  `;
}
