/**
 * Internal bootstrap endpoint — creates the first admin Publisher record.
 *
 * Security:
 *   - X-Bootstrap-Secret header must match KEYCLOAK_ADMIN_CLIENT_SECRET
 *   - Zero-publisher guard: returns 409 if any publisher exists (one-shot)
 *   - No RBAC/JWT required — this runs before any user can authenticate
 *   - Audit-logged
 *
 * Called by the installer after Keycloak user creation.
 */
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { audit } from "../lib/policy-engine.js";
import { generateInternalEmail } from "./publishers.js";

const BootstrapBody = Type.Object({
  firstName: Type.String({ minLength: 1 }),
  lastName: Type.String({ minLength: 1 }),
  email: Type.String({ format: "email" }),
  keycloakSub: Type.String({ minLength: 1 }),
  congregationRole: Type.Optional(
    Type.Union([
      Type.Literal("publisher"),
      Type.Literal("ministerial_servant"),
      Type.Literal("elder"),
    ]),
  ),
});

type BootstrapBodyType = Static<typeof BootstrapBody>;

export async function internalRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: BootstrapBodyType }>(
    "/internal/bootstrap",
    { schema: { body: BootstrapBody } },
    async (request, reply) => {
      // 1. Validate shared secret
      const secret = request.headers["x-bootstrap-secret"];
      const expected = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET;
      if (!expected || secret !== expected) {
        return reply.code(401).send({ error: "Invalid bootstrap secret" });
      }

      // 2. Zero-publisher guard — one-shot only
      const count = await prisma.publisher.count();
      if (count > 0) {
        return reply
          .code(409)
          .send({ error: "Already bootstrapped", publisherCount: count });
      }

      // 3. Create admin publisher
      const { firstName, lastName, email, keycloakSub, congregationRole } =
        request.body;
      const internalEmail = await generateInternalEmail(firstName, lastName);

      const publisher = await prisma.publisher.create({
        data: {
          firstName,
          lastName,
          email,
          internalEmail,
          keycloakSub,
          congregationRole: congregationRole ?? "elder",
          role: "admin",
          isOwner: true,
          status: "active",
        },
      });

      await audit(
        "publisher.bootstrap",
        "installer",
        "Publisher",
        publisher.id,
        undefined,
        publisher,
      );

      app.log.info(
        `Bootstrap: admin publisher created (${firstName} ${lastName}, ${email})`,
      );
      return reply.code(201).send(publisher);
    },
  );
}
