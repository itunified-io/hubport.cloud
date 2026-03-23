/**
 * Onboarding token — short-lived JWT for invite signup wizard.
 * Uses @fastify/jwt (already registered on Fastify instance).
 * Single-tenant-per-database — no tenant ID needed.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createHash } from "node:crypto";
import prisma from "./prisma.js";

export interface OnboardingTokenPayload {
  sub: string;       // publisherId
  kc: string;        // keycloakSub
  scope: "onboarding";
}

export async function generateOnboardingToken(
  app: FastifyInstance,
  publisherId: string,
  keycloakSub: string,
): Promise<string> {
  // @fastify/jwt sign may be sync or async depending on version
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = await (app.jwt.sign as any)(
    { sub: publisherId, kc: keycloakSub, scope: "onboarding" },
    { expiresIn: "30m" },
  );
  return token as string;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Middleware: require a valid onboarding token.
 * Populates request.user with { sub: keycloakSub } so /security/* routes work.
 * Returns true if valid, false if reply already sent with error.
 */
export async function requireOnboardingToken(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Token erforderlich", code: "NO_TOKEN" });
    return false;
  }

  const token = authHeader.slice(7);
  let payload: OnboardingTokenPayload;

  try {
    payload = app.jwt.verify<OnboardingTokenPayload>(token);
  } catch {
    reply.code(401).send({ error: "Sitzung abgelaufen", code: "TOKEN_EXPIRED" });
    return false;
  }

  if (payload.scope !== "onboarding") {
    reply.code(403).send({ error: "Ungültiger Token", code: "INVALID_SCOPE" });
    return false;
  }

  const publisher = await prisma.publisher.findUnique({
    where: { id: payload.sub },
  });

  if (!publisher) {
    reply.code(404).send({ error: "Nutzer nicht gefunden", code: "NOT_FOUND" });
    return false;
  }

  if (publisher.onboardingStep === "complete") {
    reply.code(403).send({ error: "Registrierung bereits abgeschlossen", code: "ALREADY_COMPLETE" });
    return false;
  }

  const tokenHash = hashToken(token);
  if (publisher.onboardingToken !== tokenHash) {
    reply.code(401).send({ error: "Sitzung ungültig", code: "TOKEN_REVOKED" });
    return false;
  }

  // Populate request.user — same shape as OIDC so /security/* routes work
  (request as any).user = {
    sub: payload.kc,  // keycloakSub — matches OIDC user.sub
    email: publisher.email ?? "",
    preferred_username: publisher.email ?? "",
    roles: [],
    publisherId: payload.sub,
    scope: "onboarding",
  };

  return true;
}
