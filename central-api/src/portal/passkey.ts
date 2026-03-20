import type { FastifyInstance } from 'fastify';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/types';
import { prisma } from '../lib/prisma.js';
import { portalAuth } from './auth.js';
import { createAccessToken, createRefreshToken, verifyPassword } from '../lib/crypto.js';

const rpName = 'hubport.cloud';
const rpID = 'hubport.cloud';

function getExpectedOrigin(): string {
  return process.env.WEBAUTHN_ORIGIN
    || (process.env.NODE_ENV === 'production'
      ? 'https://portal.hubport.cloud'
      : 'https://portal-uat.hubport.cloud');
}

/** Convert a Prisma Bytes (Buffer/Uint8Array) to a Base64URL string. */
function bytesToBase64URL(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

const challenges = new Map<string, string>();

export async function passkeyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/passkey/register-options', { preHandler: portalAuth }, async (req, reply) => {
    const tenantId = (req as unknown as Record<string, unknown>).tenantId as string;
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return reply.status(404).send({ error: 'Tenant not found' });

    const existingPasskeys = await prisma.tenantPasskey.findMany({
      where: { tenantId },
      select: { credentialId: true },
    });

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: tenant.email,
      userDisplayName: tenant.name,
      attestationType: 'none',
      excludeCredentials: existingPasskeys.map((pk) => ({
        id: bytesToBase64URL(pk.credentialId),
        transports: [] as AuthenticatorTransportFuture[],
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    challenges.set(tenantId, options.challenge);
    setTimeout(() => challenges.delete(tenantId), 300000);
    return reply.send(options);
  });

  app.post('/passkey/register-verify', { preHandler: portalAuth }, async (req, reply) => {
    const tenantId = (req as unknown as Record<string, unknown>).tenantId as string;
    const body = req.body as RegistrationResponseJSON;
    const expectedChallenge = challenges.get(tenantId);
    if (!expectedChallenge) {
      return reply.status(400).send({ error: 'Challenge expired. Please try again.' });
    }

    try {
      const verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin: getExpectedOrigin(),
        expectedRPID: rpID,
      });

      if (!verification.verified || !verification.registrationInfo) {
        return reply.status(400).send({ error: 'Verification failed' });
      }

      const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

      // credential.id is Base64URLString, credential.publicKey is Uint8Array
      await prisma.tenantPasskey.create({
        data: {
          tenantId,
          credentialId: Buffer.from(credential.id, 'base64url'),
          publicKey: Buffer.from(credential.publicKey),
          counter: BigInt(credential.counter),
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
          transports: (credential.transports ?? []) as string[],
        },
      });

      challenges.delete(tenantId);
      return reply.send({ verified: true });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Verification failed' });
    }
  });

  app.get('/passkey/auth-options', async (req, reply) => {
    const email = (req.query as Record<string, string>).email;
    if (!email) return reply.status(400).send({ error: 'Email required' });

    const tenant = await prisma.tenant.findFirst({
      where: { email: email.toLowerCase().trim(), status: { in: ['APPROVED', 'ACTIVE'] } },
    });
    if (!tenant) return reply.status(404).send({ error: 'Tenant not found' });

    const passkeys = await prisma.tenantPasskey.findMany({
      where: { tenantId: tenant.id },
      select: { credentialId: true, transports: true },
    });

    if (passkeys.length === 0) {
      return reply.status(404).send({ error: 'No passkeys registered' });
    }

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: passkeys.map((pk) => ({
        id: bytesToBase64URL(pk.credentialId),
        transports: pk.transports as AuthenticatorTransportFuture[],
      })),
      userVerification: 'preferred',
    });

    challenges.set(`auth:${tenant.id}`, options.challenge);
    setTimeout(() => challenges.delete(`auth:${tenant.id}`), 300000);
    return reply.send({ ...options, tenantId: tenant.id });
  });

  app.post('/passkey/auth-verify', async (req, reply) => {
    const body = req.body as AuthenticationResponseJSON & { tenantId?: string };
    const tenantId = body.tenantId;
    if (!tenantId) return reply.status(400).send({ error: 'tenantId required' });

    const expectedChallenge = challenges.get(`auth:${tenantId}`);
    if (!expectedChallenge) {
      return reply.status(400).send({ error: 'Challenge expired' });
    }

    const credentialIdBuffer = Buffer.from(body.id, 'base64url');
    const passkey = await prisma.tenantPasskey.findFirst({
      where: { tenantId, credentialId: credentialIdBuffer },
    });

    if (!passkey) return reply.status(401).send({ error: 'Passkey not found' });

    try {
      const verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin: getExpectedOrigin(),
        expectedRPID: rpID,
        credential: {
          id: bytesToBase64URL(passkey.credentialId),
          publicKey: new Uint8Array(passkey.publicKey),
          counter: Number(passkey.counter),
          transports: passkey.transports as AuthenticatorTransportFuture[],
        },
      });

      if (!verification.verified) return reply.status(401).send({ error: 'Verification failed' });

      await prisma.tenantPasskey.update({
        where: { id: passkey.id },
        data: { counter: BigInt(verification.authenticationInfo.newCounter) },
      });

      await prisma.tenantAuth.updateMany({
        where: { tenantId },
        data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      });

      challenges.delete(`auth:${tenantId}`);

      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      const accessToken = await createAccessToken({ tenantId, email: tenant?.email ?? '' });
      const refreshToken = await createRefreshToken({ tenantId });

      reply
        .header('Set-Cookie', `hubport_refresh=${refreshToken}; HttpOnly; Secure; SameSite=Strict; Path=/portal; Max-Age=${7 * 24 * 60 * 60}`)
        .header('Set-Cookie', `hubport_access=${accessToken}; HttpOnly; Secure; SameSite=Strict; Path=/portal; Max-Age=${15 * 60}`)
        .send({ verified: true, redirect: '/portal/dashboard' });
    } catch (error) {
      return reply.status(401).send({ error: error instanceof Error ? error.message : 'Verification failed' });
    }
  });

  // Discoverable credential auth options (no email needed — passkey-first login)
  app.get('/passkey/auth-options-discoverable', async (_req, reply) => {
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
      // No allowCredentials — browser discovers from resident keys
    });

    const sessionId = Buffer.from(
      globalThis.crypto.getRandomValues(new Uint8Array(16))
    ).toString('hex');
    challenges.set(`disc:${sessionId}`, options.challenge);
    setTimeout(() => challenges.delete(`disc:${sessionId}`), 300000);

    return reply.send({ ...options, sessionId });
  });

  // Verify discoverable credential (passkey-first login)
  app.post('/passkey/auth-verify-discoverable', async (req, reply) => {
    const body = req.body as AuthenticationResponseJSON & { sessionId?: string };

    if (!body.sessionId) {
      return reply.status(400).send({ error: 'sessionId required' });
    }

    const expectedChallenge = challenges.get(`disc:${body.sessionId}`);
    if (!expectedChallenge) {
      return reply.status(400).send({ error: 'Challenge expired' });
    }

    // Find passkey by credential ID
    const credentialIdBuffer = Buffer.from(body.id, 'base64url');
    const passkey = await prisma.tenantPasskey.findFirst({
      where: { credentialId: credentialIdBuffer },
      include: { tenant: true },
    });

    if (!passkey) return reply.status(401).send({ error: 'Passkey not found' });

    try {
      const verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin: getExpectedOrigin(),
        expectedRPID: rpID,
        credential: {
          id: bytesToBase64URL(passkey.credentialId),
          publicKey: new Uint8Array(passkey.publicKey),
          counter: Number(passkey.counter),
          transports: passkey.transports as AuthenticatorTransportFuture[],
        },
      });

      if (!verification.verified) return reply.status(401).send({ error: 'Verification failed' });

      await prisma.tenantPasskey.update({
        where: { id: passkey.id },
        data: { counter: BigInt(verification.authenticationInfo.newCounter) },
      });

      await prisma.tenantAuth.updateMany({
        where: { tenantId: passkey.tenantId },
        data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      });

      challenges.delete(`disc:${body.sessionId}`);

      const tenant = passkey.tenant;
      const accessToken = await createAccessToken({ tenantId: tenant.id, email: tenant.email });
      const refreshToken = await createRefreshToken({ tenantId: tenant.id });

      reply
        .header('Set-Cookie', `hubport_refresh=${refreshToken}; HttpOnly; Secure; SameSite=Strict; Path=/portal; Max-Age=${7 * 24 * 60 * 60}`)
        .header('Set-Cookie', `hubport_access=${accessToken}; HttpOnly; Secure; SameSite=Strict; Path=/portal; Max-Age=${15 * 60}`)
        .send({ verified: true, redirect: '/portal/dashboard' });
    } catch (error) {
      return reply.status(401).send({ error: error instanceof Error ? error.message : 'Verification failed' });
    }
  });

  app.get('/passkey/list', { preHandler: portalAuth }, async (req, reply) => {
    const tenantId = (req as unknown as Record<string, unknown>).tenantId as string;
    const passkeys = await prisma.tenantPasskey.findMany({
      where: { tenantId },
      select: { id: true, deviceType: true, backedUp: true, friendlyName: true, createdAt: true },
    });
    return reply.send({ passkeys: passkeys.map((pk) => ({ ...pk, name: pk.friendlyName })) });
  });

  app.post('/passkey/delete', { preHandler: portalAuth }, async (req, reply) => {
    const tenantId = (req as unknown as Record<string, unknown>).tenantId as string;
    const body = req.body as { credentialId?: string; password?: string } | null;
    if (!body?.credentialId || !body?.password) {
      return reply.status(400).send({ error: 'Credential ID and password required' });
    }
    const auth = await prisma.tenantAuth.findUnique({ where: { tenantId } });
    if (!auth) return reply.status(404).send({ error: 'Account not found' });

    if (!auth.passwordHash) return reply.status(401).send({ error: 'Account setup not completed' });
    const valid = await verifyPassword(auth.passwordHash, body.password);
    if (!valid) return reply.status(401).send({ error: 'Invalid password' });

    const remainingPasskeys = await prisma.tenantPasskey.count({
      where: { tenantId, id: { not: body.credentialId } },
    });
    if (remainingPasskeys === 0 && !auth.totpEnabled) {
      return reply.status(400).send({ error: 'Cannot remove last MFA method. Enable TOTP first.' });
    }
    await prisma.tenantPasskey.delete({ where: { id: body.credentialId } });
    return reply.send({ deleted: true });
  });
}
