/**
 * Sharing partner routes — proxy to central-api sharing endpoints.
 * Hub-api acts as authenticated gateway between hub-app and central-api.
 *
 * Supports bidirectional consent: request → pending → approve/reject → active.
 * Per-partner visibility RBAC stored locally in SharingVisibility table.
 */
import type { FastifyInstance } from "fastify";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import prisma from "../lib/prisma.js";

const CENTRAL_API_URL = process.env.CENTRAL_API_URL || "";
const TENANT_ID = process.env.HUBPORT_TENANT_ID || "";

const DEFAULT_VISIBILITY: Record<string, string> = {
  territories: "publisher",
  talks: "publisher",
  speakers: "elder",
};

async function getApiToken(): Promise<string | null> {
  return process.env.HUBPORT_API_TOKEN ?? null;
}

async function centralHeaders(): Promise<Record<string, string>> {
  const token = await getApiToken();
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

/** Extract user display name from JWT claims */
function getUserDisplayName(request: { user?: Record<string, unknown> }): string {
  const user = request.user as Record<string, unknown> | undefined;
  if (!user) return "";
  const given = (user.given_name || user.preferred_username || "") as string;
  const family = (user.family_name || "") as string;
  return [given, family].filter(Boolean).join(" ");
}

function getUserEmail(request: { user?: Record<string, unknown> }): string {
  const user = request.user as Record<string, unknown> | undefined;
  return ((user?.email || "") as string);
}

export async function sharingRoutes(app: FastifyInstance) {
  if (!CENTRAL_API_URL || !TENANT_ID) {
    app.log.warn("Sharing disabled — CENTRAL_API_URL or HUBPORT_TENANT_ID not configured");
    return;
  }

  // ─── Partner List ───────────────────────────────────────────────────

  // GET /sharing/partners — list all sharing partnerships (approved + outgoing pending)
  app.get(
    "/sharing/partners",
    { preHandler: [requirePermission(PERMISSIONS.SHARING_VIEW)] },
    async (_request, reply) => {
      const headers = await centralHeaders();
      const res = await fetch(`${CENTRAL_API_URL}/sharing/partners/${TENANT_ID}`, { headers });
      if (!res.ok) return reply.code(res.status).send({ error: "Failed to fetch partners" });

      const approvals = (await res.json()) as Array<{
        id: string;
        requesterId: string;
        approverId: string;
        status: string;
        offeredCategories: string[];
        acceptedCategories: string[] | null;
        requester: { id: string; name: string; subdomain: string };
        approver: { id: string; name: string; subdomain: string };
      }>;

      // Transform to partner-centric view
      const partners = approvals.map((a) => {
        const isRequester = a.requesterId === TENANT_ID;
        const partner = isRequester ? a.approver : a.requester;
        return {
          approvalId: a.id,
          tenantId: partner.id,
          name: partner.name,
          subdomain: partner.subdomain,
          role: isRequester ? "requested" : "approved_by",
          status: a.status,
          offeredCategories: a.offeredCategories,
          acceptedCategories: a.acceptedCategories,
        };
      });

      return reply.send(partners);
    },
  );

  // POST /sharing/partners — request sharing with another tenant
  app.post(
    "/sharing/partners",
    { preHandler: [requirePermission(PERMISSIONS.SHARING_EDIT)] },
    async (request, reply) => {
      const body = request.body as {
        subdomain?: string;
        offeredCategories?: string[];
        message?: string;
      };
      if (!body.subdomain) return reply.code(400).send({ error: "subdomain is required" });

      const headers = await centralHeaders();
      const categories = body.offeredCategories || ["speakers", "territories", "talks"];
      const contactName = getUserDisplayName(request as unknown as { user?: Record<string, unknown> });
      const contactEmail = getUserEmail(request as unknown as { user?: Record<string, unknown> });

      // Discover target tenant via central-api
      const lookupRes = await fetch(
        `${CENTRAL_API_URL}/sharing/resolve/${encodeURIComponent(body.subdomain)}`,
        { headers },
      );
      if (!lookupRes.ok) {
        if (lookupRes.status === 404) return reply.code(404).send({ error: "Congregation not found on hubport.cloud" });
        return reply.code(lookupRes.status).send({ error: "Lookup failed" });
      }

      const target = (await lookupRes.json()) as { id: string; name: string; subdomain: string };
      if (target.id === TENANT_ID) return reply.code(400).send({ error: "Cannot add own congregation" });

      // Create sharing request (PENDING status)
      const requestRes = await fetch(`${CENTRAL_API_URL}/sharing/request`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          partnerSubdomain: body.subdomain,
          offeredCategories: categories,
          contactName,
          contactEmail,
          message: body.message || undefined,
        }),
      });

      if (!requestRes.ok) {
        const err = (await requestRes.json().catch(() => ({}))) as Record<string, unknown>;
        return reply.code(requestRes.status).send(err);
      }

      const result = (await requestRes.json()) as Record<string, unknown>;
      return reply.code(201).send(result);
    },
  );

  // DELETE /sharing/partners/:partnerId — revoke sharing
  app.delete(
    "/sharing/partners/:partnerId",
    { preHandler: [requirePermission(PERMISSIONS.SHARING_EDIT)] },
    async (request, reply) => {
      const { partnerId } = request.params as { partnerId: string };
      const headers = await centralHeaders();

      // Revoke in central-api (handles both directions)
      await fetch(`${CENTRAL_API_URL}/sharing/approve/${TENANT_ID}/${partnerId}`, {
        method: "DELETE",
        headers,
      });

      // Clean up local visibility config
      await prisma.sharingVisibility.deleteMany({ where: { partnerId } });

      return reply.code(204).send();
    },
  );

  // ─── Incoming Requests ──────────────────────────────────────────────

  // GET /sharing/incoming — list pending incoming sharing requests
  app.get(
    "/sharing/incoming",
    { preHandler: [requirePermission(PERMISSIONS.SHARING_VIEW)] },
    async (_request, reply) => {
      const headers = await centralHeaders();
      const res = await fetch(`${CENTRAL_API_URL}/sharing/pending/${TENANT_ID}`, { headers });
      if (!res.ok) return reply.code(res.status).send({ error: "Failed to fetch incoming requests" });

      return reply.send(await res.json());
    },
  );

  // POST /sharing/incoming/:approvalId/approve — approve incoming request
  app.post(
    "/sharing/incoming/:approvalId/approve",
    { preHandler: [requirePermission(PERMISSIONS.SHARING_EDIT)] },
    async (request, reply) => {
      const { approvalId } = request.params as { approvalId: string };
      const body = request.body as {
        acceptedCategories: string[];
        termsVersion: string;
      };

      if (!body.acceptedCategories?.length) {
        return reply.code(400).send({ error: "At least one category must be accepted" });
      }
      if (!body.termsVersion) {
        return reply.code(400).send({ error: "Terms version is required" });
      }

      const headers = await centralHeaders();
      const res = await fetch(`${CENTRAL_API_URL}/sharing/approve`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          approvalId,
          acceptedCategories: body.acceptedCategories,
          termsVersion: body.termsVersion,
        }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        return reply.code(res.status).send(err);
      }

      const approval = (await res.json()) as {
        requesterId: string;
        acceptedCategories: string[];
      };

      // Create default visibility settings for this partner
      const partnerId = approval.requesterId;
      const accepted = approval.acceptedCategories || [];
      for (const category of accepted) {
        const minRole = DEFAULT_VISIBILITY[category] || "elder";
        await prisma.sharingVisibility.upsert({
          where: { partnerId_category: { partnerId, category } },
          update: { minRole },
          create: { partnerId, category, minRole },
        });
      }

      return reply.send(approval);
    },
  );

  // POST /sharing/incoming/:approvalId/reject — reject incoming request
  app.post(
    "/sharing/incoming/:approvalId/reject",
    { preHandler: [requirePermission(PERMISSIONS.SHARING_EDIT)] },
    async (request, reply) => {
      const { approvalId } = request.params as { approvalId: string };
      const body = request.body as { reason?: string };

      const headers = await centralHeaders();
      const res = await fetch(`${CENTRAL_API_URL}/sharing/reject`, {
        method: "POST",
        headers,
        body: JSON.stringify({ approvalId, reason: body.reason }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        return reply.code(res.status).send(err);
      }

      return reply.send(await res.json());
    },
  );

  // ─── Visibility RBAC ────────────────────────────────────────────────

  // GET /sharing/partners/:partnerId/visibility — get visibility settings
  app.get(
    "/sharing/partners/:partnerId/visibility",
    { preHandler: [requirePermission(PERMISSIONS.SHARING_VIEW)] },
    async (request, reply) => {
      const { partnerId } = request.params as { partnerId: string };

      const rows = await prisma.sharingVisibility.findMany({
        where: { partnerId },
      });

      // Fill in defaults for missing categories
      const result: Record<string, string> = {};
      for (const cat of ["speakers", "territories", "talks"]) {
        const row = rows.find((r: { category: string; minRole: string }) => r.category === cat);
        result[cat] = row?.minRole || DEFAULT_VISIBILITY[cat] || "elder";
      }

      return reply.send(result);
    },
  );

  // PUT /sharing/partners/:partnerId/visibility — update visibility settings
  app.put(
    "/sharing/partners/:partnerId/visibility",
    { preHandler: [requirePermission(PERMISSIONS.SHARING_CONFIGURE)] },
    async (request, reply) => {
      const { partnerId } = request.params as { partnerId: string };
      const body = request.body as Record<string, string>;
      const validRoles = ["publisher", "elder", "admin"];
      const validCategories = ["speakers", "territories", "talks"];

      const updates: Array<{ category: string; minRole: string }> = [];
      for (const [cat, role] of Object.entries(body)) {
        if (validCategories.includes(cat) && validRoles.includes(role)) {
          updates.push({ category: cat, minRole: role });
        }
      }

      for (const { category, minRole } of updates) {
        await prisma.sharingVisibility.upsert({
          where: { partnerId_category: { partnerId, category } },
          update: { minRole },
          create: { partnerId, category, minRole },
        });
      }

      return reply.send({ ok: true });
    },
  );

  // ─── Info ───────────────────────────────────────────────────────────

  // GET /sharing/info — return this tenant's sharing identity
  app.get(
    "/sharing/info",
    { preHandler: [requirePermission(PERMISSIONS.SHARING_VIEW)] },
    async (_request, reply) => {
      return reply.send({ tenantId: TENANT_ID });
    },
  );
}
