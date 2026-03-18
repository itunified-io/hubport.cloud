import type { FastifyInstance, FastifyRequest } from "fastify";
import fjwt from "@fastify/jwt";

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
    // Dynamic JWKS verification — fetch public keys from Keycloak
    await app.register(fjwt, {
      decode: { complete: true },
      secret: async (_request: FastifyRequest) => {
        const res = await fetch(jwksUrl);
        const jwks = await res.json() as { keys: unknown[] };
        return { keys: jwks.keys } as unknown as string;
      },
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
    if (request.url.startsWith("/health")) return;

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
