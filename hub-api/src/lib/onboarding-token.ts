/**
 * Onboarding token — short-lived JWT for invite signup wizard.
 * Uses fast-jwt with a local HMAC secret (NOT app.jwt which uses JWKS for verification only).
 * Single-tenant-per-database — no tenant ID needed.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { createSigner, createVerifier } from "fast-jwt";
import prisma from "./prisma.js";

export interface OnboardingTokenPayload {
  sub: string;       // publisherId
  kc: string;        // keycloakSub
  scope: "onboarding";
}

/** Get or generate the onboarding token signing secret */
function getOnboardingSecret(): string {
  // Use KEYCLOAK_ADMIN_CLIENT_SECRET as HMAC key (available in every tenant stack)
  // Falls back to JWT_SECRET or a per-process random (dev only)
  return (
    process.env.KEYCLOAK_ADMIN_CLIENT_SECRET ??
    process.env.JWT_SECRET ??
    randomBytes(32).toString("hex")
  );
}

export async function generateOnboardingToken(
  _app: FastifyInstance,
  publisherId: string,
  keycloakSub: string,
): Promise<string> {
  const signer = createSigner({
    key: getOnboardingSecret(),
    algorithm: "HS256",
    expiresIn: 1800000, // 30 minutes in ms
  });
  return signer({ sub: publisherId, kc: keycloakSub, scope: "onboarding" });
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
    const verifier = createVerifier({ key: getOnboardingSecret(), algorithms: ["HS256"] });
    payload = verifier(token) as OnboardingTokenPayload;
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
