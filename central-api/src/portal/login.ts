import type { FastifyInstance } from 'fastify';
import * as client from 'openid-client';
import { prisma } from '../lib/prisma.js';

let oidcConfig: client.Configuration | null = null;

function getKeycloakIssuer(): string {
  const url = process.env.KEYCLOAK_URL;
  const realm = process.env.KEYCLOAK_REALM || 'portal';
  if (!url) throw new Error('KEYCLOAK_URL environment variable is required');
  return `${url}/realms/${realm}`;
}

function getClientId(): string {
  return process.env.KEYCLOAK_CLIENT_ID || 'portal-app';
}

function getClientSecret(): string {
  return process.env.KEYCLOAK_CLIENT_SECRET || '';
}

function getCallbackUrl(): string {
  const base = process.env.PORTAL_BASE_URL || 'https://portal.hubport.cloud';
  return `${base}/portal/callback`;
}

async function getOidcConfig(): Promise<client.Configuration> {
  if (oidcConfig) return oidcConfig;
  const issuer = getKeycloakIssuer();
  const secret = getClientSecret();
  oidcConfig = await client.discovery(
    new URL(issuer),
    getClientId(),
    secret || undefined,
    undefined,
    secret ? undefined : { token_endpoint_auth_method: 'none' },
  );
  return oidcConfig;
}

// In-memory code_verifier store keyed by state. Production would use a session store.
const pendingAuthRequests = new Map<string, { codeVerifier: string; nonce: string }>();

export async function loginRoutes(app: FastifyInstance): Promise<void> {
  // GET /portal/login — redirect to Keycloak authorize endpoint
  app.get('/login', async (_req, reply) => {
    const config = await getOidcConfig();
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    const nonce = client.randomNonce();

    pendingAuthRequests.set(state, { codeVerifier, nonce });
    // Clean up after 10 minutes
    setTimeout(() => pendingAuthRequests.delete(state), 10 * 60 * 1000);

    const redirectTo = client.buildAuthorizationUrl(config, {
      redirect_uri: getCallbackUrl(),
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });

    reply.redirect(redirectTo.href);
  });

  // GET /portal/callback — exchange code for tokens, set session cookie
  app.get('/callback', async (req, reply) => {
    const config = await getOidcConfig();
    const query = req.query as Record<string, string>;
    const state = query.state;

    if (!state || !pendingAuthRequests.has(state)) {
      return reply.status(400).send('Invalid or expired authentication state. Please try logging in again.');
    }

    const { codeVerifier, nonce } = pendingAuthRequests.get(state)!;
    pendingAuthRequests.delete(state);

    try {
      const currentUrl = new URL(`${getCallbackUrl()}?${new URLSearchParams(query).toString()}`);
      const tokens = await client.authorizationCodeGrant(config, currentUrl, {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
        expectedNonce: nonce,
      });

      const accessToken = tokens.access_token;
      const refreshToken = tokens.refresh_token;

      // Extract user info from ID token claims
      const claims = tokens.claims();
      const keycloakUserId = claims?.sub;
      const email = claims?.email as string | undefined;

      // Look up or link tenant by keycloakUserId or email
      if (keycloakUserId) {
        let auth = await prisma.tenantAuth.findFirst({
          where: { keycloakUserId },
        });

        if (!auth && email) {
          // First OIDC login — link by email
          const tenant = await prisma.tenant.findFirst({
            where: { email: email.toLowerCase(), status: { in: ['APPROVED', 'ACTIVE'] } },
            include: { auth: true },
          });
          if (tenant?.auth) {
            await prisma.tenantAuth.update({
              where: { id: tenant.auth.id },
              data: { keycloakUserId, lastLoginAt: new Date() },
            });
          } else if (tenant) {
            await prisma.tenantAuth.create({
              data: { tenantId: tenant.id, keycloakUserId, lastLoginAt: new Date() },
            });
          }
        } else if (auth) {
          await prisma.tenantAuth.update({
            where: { id: auth.id },
            data: { lastLoginAt: new Date() },
          });
        }
      }

      // Set tokens in HttpOnly secure cookies
      const cookieOpts = 'HttpOnly; Secure; SameSite=Strict; Path=/portal';
      reply
        .header('Set-Cookie', `hubport_access=${accessToken}; ${cookieOpts}; Max-Age=${15 * 60}`)
        .header('Set-Cookie', `hubport_refresh=${refreshToken ?? ''}; ${cookieOpts}; Max-Age=${7 * 24 * 60 * 60}`)
        .redirect('/portal/dashboard');
    } catch (err) {
      req.log.error({ err }, 'OIDC callback failed');
      return reply.status(401).send('Authentication failed. Please try logging in again.');
    }
  });

  // POST /portal/logout — clear session, redirect to Keycloak logout
  app.post('/logout', async (_req, reply) => {
    const cookieOpts = 'HttpOnly; Secure; SameSite=Strict; Path=/portal; Max-Age=0';
    const keycloakLogoutUrl = `${getKeycloakIssuer()}/protocol/openid-connect/logout`;
    const postLogoutRedirect = process.env.PORTAL_BASE_URL || 'https://portal.hubport.cloud';

    reply
      .header('Set-Cookie', `hubport_access=; ${cookieOpts}`)
      .header('Set-Cookie', `hubport_refresh=; ${cookieOpts}`)
      .redirect(`${keycloakLogoutUrl}?post_logout_redirect_uri=${encodeURIComponent(postLogoutRedirect + '/portal/login')}&client_id=${getClientId()}`);
  });
}
