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

/** Default: all categories enabled. "disabled" = not shared with partner. */
const DEFAULT_VISIBILITY: Record<string, string> = {
  territories: "enabled",
  speakers: "enabled",
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

      // Valid sharing categories (strip legacy "talks" from old records)
      const VALID_CATS = ["speakers", "territories"];

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
          offeredCategories: a.offeredCategories.filter((c: string) => VALID_CATS.includes(c)),
          acceptedCategories: a.acceptedCategories?.filter((c: string) => VALID_CATS.includes(c)) ?? null,
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
      const categories = body.offeredCategories || ["speakers", "territories"];
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

  // ─── Visibility Toggles ─────────────────────────────────────────────
  //
  // Per-partner toggles control WHAT is shared. WHO sees shared data is
  // determined by existing AppRole permissions:
  //   territories → users with territories.view (service overseer, territory servant)
  //   speakers    → users with speakers.view (public talk planner)
  //   publishers without these permissions see nothing from partners.

  // GET /sharing/partners/:partnerId/visibility — get per-category toggles
  app.get(
    "/sharing/partners/:partnerId/visibility",
    { preHandler: [requirePermission(PERMISSIONS.SHARING_VIEW)] },
    async (request, reply) => {
      const { partnerId } = request.params as { partnerId: string };

      const rows = await prisma.sharingVisibility.findMany({
        where: { partnerId },
      });

      // Default: all categories enabled
      const result: Record<string, string> = {};
      for (const cat of ["speakers", "territories"]) {
        const row = rows.find((r: { category: string; minRole: string }) => r.category === cat);
        result[cat] = row?.minRole === "disabled" ? "disabled" : "enabled";
      }

      return reply.send(result);
    },
  );

  // PUT /sharing/partners/:partnerId/visibility — toggle categories on/off
  app.put(
    "/sharing/partners/:partnerId/visibility",
    { preHandler: [requirePermission(PERMISSIONS.SHARING_CONFIGURE)] },
    async (request, reply) => {
      const { partnerId } = request.params as { partnerId: string };
      const body = request.body as Record<string, string>;
      const validValues = ["enabled", "disabled"];
      const validCategories = ["speakers", "territories"];

      for (const [cat, value] of Object.entries(body)) {
        if (validCategories.includes(cat) && validValues.includes(value)) {
          await prisma.sharingVisibility.upsert({
            where: { partnerId_category: { partnerId, category: cat } },
            update: { minRole: value },
            create: { partnerId, category: cat, minRole: value },
          });
        }
      }

      return reply.send({ ok: true });
    },
  );

  // ─── Shared Speakers ──────────────────────────────────────────────

  // POST /sharing/speakers/sync — push visiting speakers to central-api
  // Only speakers with privilege:publicTalkVisiting are shared.
  app.post(
    "/sharing/speakers/sync",
    { preHandler: [requirePermission(PERMISSIONS.SPEAKERS_VIEW)] },
    async (_request, reply) => {
      const cHeaders = await centralHeaders();

      // Find all publishers who have privilege:publicTalkVisiting via their AppRoles
      const visitingRoles = await prisma.appRole.findMany({
        where: {
          members: { some: {} },
        },
        select: { id: true, permissions: true, members: { select: { publisherId: true } } },
      });

      // Collect publisherIds that have privilege:publicTalkVisiting
      const visitingPublisherIds = new Set<string>();
      for (const role of visitingRoles) {
        const perms = role.permissions as string[];
        if (perms.includes("privilege:publicTalkVisiting") || perms.includes("*")) {
          for (const m of role.members) {
            visitingPublisherIds.add(m.publisherId);
          }
        }
      }

      if (visitingPublisherIds.size === 0) {
        // Push empty list — no visiting speakers
        await fetch(`${CENTRAL_API_URL}/sharing/speakers/${TENANT_ID}`, {
          method: "PUT",
          headers: cHeaders,
          body: JSON.stringify([]),
        });
        return reply.send({ synced: 0 });
      }

      // Get speakers linked to these publishers (with non-muted talks)
      const speakers = await prisma.speaker.findMany({
        where: {
          publisherId: { in: Array.from(visitingPublisherIds) },
          status: "active",
        },
        include: {
          talks: {
            where: { muted: false },
            include: { publicTalk: { select: { talkNumber: true, title: true } } },
          },
        },
      });

      // Build shared data (respect privacy preferences)
      const sharedData = speakers.map((s) => ({
        speakerId: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        phone: s.sharePhone ? s.phone : null,
        email: s.shareEmail ? s.email : null,
        shareAvailability: s.shareAvailability,
        monthlyInviteCap: s.shareAvailability ? s.monthlyInviteCap : null,
        talks: s.talks.map((t) => ({
          talkNumber: t.publicTalk.talkNumber,
          title: t.publicTalk.title,
        })),
      }));

      // Push to central-api
      await fetch(`${CENTRAL_API_URL}/sharing/speakers/${TENANT_ID}`, {
        method: "PUT",
        headers: cHeaders,
        body: JSON.stringify(sharedData),
      });

      return reply.send({ synced: sharedData.length });
    },
  );

  // GET /sharing/speakers/:partnerId — fetch shared speakers from a partner
  app.get(
    "/sharing/speakers/:partnerId",
    { preHandler: [requirePermission(PERMISSIONS.SPEAKERS_VIEW)] },
    async (request, reply) => {
      const { partnerId } = request.params as { partnerId: string };
      const cHeaders = await centralHeaders();

      // Check local visibility: is "speakers" enabled for this partner?
      const vis = await prisma.sharingVisibility.findUnique({
        where: { partnerId_category: { partnerId, category: "speakers" } },
      });
      if (vis?.minRole === "disabled") {
        return reply.send([]);
      }

      // Fetch from central-api
      const res = await fetch(
        `${CENTRAL_API_URL}/sharing/speakers?tenantIds=${partnerId}`,
        { headers: cHeaders },
      );
      if (!res.ok) return reply.code(res.status).send({ error: "Failed to fetch partner speakers" });

      const shared = (await res.json()) as Array<{ tenantId: string; data: unknown }>;
      if (shared.length === 0) return reply.send([]);

      // Return the data payload (array of speakers)
      const partnerData = shared[0];
      return reply.send(partnerData?.data ?? []);
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
