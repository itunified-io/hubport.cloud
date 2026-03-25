/**
 * Sharing routes — proxies to central-api for cross-tenant partnership management.
 *
 * Hub-api authenticates the user (Keycloak JWT), then calls central-api
 * using the tenant's M2M API token for inter-service auth.
 */
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";

const CENTRAL_API_URL =
  process.env.CENTRAL_API_URL || "https://api.hubport.cloud";

async function getApiToken(): Promise<string | null> {
  return process.env.HUBPORT_API_TOKEN ?? null;
}

const ConnectBody = Type.Object({
  partnerSubdomain: Type.String({ minLength: 3, maxLength: 63 }),
});
type ConnectBodyType = Static<typeof ConnectBody>;

export async function sharingRoutes(app: FastifyInstance): Promise<void> {
  // List approved sharing partners for this tenant
  app.get(
    "/sharing/partners",
    { preHandler: requirePermission(PERMISSIONS.SHARING_VIEW) },
    async (request, reply) => {
      const token = await getApiToken();
      if (!token) {
        return reply.code(503).send({ error: "Sharing not configured (missing API token)" });
      }

      // Get tenantId from central-api token info
      const infoRes = await fetch(`${CENTRAL_API_URL}/api/v1/tokens/info`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!infoRes.ok) {
        return reply.code(502).send({ error: "Failed to identify tenant" });
      }
      const { tenantId } = (await infoRes.json()) as { tenantId: string };

      const res = await fetch(
        `${CENTRAL_API_URL}/sharing/approved/${tenantId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (!res.ok) {
        const body = await res.text();
        app.log.error(`central-api /sharing/approved failed: ${res.status} ${body}`);
        return reply.code(res.status).send({ error: "Failed to fetch partners" });
      }

      const approvals = await res.json();
      return reply.send({ tenantId, approvals });
    },
  );

  // Connect to a sharing partner by subdomain
  app.post<{ Body: ConnectBodyType }>(
    "/sharing/connect",
    {
      preHandler: requirePermission(PERMISSIONS.SHARING_EDIT),
      schema: { body: ConnectBody },
    },
    async (request, reply) => {
      const token = await getApiToken();
      if (!token) {
        return reply.code(503).send({ error: "Sharing not configured (missing API token)" });
      }

      const { partnerSubdomain } = request.body;

      const res = await fetch(`${CENTRAL_API_URL}/sharing/request`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ partnerSubdomain }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        app.log.error(`central-api /sharing/request failed: ${res.status}`);
        return reply.code(res.status).send(body);
      }

      return reply.code(201).send(await res.json());
    },
  );

  // Disconnect a sharing partner
  app.delete(
    "/sharing/partners/:partnerId",
    { preHandler: requirePermission(PERMISSIONS.SHARING_EDIT) },
    async (request, reply) => {
      const token = await getApiToken();
      if (!token) {
        return reply.code(503).send({ error: "Sharing not configured (missing API token)" });
      }

      const { partnerId } = request.params as { partnerId: string };

      // Get tenantId
      const infoRes = await fetch(`${CENTRAL_API_URL}/api/v1/tokens/info`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!infoRes.ok) {
        return reply.code(502).send({ error: "Failed to identify tenant" });
      }
      const { tenantId } = (await infoRes.json()) as { tenantId: string };

      // Delete in both directions
      const res1 = await fetch(
        `${CENTRAL_API_URL}/sharing/approve/${tenantId}/${partnerId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      );
      const res2 = await fetch(
        `${CENTRAL_API_URL}/sharing/approve/${partnerId}/${tenantId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      );

      if (!res1.ok && !res2.ok) {
        return reply.code(502).send({ error: "Failed to disconnect partner" });
      }

      return reply.code(204).send();
    },
  );
}
