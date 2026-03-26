import type { FastifyRequest, FastifyReply } from 'fastify';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { prisma } from '../lib/prisma.js';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getKeycloakJwksUri(): URL {
  const url = process.env.KEYCLOAK_URL;
  const realm = process.env.KEYCLOAK_REALM || 'portal';
  if (!url) throw new Error('KEYCLOAK_URL environment variable is required');
  return new URL(`${url}/realms/${realm}/protocol/openid-connect/certs`);
}

function getExpectedIssuer(): string {
  const url = process.env.KEYCLOAK_URL;
  const realm = process.env.KEYCLOAK_REALM || 'portal';
  if (!url) throw new Error('KEYCLOAK_URL environment variable is required');
  return `${url}/realms/${realm}`;
}

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) {
    jwks = createRemoteJWKSet(getKeycloakJwksUri());
  }
  return jwks;
}

export async function portalAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  let token: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else {
    const cookies = parseCookies(request.headers.cookie ?? '');
    token = cookies['hubport_access'];
  }

  if (!token) {
    reply.status(401).type('text/html').send(loginRedirectHtml());
    return;
  }

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: getExpectedIssuer(),
    });

    const keycloakUserId = payload.sub;
    const email = (payload as Record<string, unknown>).email as string | undefined;
    const preferredUsername = (payload as Record<string, unknown>).preferred_username as string | undefined;

    if (!keycloakUserId) {
      reply.status(401).type('text/html').send(loginRedirectHtml());
      return;
    }

    // Look up tenant by keycloakUserId first, then fall back to email
    let auth = await prisma.tenantAuth.findFirst({
      where: { keycloakUserId },
      include: { tenant: true },
    });

    if (!auth && email) {
      const tenant = await prisma.tenant.findFirst({
        where: { email: email.toLowerCase(), status: { in: ['APPROVED', 'ACTIVE'] } },
        include: { auth: true },
      });
      if (tenant?.auth) {
        // Link Keycloak user on first token validation
        await prisma.tenantAuth.update({
          where: { id: tenant.auth.id },
          data: { keycloakUserId },
        });
        auth = { ...tenant.auth, keycloakUserId, tenant };
      }
    }

    if (!auth?.tenant) {
      reply.status(401).type('text/html').send(loginRedirectHtml());
      return;
    }

    (request as unknown as Record<string, unknown>).tenantId = auth.tenant.id;
    (request as unknown as Record<string, unknown>).tenantEmail = email ?? preferredUsername ?? auth.tenant.email;
  } catch {
    reply.status(401).type('text/html').send(loginRedirectHtml());
  }
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of cookieHeader.split(';')) {
    const [key, ...vals] = pair.trim().split('=');
    if (key) cookies[key] = vals.join('=');
  }
  return cookies;
}

function loginRedirectHtml(): string {
  return `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=/portal/login"></head><body>Redirecting to login...</body></html>`;
}
