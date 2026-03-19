import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from '../lib/crypto.js';

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

  const payload = await verifyToken(token);
  if (!payload) {
    reply.status(401).type('text/html').send(loginRedirectHtml());
    return;
  }

  (request as unknown as Record<string, unknown>).tenantId = payload.tenantId;
  (request as unknown as Record<string, unknown>).tenantEmail = payload.email;
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
