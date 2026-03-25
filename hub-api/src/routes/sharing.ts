/**
 * Sharing partner routes — proxy to central-api sharing endpoints.
 * Hub-api acts as authenticated gateway between hub-app and central-api.
 *
 * Fix #223: All central-api calls now include Authorization header
 * with the tenant's M2M API token (apiTokenAuth guard on central-api).
 */
import type { FastifyInstance } from "fastify";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";

const CENTRAL_API_URL = process.env.CENTRAL_API_URL || "";
const TENANT_ID = process.env.HUBPORT_TENANT_ID || "";

async function getApiToken(): Promise<string | null> {
  return process.env.HUBPORT_API_TOKEN ?? null;
}

async function centralHeaders(): Promise<Record<string, string>> {
  const token = await getApiToken();
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

export async function sharingRoutes(app: FastifyInstance) {
  if (!CENTRAL_API_URL || !TENANT_ID) {
    app.log.warn("Sharing disabled — CENTRAL_API_URL or HUBPORT_TENANT_ID not configured");
    return;
  }

  // GET /sharing/partners — list approved sharing partners
  app.get(
    "/sharing/partners",
    { preHandler: [requirePermission(PERMISSIONS.SHARING_VIEW)] },
    async (_request, reply) => {
      const headers = await centralHeaders();
      const res = await fetch(`${CENTRAL_API_URL}/sharing/approved/${TENANT_ID}`, { headers });
      if (!res.ok) return reply.code(res.status).send({ error: "Failed to fetch partners" });

      const approvals = await res.json() as Array<{
        id: string;
        requesterId: string;
        approverId: string;
        approved: boolean;
        requester: { id: string; name: string; subdomain: string };
        approver: { id: string; name: string; subdomain: string };
      }>;

      // Transform to partner-centric view (show the OTHER tenant, not ourselves)
      const partners = approvals.map((a) => {
        const isRequester = a.requesterId === TENANT_ID;
        const partner = isRequester ? a.approver : a.requester;
        return {
          approvalId: a.id,
          tenantId: partner.id,
          name: partner.name,
          subdomain: partner.subdomain,
          role: isRequester ? "requested" : "approved_by",
          approved: a.approved,
        };
      });

      return reply.send(partners);
    },
  );

  // POST /sharing/partners — request sharing with another tenant (by subdomain)
  app.post(
    "/sharing/partners",
    { preHandler: [requirePermission(PERMISSIONS.SHARING_EDIT)] },
    async (request, reply) => {
      const { subdomain } = request.body as { subdomain?: string };
      if (!subdomain) return reply.code(400).send({ error: "subdomain is required" });

      const headers = await centralHeaders();

      // Discover target tenant via central-api
      const lookupRes = await fetch(
        `${CENTRAL_API_URL}/sharing/resolve/${encodeURIComponent(subdomain)}`,
        { headers },
      );
      if (!lookupRes.ok) {
        if (lookupRes.status === 404) return reply.code(404).send({ error: "Congregation not found on hubport.cloud" });
        return reply.code(lookupRes.status).send({ error: "Lookup failed" });
      }

      const target = await lookupRes.json() as { id: string; name: string; subdomain: string };
      if (target.id === TENANT_ID) return reply.code(400).send({ error: "Cannot add own congregation" });

      // Create sharing request
      const approveRes = await fetch(`${CENTRAL_API_URL}/sharing/approve`, {
        method: "POST",
        headers,
        body: JSON.stringify({ requesterId: TENANT_ID, approverId: target.id }),
      });

      if (!approveRes.ok) return reply.code(approveRes.status).send({ error: "Failed to create sharing request" });

      const approval = await approveRes.json() as Record<string, unknown>;
      return reply.code(201).send({
        ...approval,
        partner: { id: target.id, name: target.name, subdomain: target.subdomain },
      });
    },
  );

  // DELETE /sharing/partners/:partnerId — revoke sharing
  app.delete(
    "/sharing/partners/:partnerId",
    { preHandler: [requirePermission(PERMISSIONS.SHARING_EDIT)] },
    async (request, reply) => {
      const { partnerId } = request.params as { partnerId: string };
      const headers = await centralHeaders();

      // Delete both directions
      await fetch(`${CENTRAL_API_URL}/sharing/approve/${TENANT_ID}/${partnerId}`, { method: "DELETE", headers });
      await fetch(`${CENTRAL_API_URL}/sharing/approve/${partnerId}/${TENANT_ID}`, { method: "DELETE", headers });

      return reply.code(204).send();
    },
  );

  // GET /sharing/info — return this tenant's sharing identity
  app.get(
    "/sharing/info",
    { preHandler: [requirePermission(PERMISSIONS.SHARING_VIEW)] },
    async (_request, reply) => {
      return reply.send({ tenantId: TENANT_ID });
    },
  );
}
