import type { FastifyInstance, FastifyRequest } from "fastify";
import fjwt from "@fastify/jwt";
import buildGetJwks from "get-jwks";

export interface UserPayload {
  sub: string;
  email: string;
  preferred_username: string;
  roles: string[];
}

declare module "fastify" {
  interface FastifyRequest {
    user: UserPayload;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      email: string;
      preferred_username: string;
      realm_access?: { roles?: string[] };
    };
    user: UserPayload;
  }
}

function extractRoles(decoded: Record<string, unknown>): string[] {
  const realmAccess = decoded.realm_access as { roles?: string[] } | undefined;
  return realmAccess?.roles ?? [];
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  const secret = process.env.JWT_SECRET;
  const jwksUrl = process.env.KEYCLOAK_JWKS_URL;

  // In dev/TST: use a simple secret. In UAT/PRD: use JWKS from Keycloak.
  if (secret) {
    await app.register(fjwt, { secret });
  } else if (jwksUrl) {
    // JWKS verification — fetch public keys from Keycloak via get-jwks
    // Use internal Docker URL (KEYCLOAK_JWKS_URL) since JWT iss is the external URL
    // which is unreachable from inside the container
    const internalDomain = jwksUrl.replace(/\/protocol\/openid-connect\/certs$/, "");
    const getJwks = buildGetJwks({
      providerDiscovery: false,
      jwksPath: "/protocol/openid-connect/certs",
      issuersWhitelist: [internalDomain],
    });
    const secretCallback = async (
      _request: FastifyRequest,
      token: { header: { kid?: string; alg?: string } },
    ): Promise<string> => {
      return getJwks.getPublicKey({
        kid: token.header.kid,
        alg: token.header.alg ?? "RS256",
        domain: internalDomain,
      });
    };
    await app.register(fjwt, {
      decode: { complete: true },
      secret: secretCallback as unknown as string,
    });
  } else {
    app.log.warn("No JWT_SECRET or KEYCLOAK_JWKS_URL — auth disabled (dev mode)");
    // Decorate request with a default user for dev
    app.addHook("onRequest", async (request) => {
      (request as unknown as { user: UserPayload }).user = {
        sub: "dev-user",
        email: "dev@localhost",
        preferred_username: "developer",
        roles: ["admin"],
      };
    });
    return;
  }

  app.addHook("onRequest", async (request: FastifyRequest, reply) => {
    // Only require auth for API routes — SPA static files are public
    // (the SPA itself handles auth via Keycloak OIDC in the browser)
    const API_PREFIXES = ["/publishers", "/territories", "/meetings", "/permissions", "/onboarding", "/roles", "/users", "/audit"];
    const path = request.url.split("?")[0];
    if (!API_PREFIXES.some((p) => path.startsWith(p))) return;

    try {
      const decoded = await request.jwtVerify<Record<string, unknown>>();
      (request as unknown as { user: UserPayload }).user = {
        sub: (decoded.sub as string) ?? "",
        email: (decoded.email as string) ?? "",
        preferred_username: (decoded.preferred_username as string) ?? "",
        roles: extractRoles(decoded),
      };
    } catch {
      reply.code(401).send({ error: "Unauthorized" });
    }
  });
}
