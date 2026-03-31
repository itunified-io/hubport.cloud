/**
 * Tests for dynamic permission resolution in buildContext().
 * Validates that campaign meeting point assignments grant
 * conductor/assistant permissions dynamically at request time.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PERMISSIONS } from "../permissions.js";

// ─── Mock Prisma ────────────────────────────────────────────────────

const mockPublisherFindUnique = vi.fn();
const mockCampaignMeetingPointFindMany = vi.fn();

vi.mock("../prisma.js", () => ({
  default: {
    publisher: { findUnique: (...args: unknown[]) => mockPublisherFindUnique(...args) },
    campaignMeetingPoint: { findMany: (...args: unknown[]) => mockCampaignMeetingPointFindMany(...args) },
    auditLog: { create: vi.fn() },
  },
}));

// ─── Import after mock ──────────────────────────────────────────────

import { buildContext } from "../policy-engine.js";
import type { FastifyRequest } from "fastify";

// ─── Helpers ────────────────────────────────────────────────────────

function makeRequest(sub: string, roles: string[] = ["publisher"]): FastifyRequest {
  return {
    user: { sub, roles },
  } as unknown as FastifyRequest;
}

function makePublisher(id: string, opts: { congregationRole?: string; appRoles?: unknown[] } = {}) {
  return {
    id,
    keycloakSub: `kc-${id}`,
    congregationRole: opts.congregationRole ?? "publisher",
    privacyAccepted: true,
    appRoles: opts.appRoles ?? [],
  };
}

function makeMeetingPoint(opts: {
  conductorId: string;
  assistantIds?: string[];
  territoryIds?: string[];
  campaignStatus?: string;
}) {
  return {
    id: `mp-${Math.random().toString(36).slice(2, 8)}`,
    campaignId: `campaign-1`,
    conductorId: opts.conductorId,
    assistantIds: opts.assistantIds ?? [],
    territoryIds: opts.territoryIds ?? [],
    createdAt: new Date(),
    campaign: {
      id: `campaign-1`,
      title: "Test Campaign",
      status: opts.campaignStatus ?? "active",
      startDate: new Date(),
      endDate: new Date(),
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("buildContext — dynamic campaign permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("grants conductor permissions when user is conductor on active campaign", async () => {
    const publisherId = "pub-conductor";
    mockPublisherFindUnique.mockResolvedValue(makePublisher(publisherId));
    mockCampaignMeetingPointFindMany.mockResolvedValue([
      makeMeetingPoint({
        conductorId: publisherId,
        territoryIds: ["t1", "t2"],
      }),
    ]);

    const ctx = await buildContext(makeRequest(`kc-${publisherId}`));

    expect(ctx.effectivePermissions).toContain(PERMISSIONS.CAMPAIGNS_CONDUCT);
    expect(ctx.effectivePermissions).toContain(PERMISSIONS.CAMPAIGNS_ASSIST);
    expect(ctx.effectivePermissions).toContain(PERMISSIONS.ASSIGNMENTS_MANAGE);
    expect(ctx.effectivePermissions).toContain(PERMISSIONS.LOCATION_VIEW);
  });

  it("grants assistant-only permissions when user is assistant on active campaign", async () => {
    const publisherId = "pub-assistant";
    mockPublisherFindUnique.mockResolvedValue(makePublisher(publisherId));
    mockCampaignMeetingPointFindMany.mockResolvedValue([
      makeMeetingPoint({
        conductorId: "someone-else",
        assistantIds: [publisherId],
        territoryIds: ["t3"],
      }),
    ]);

    const ctx = await buildContext(makeRequest(`kc-${publisherId}`));

    expect(ctx.effectivePermissions).toContain(PERMISSIONS.CAMPAIGNS_ASSIST);
    expect(ctx.effectivePermissions).toContain(PERMISSIONS.LOCATION_VIEW);
    // Should NOT have conductor-only permissions
    expect(ctx.effectivePermissions).not.toContain(PERMISSIONS.CAMPAIGNS_CONDUCT);
    expect(ctx.effectivePermissions).not.toContain(PERMISSIONS.ASSIGNMENTS_MANAGE);
  });

  it("grants no dynamic permissions when user is neither conductor nor assistant", async () => {
    const publisherId = "pub-none";
    mockPublisherFindUnique.mockResolvedValue(makePublisher(publisherId));
    mockCampaignMeetingPointFindMany.mockResolvedValue([]);

    const ctx = await buildContext(makeRequest(`kc-${publisherId}`));

    // Only static publisher permissions, no campaign dynamic ones
    // (publisher base role does NOT include CAMPAIGNS_CONDUCT, ASSIGNMENTS_MANAGE, LOCATION_VIEW)
    expect(ctx.effectivePermissions).not.toContain(PERMISSIONS.CAMPAIGNS_CONDUCT);
    expect(ctx.effectivePermissions).not.toContain(PERMISSIONS.ASSIGNMENTS_MANAGE);
    expect(ctx.effectivePermissions).not.toContain(PERMISSIONS.LOCATION_VIEW);
  });

  it("includes scopes.territoryIds for territory isolation", async () => {
    const publisherId = "pub-scoped";
    mockPublisherFindUnique.mockResolvedValue(makePublisher(publisherId));
    mockCampaignMeetingPointFindMany.mockResolvedValue([
      makeMeetingPoint({
        conductorId: publisherId,
        territoryIds: ["t1", "t2"],
      }),
      makeMeetingPoint({
        conductorId: publisherId,
        territoryIds: ["t2", "t3"],
      }),
    ]);

    const ctx = await buildContext(makeRequest(`kc-${publisherId}`));

    expect(ctx.scopes).toBeDefined();
    expect(ctx.scopes!.territoryIds).toBeDefined();
    // Should be deduplicated
    expect(ctx.scopes!.territoryIds!.sort()).toEqual(["t1", "t2", "t3"]);
  });

  it("does NOT grant dynamic permissions for non-active campaigns (draft/closed)", async () => {
    const publisherId = "pub-draft";
    mockPublisherFindUnique.mockResolvedValue(makePublisher(publisherId));
    // The query filters by campaign status=active, so non-active campaigns
    // should not appear in the results. The mock returns empty to simulate this.
    mockCampaignMeetingPointFindMany.mockResolvedValue([]);

    const ctx = await buildContext(makeRequest(`kc-${publisherId}`));

    expect(ctx.effectivePermissions).not.toContain(PERMISSIONS.CAMPAIGNS_CONDUCT);
    expect(ctx.effectivePermissions).not.toContain(PERMISSIONS.ASSIGNMENTS_MANAGE);
    expect(ctx.effectivePermissions).not.toContain(PERMISSIONS.LOCATION_VIEW);
    expect(ctx.scopes).toBeUndefined();
  });

  it("merges static and dynamic permissions into union", async () => {
    const publisherId = "pub-union";
    // Publisher base role gives CAMPAIGNS_VIEW, PUBLISHERS_VIEW_MINIMAL, etc.
    mockPublisherFindUnique.mockResolvedValue(makePublisher(publisherId));
    mockCampaignMeetingPointFindMany.mockResolvedValue([
      makeMeetingPoint({
        conductorId: publisherId,
        territoryIds: ["t5"],
      }),
    ]);

    const ctx = await buildContext(makeRequest(`kc-${publisherId}`));

    // Static from publisher base role
    expect(ctx.effectivePermissions).toContain(PERMISSIONS.PUBLISHERS_VIEW_MINIMAL);
    expect(ctx.effectivePermissions).toContain(PERMISSIONS.CAMPAIGNS_VIEW);
    // Dynamic from conductor meeting point
    expect(ctx.effectivePermissions).toContain(PERMISSIONS.CAMPAIGNS_CONDUCT);
    expect(ctx.effectivePermissions).toContain(PERMISSIONS.ASSIGNMENTS_MANAGE);
    expect(ctx.effectivePermissions).toContain(PERMISSIONS.LOCATION_VIEW);
    // No duplicates
    const uniqueCount = new Set(ctx.effectivePermissions).size;
    expect(ctx.effectivePermissions.length).toBe(uniqueCount);
  });

  it("does not set scopes when no meeting points have territoryIds", async () => {
    const publisherId = "pub-no-territories";
    mockPublisherFindUnique.mockResolvedValue(makePublisher(publisherId));
    mockCampaignMeetingPointFindMany.mockResolvedValue([
      makeMeetingPoint({
        conductorId: publisherId,
        territoryIds: [],
      }),
    ]);

    const ctx = await buildContext(makeRequest(`kc-${publisherId}`));

    // Permissions should still be granted
    expect(ctx.effectivePermissions).toContain(PERMISSIONS.CAMPAIGNS_CONDUCT);
    // But no scopes since no territory IDs
    expect(ctx.scopes).toBeUndefined();
  });

  it("verifies Prisma query filters by active campaign status", async () => {
    const publisherId = "pub-query-check";
    mockPublisherFindUnique.mockResolvedValue(makePublisher(publisherId));
    mockCampaignMeetingPointFindMany.mockResolvedValue([]);

    await buildContext(makeRequest(`kc-${publisherId}`));

    expect(mockCampaignMeetingPointFindMany).toHaveBeenCalledWith({
      where: {
        campaign: { status: "active" },
        OR: [
          { conductorId: publisherId },
          { assistantIds: { has: publisherId } },
        ],
      },
    });
  });
});
