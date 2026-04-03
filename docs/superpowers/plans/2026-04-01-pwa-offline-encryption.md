# PWA Offline Mode, Encryption & Device Management — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add encrypted offline data storage, delta-based sync, device management (max 3), controlled PWA updates, and Web Push notifications to the hubport.cloud PWA.

**Architecture:** Dexie.js wraps IndexedDB with AES-256-GCM encryption middleware (key derived from OIDC `sub` + device salt via PBKDF2). Delta sync engine pulls/pushes changes via new `/sync/*` endpoints. Device registry enforces max 3 devices per user with admin revoke. Service worker update flow switched from auto to prompt-based. Web Push via VAPID for iOS 16.4+.

**Tech Stack:** Dexie.js v4, Web Crypto API (SubtleCrypto), Fastify + Prisma (backend), web-push (VAPID), vite-plugin-pwa (prompt mode)

**Spec:** `docs/superpowers/specs/2026-04-01-pwa-offline-encryption-design.md`

**Spec deviations:**
- Column `version` renamed to `syncVersion` to avoid collision with existing `TerritoryBoundaryVersion.version`
- Push route paths use `/push/*` prefix (spec had `/devices/push-subscription`) for cleaner separation

---

## Chunk 1: Backend Foundation (Prisma schema + version middleware + device routes)

### Task 1: Add version/deletedAt columns to syncable Prisma models

**Files:**
- Modify: `hub-api/prisma/schema.prisma`

- [ ] **Step 1: Add `version` and `deletedAt` to Territory model**

In `hub-api/prisma/schema.prisma`, add to the `Territory` model after `updatedAt`:
```prisma
  syncVersion   Int       @default(0)
  deletedAt     DateTime?
```
Note: named `syncVersion` to avoid collision with `TerritoryBoundaryVersion.version`.

- [ ] **Step 2: Add `version` and `deletedAt` to Address model**

```prisma
  syncVersion   Int       @default(0)
  deletedAt     DateTime?
```

- [ ] **Step 3: Add `version` and `deletedAt` to AddressVisit model**

```prisma
  syncVersion   Int       @default(0)
  deletedAt     DateTime?
```

- [ ] **Step 4: Add `version` and `deletedAt` to TerritoryAssignment model**

```prisma
  syncVersion   Int       @default(0)
  deletedAt     DateTime?
```

- [ ] **Step 5: Add `version` and `deletedAt` to Publisher model**

```prisma
  syncVersion   Int       @default(0)
  deletedAt     DateTime?
```

- [ ] **Step 6: Add `version` and `deletedAt` to FieldServiceMeetingPoint model**

```prisma
  syncVersion   Int       @default(0)
  deletedAt     DateTime?
```

- [ ] **Step 7: Add `version` and `deletedAt` to CampaignMeetingPoint model**

```prisma
  syncVersion   Int       @default(0)
  deletedAt     DateTime?
```

- [ ] **Step 8: Add `version` and `deletedAt` to ServiceGroupMeeting model**

```prisma
  syncVersion   Int       @default(0)
  deletedAt     DateTime?
```

- [ ] **Step 9: Add `version` and `deletedAt` to TerritoryShare model**

```prisma
  syncVersion   Int       @default(0)
  deletedAt     DateTime?
```

- [ ] **Step 10: Add Device and PushSubscription models**

Add at end of schema:
```prisma
model Device {
  id            String    @id @default(uuid())
  tenantId      String
  userId        String
  deviceUuid    String
  userAgent     String
  platform      String
  screenSize    String
  displayName   String
  encSalt       String
  status        String    @default("active")
  revokedAt     DateTime?
  revokedBy     String?
  revokeReason  String?
  lastSyncAt    DateTime?
  lastIp        String?
  registeredAt  DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  pushSubscription PushSubscription?

  @@unique([userId, deviceUuid])
  @@index([tenantId, userId])
}

model PushSubscription {
  id          String   @id @default(uuid())
  tenantId    String
  deviceId    String   @unique
  endpoint    String
  p256dh      String
  auth        String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  device      Device   @relation(fields: [deviceId], references: [id], onDelete: Cascade)

  @@index([tenantId])
}
```

- [ ] **Step 11: Generate Prisma client**

Run: `cd hub-api && npx prisma generate`
Expected: `✔ Generated Prisma Client`

- [ ] **Step 12: Verify build**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-api`
Expected: Build succeeds with no errors.

- [ ] **Step 13: Commit**

```bash
git add hub-api/prisma/schema.prisma
git commit -m "feat: add syncVersion/deletedAt to syncable models + Device/PushSubscription"
```

---

### Task 2: Version auto-increment Prisma middleware

**Files:**
- Create: `hub-api/src/middleware/version-middleware.ts`
- Create: `hub-api/src/middleware/__tests__/version-middleware.test.ts`
- Modify: `hub-api/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `hub-api/src/middleware/__tests__/version-middleware.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { applySyncVersionMiddleware } from "../version-middleware.js";

describe("version-middleware", () => {
  const mockPrisma = {
    $use: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers middleware via $use", () => {
    applySyncVersionMiddleware(mockPrisma as any);
    expect(mockPrisma.$use).toHaveBeenCalledTimes(1);
  });

  it("increments syncVersion on update for syncable models", async () => {
    applySyncVersionMiddleware(mockPrisma as any);
    const middleware = mockPrisma.$use.mock.calls[0][0];

    const params = {
      model: "Address",
      action: "update",
      args: { data: { street: "New Street" } },
    };
    const next = vi.fn().mockResolvedValue({ id: "1", syncVersion: 1 });

    await middleware(params, next);

    expect(params.args.data.syncVersion).toEqual({ increment: 1 });
    expect(next).toHaveBeenCalledWith(params);
  });

  it("does NOT increment syncVersion for non-syncable models", async () => {
    applySyncVersionMiddleware(mockPrisma as any);
    const middleware = mockPrisma.$use.mock.calls[0][0];

    const params = {
      model: "InviteCode",
      action: "update",
      args: { data: { code: "abc" } },
    };
    const next = vi.fn().mockResolvedValue({ id: "1" });

    await middleware(params, next);

    expect(params.args.data.syncVersion).toBeUndefined();
    expect(next).toHaveBeenCalledWith(params);
  });

  it("does NOT increment on create or delete", async () => {
    applySyncVersionMiddleware(mockPrisma as any);
    const middleware = mockPrisma.$use.mock.calls[0][0];

    const createParams = {
      model: "Address",
      action: "create",
      args: { data: { street: "New" } },
    };
    const next = vi.fn().mockResolvedValue({ id: "1" });

    await middleware(createParams, next);

    expect(createParams.args.data.syncVersion).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd hub-api && npx vitest run src/middleware/__tests__/version-middleware.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Create `hub-api/src/middleware/version-middleware.ts`:
```typescript
import type { PrismaClient } from "@prisma/client";

const SYNCABLE_MODELS = new Set([
  "Territory",
  "Address",
  "AddressVisit",
  "TerritoryAssignment",
  "Publisher",
  "FieldServiceMeetingPoint",
  "CampaignMeetingPoint",
  "ServiceGroupMeeting",
  "TerritoryShare",
]);

export function applySyncVersionMiddleware(prisma: PrismaClient): void {
  prisma.$use(async (params, next) => {
    if (
      params.model &&
      SYNCABLE_MODELS.has(params.model) &&
      (params.action === "update" || params.action === "updateMany")
    ) {
      params.args.data = params.args.data ?? {};
      params.args.data.syncVersion = { increment: 1 };
    }
    return next(params);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd hub-api && npx vitest run src/middleware/__tests__/version-middleware.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Register middleware in index.ts**

In `hub-api/src/index.ts`, add import and call after `prisma` is available but before route registration:
```typescript
import { applySyncVersionMiddleware } from "./middleware/version-middleware.js";
```
Call: `applySyncVersionMiddleware(prisma);` before `await app.register(...)` calls.

- [ ] **Step 6: Verify build**

Run: `npm run build --workspace=hub-api`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add hub-api/src/middleware/version-middleware.ts hub-api/src/middleware/__tests__/version-middleware.test.ts hub-api/src/index.ts
git commit -m "feat: add syncVersion auto-increment Prisma middleware"
```

---

### Task 3: Device routes — register, list, revoke

**Files:**
- Create: `hub-api/src/routes/devices.ts`
- Create: `hub-api/src/routes/__tests__/devices.test.ts`
- Modify: `hub-api/src/lib/permissions.ts` (add device permissions)
- Modify: `hub-api/src/index.ts` (register route)

- [ ] **Step 1: Add device permissions**

In `hub-api/src/lib/permissions.ts`, add:
```typescript
  DEVICES_VIEW: "app:devices.view",
  DEVICES_MANAGE: "app:devices.manage",
  ADMIN_DEVICES_VIEW: "app:admin.devices.view",
  ADMIN_DEVICES_MANAGE: "app:admin.devices.manage",
```

- [ ] **Step 1b: Add device permissions to role maps**

In `hub-api/src/lib/permissions.ts`, add `PERMISSIONS.DEVICES_VIEW` and `PERMISSIONS.DEVICES_MANAGE` to the base role arrays so that authenticated users can register devices. Add `PERMISSIONS.ADMIN_DEVICES_VIEW` and `PERMISSIONS.ADMIN_DEVICES_MANAGE` to the `admin`/`coordinator` roles. If using wildcard for admin, it already covers these — verify.

- [ ] **Step 2: Write the failing test for device registration**

Create `hub-api/src/routes/__tests__/devices.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { deviceRoutes } from "../devices.js";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    device: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("../../lib/prisma.js", () => ({ default: mockPrisma }));
vi.mock("../../lib/rbac.js", () => ({
  requirePermission: () => async () => {},
  requireAnyPermission: () => async () => {},
}));

describe("Device routes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.addHook("onRequest", async (request: any) => {
      request.user = { sub: "user-123", email: "test@test.com" };
      request.policyCtx = { tenantId: "tenant-1" };
    });
    await app.register(deviceRoutes);
    await app.ready();
  });

  describe("POST /devices/register", () => {
    it("creates a device when under limit", async () => {
      mockPrisma.device.count.mockResolvedValue(1);
      mockPrisma.device.create.mockResolvedValue({
        id: "dev-1",
        deviceUuid: "uuid-1",
        displayName: "iPhone · Safari",
        encSalt: "random-salt",
        status: "active",
      });

      const res = await app.inject({
        method: "POST",
        url: "/devices/register",
        payload: {
          deviceUuid: "uuid-1",
          userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)",
          platform: "iPhone",
          screenSize: "390x844",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.encSalt).toBeDefined();
    });

    it("returns 409 when at device limit", async () => {
      mockPrisma.device.count.mockResolvedValue(3);
      mockPrisma.device.findMany.mockResolvedValue([
        { id: "d1", displayName: "iPhone", status: "active" },
        { id: "d2", displayName: "iPad", status: "active" },
        { id: "d3", displayName: "Mac", status: "active" },
      ]);

      const res = await app.inject({
        method: "POST",
        url: "/devices/register",
        payload: {
          deviceUuid: "uuid-new",
          userAgent: "Mozilla/5.0",
          platform: "Android",
          screenSize: "412x915",
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.devices).toHaveLength(3);
    });
  });

  describe("GET /devices/me", () => {
    it("returns device status", async () => {
      mockPrisma.device.findFirst.mockResolvedValue({
        id: "dev-1",
        status: "active",
        displayName: "iPhone · Safari",
      });

      const res = await app.inject({
        method: "GET",
        url: "/devices/me?deviceUuid=uuid-1",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBe("active");
    });

    it("returns revoked status with reason", async () => {
      mockPrisma.device.findFirst.mockResolvedValue({
        id: "dev-1",
        status: "revoked",
        revokeReason: "Lost device",
        displayName: "iPad · Safari",
      });

      const res = await app.inject({
        method: "GET",
        url: "/devices/me?deviceUuid=uuid-1",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBe("revoked");
      expect(body.revokeReason).toBe("Lost device");
    });
  });

  describe("DELETE /devices/:id", () => {
    it("deletes own device", async () => {
      mockPrisma.device.findUnique.mockResolvedValue({
        id: "dev-1",
        userId: "user-123",
      });
      mockPrisma.device.delete.mockResolvedValue({ id: "dev-1" });

      const res = await app.inject({
        method: "DELETE",
        url: "/devices/dev-1",
      });

      expect(res.statusCode).toBe(204);
    });

    it("rejects deleting another users device", async () => {
      mockPrisma.device.findUnique.mockResolvedValue({
        id: "dev-1",
        userId: "other-user",
      });

      const res = await app.inject({
        method: "DELETE",
        url: "/devices/dev-1",
      });

      expect(res.statusCode).toBe(403);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd hub-api && npx vitest run src/routes/__tests__/devices.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Write device routes implementation**

Create `hub-api/src/routes/devices.ts`:
```typescript
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { randomBytes } from "crypto";
import prisma from "../lib/prisma.js";
import { requirePermission, requireAnyPermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";

const MAX_DEVICES_PER_USER = 3;

const RegisterBody = Type.Object({
  deviceUuid: Type.String({ minLength: 1 }),
  userAgent: Type.String(),
  platform: Type.String(),
  screenSize: Type.String(),
});
type RegisterBodyType = Static<typeof RegisterBody>;

const DeviceUuidQuery = Type.Object({
  deviceUuid: Type.String({ minLength: 1 }),
});
type DeviceUuidQueryType = Static<typeof DeviceUuidQuery>;

const IdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});
type IdParamsType = Static<typeof IdParams>;

const RevokeBody = Type.Object({
  reason: Type.Optional(Type.String()),
});
type RevokeBodyType = Static<typeof RevokeBody>;

function parseDisplayName(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  let device = "Unknown";
  let browser = "Browser";

  if (ua.includes("iphone")) device = "iPhone";
  else if (ua.includes("ipad")) device = "iPad";
  else if (ua.includes("android")) device = "Android";
  else if (ua.includes("macintosh") || ua.includes("mac os")) device = "macOS";
  else if (ua.includes("windows")) device = "Windows";
  else if (ua.includes("linux")) device = "Linux";

  if (ua.includes("chrome") && !ua.includes("edg")) browser = "Chrome";
  else if (ua.includes("safari") && !ua.includes("chrome")) browser = "Safari";
  else if (ua.includes("firefox")) browser = "Firefox";
  else if (ua.includes("edg")) browser = "Edge";

  return `${device} · ${browser}`;
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  // POST /devices/register — register new device
  app.post<{ Body: RegisterBodyType }>(
    "/devices/register",
    {
      preHandler: requirePermission(PERMISSIONS.DEVICES_VIEW),
      schema: { body: RegisterBody },
    },
    async (request, reply) => {
      const userId = request.user.sub;
      const tenantId = (request as any).policyCtx?.tenantId ?? "";
      const { deviceUuid, userAgent, platform, screenSize } = request.body;

      // Check existing device (re-registration)
      const existing = await prisma.device.findFirst({
        where: { userId, deviceUuid, status: "active" },
      });
      if (existing) {
        await prisma.device.update({
          where: { id: existing.id },
          data: { lastSyncAt: new Date(), lastIp: request.ip, userAgent, platform, screenSize },
        });
        return reply.status(200).send({
          id: existing.id,
          deviceUuid: existing.deviceUuid,
          displayName: existing.displayName,
          encSalt: existing.encSalt,
          status: existing.status,
        });
      }

      // Check device limit
      const activeCount = await prisma.device.count({
        where: { userId, status: "active" },
      });
      if (activeCount >= MAX_DEVICES_PER_USER) {
        const devices = await prisma.device.findMany({
          where: { userId, status: "active" },
          select: { id: true, displayName: true, screenSize: true, lastSyncAt: true, registeredAt: true, status: true },
        });
        return reply.status(409).send({
          error: "device_limit_reached",
          message: `Maximum ${MAX_DEVICES_PER_USER} devices allowed`,
          devices,
        });
      }

      const encSalt = randomBytes(32).toString("base64");
      const displayName = parseDisplayName(userAgent);

      const device = await prisma.device.create({
        data: {
          tenantId,
          userId,
          deviceUuid,
          userAgent,
          platform,
          screenSize,
          displayName,
          encSalt,
          lastIp: request.ip,
        },
      });

      return reply.status(201).send({
        id: device.id,
        deviceUuid: device.deviceUuid,
        displayName: device.displayName,
        encSalt: device.encSalt,
        status: device.status,
      });
    }
  );

  // GET /devices/me — check this device status
  app.get<{ Querystring: DeviceUuidQueryType }>(
    "/devices/me",
    {
      preHandler: requirePermission(PERMISSIONS.DEVICES_VIEW),
      schema: { querystring: DeviceUuidQuery },
    },
    async (request, reply) => {
      const device = await prisma.device.findFirst({
        where: { userId: request.user.sub, deviceUuid: request.query.deviceUuid },
        select: { id: true, status: true, displayName: true, revokeReason: true, revokedAt: true },
      });
      if (!device) return reply.status(404).send({ error: "device_not_found" });
      return reply.send(device);
    }
  );

  // GET /devices — list own devices
  app.get(
    "/devices",
    { preHandler: requirePermission(PERMISSIONS.DEVICES_VIEW) },
    async (request, reply) => {
      const devices = await prisma.device.findMany({
        where: { userId: request.user.sub },
        select: {
          id: true, deviceUuid: true, displayName: true, platform: true,
          screenSize: true, status: true, lastSyncAt: true, registeredAt: true,
          revokedAt: true, revokeReason: true,
        },
        orderBy: { registeredAt: "desc" },
      });
      return reply.send(devices);
    }
  );

  // DELETE /devices/:id — remove own device
  app.delete<{ Params: IdParamsType }>(
    "/devices/:id",
    {
      preHandler: requirePermission(PERMISSIONS.DEVICES_VIEW),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const device = await prisma.device.findUnique({ where: { id: request.params.id } });
      if (!device) return reply.status(404).send({ error: "device_not_found" });
      if (device.userId !== request.user.sub) {
        return reply.status(403).send({ error: "not_your_device" });
      }
      await prisma.device.delete({ where: { id: device.id } });
      return reply.status(204).send();
    }
  );

  // GET /devices/encryption-salt — get per-device salt
  app.get<{ Querystring: DeviceUuidQueryType }>(
    "/devices/encryption-salt",
    {
      preHandler: requirePermission(PERMISSIONS.DEVICES_VIEW),
      schema: { querystring: DeviceUuidQuery },
    },
    async (request, reply) => {
      const device = await prisma.device.findFirst({
        where: { userId: request.user.sub, deviceUuid: request.query.deviceUuid, status: "active" },
        select: { encSalt: true },
      });
      if (!device) return reply.status(404).send({ error: "device_not_found" });
      return reply.send({ salt: device.encSalt });
    }
  );

  // GET /admin/devices — admin list all devices
  app.get(
    "/admin/devices",
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DEVICES_VIEW) },
    async (request, reply) => {
      const tenantId = (request as any).policyCtx?.tenantId ?? "";
      const devices = await prisma.device.findMany({
        where: { tenantId },
        select: {
          id: true, userId: true, displayName: true, platform: true,
          screenSize: true, status: true, lastSyncAt: true, registeredAt: true,
          revokedAt: true, revokeReason: true, revokedBy: true,
        },
        orderBy: [{ userId: "asc" }, { registeredAt: "desc" }],
      });
      return reply.send(devices);
    }
  );

  // DELETE /admin/devices/:id — admin revoke device
  app.delete<{ Params: IdParamsType; Body: RevokeBodyType }>(
    "/admin/devices/:id",
    {
      preHandler: requirePermission(PERMISSIONS.ADMIN_DEVICES_MANAGE),
      schema: { params: IdParams, body: RevokeBody },
    },
    async (request, reply) => {
      const device = await prisma.device.findUnique({ where: { id: request.params.id } });
      if (!device) return reply.status(404).send({ error: "device_not_found" });

      await prisma.device.update({
        where: { id: device.id },
        data: {
          status: "revoked",
          encSalt: "",
          revokedAt: new Date(),
          revokedBy: request.user.sub,
          revokeReason: request.body.reason ?? null,
        },
      });

      return reply.status(204).send();
    }
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd hub-api && npx vitest run src/routes/__tests__/devices.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Register device routes in index.ts**

In `hub-api/src/index.ts`, add:
```typescript
import { deviceRoutes } from "./routes/devices.js";
```
And register: `await app.register(deviceRoutes);`

- [ ] **Step 7: Verify build**

Run: `npm run build --workspace=hub-api`
Expected: Build succeeds

- [ ] **Step 8: Commit**

```bash
git add hub-api/src/routes/devices.ts hub-api/src/routes/__tests__/devices.test.ts hub-api/src/lib/permissions.ts hub-api/src/index.ts
git commit -m "feat: add device registration, listing, and admin revocation endpoints"
```

---

### Task 4: Sync routes — pull, push, status

**Files:**
- Create: `hub-api/src/routes/sync.ts`
- Create: `hub-api/src/routes/__tests__/sync.test.ts`
- Modify: `hub-api/src/index.ts`

- [ ] **Step 1: Write the failing test for sync pull**

Create `hub-api/src/routes/__tests__/sync.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { syncRoutes } from "../sync.js";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    territory: { findMany: vi.fn(), count: vi.fn() },
    address: { findMany: vi.fn(), count: vi.fn() },
    addressVisit: { findMany: vi.fn(), count: vi.fn() },
    territoryAssignment: { findMany: vi.fn(), count: vi.fn() },
    publisher: { findMany: vi.fn(), count: vi.fn() },
    fieldServiceMeetingPoint: { findMany: vi.fn(), count: vi.fn() },
    campaignMeetingPoint: { findMany: vi.fn(), count: vi.fn() },
    serviceGroupMeeting: { findMany: vi.fn(), count: vi.fn() },
    territoryShare: { findMany: vi.fn(), count: vi.fn() },
    device: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("../../lib/prisma.js", () => ({ default: mockPrisma }));
vi.mock("../../lib/rbac.js", () => ({
  requirePermission: () => async () => {},
}));

describe("Sync routes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.addHook("onRequest", async (request: any) => {
      request.user = { sub: "user-123" };
      request.policyCtx = { tenantId: "tenant-1" };
    });
    await app.register(syncRoutes);
    await app.ready();
  });

  describe("GET /sync/pull", () => {
    it("returns delta since timestamp", async () => {
      // All models return empty arrays for simplicity
      for (const model of Object.values(mockPrisma)) {
        if ("findMany" in model) model.findMany.mockResolvedValue([]);
        if ("count" in model) model.count.mockResolvedValue(0);
      }

      const res = await app.inject({
        method: "GET",
        url: "/sync/pull?since=2026-04-01T00:00:00Z",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.tables).toBeDefined();
      expect(body.serverTime).toBeDefined();
      expect(body.hasMore).toBe(false);
    });

    it("returns full dump without since param", async () => {
      for (const model of Object.values(mockPrisma)) {
        if ("findMany" in model) model.findMany.mockResolvedValue([]);
        if ("count" in model) model.count.mockResolvedValue(0);
      }

      const res = await app.inject({
        method: "GET",
        url: "/sync/pull",
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe("GET /sync/status", () => {
    it("returns sync metadata", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/sync/status",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.minClientVersion).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd hub-api && npx vitest run src/routes/__tests__/sync.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write sync routes implementation**

Create `hub-api/src/routes/sync.ts`:
```typescript
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";

const PAGE_SIZE = 500;

// Syncable table config: prisma delegate name + fields to include
const SYNCABLE_TABLES = [
  { name: "territories", delegate: "territory" },
  { name: "addresses", delegate: "address" },
  { name: "visits", delegate: "addressVisit" },
  { name: "assignments", delegate: "territoryAssignment" },
  { name: "publishers", delegate: "publisher" },
  { name: "meetingPoints", delegate: "fieldServiceMeetingPoint" },
  { name: "campaignMeetingPoints", delegate: "campaignMeetingPoint" },
  { name: "meetings", delegate: "serviceGroupMeeting" },
  { name: "territoryShares", delegate: "territoryShare" },
] as const;

const PullQuery = Type.Object({
  since: Type.Optional(Type.String()),
  cursor: Type.Optional(Type.String()),
});
type PullQueryType = Static<typeof PullQuery>;

const PushBody = Type.Object({
  deviceId: Type.String(),
  changes: Type.Array(Type.Object({
    table: Type.String(),
    recordId: Type.String(),
    operation: Type.Union([
      Type.Literal("create"),
      Type.Literal("update"),
      Type.Literal("delete"),
    ]),
    version: Type.Number(),
    payload: Type.Any(),
    force: Type.Optional(Type.Boolean()),
  })),
});
type PushBodyType = Static<typeof PushBody>;

interface CursorState {
  tableIndex: number;
  offset: number;
}

function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

function decodeCursor(cursor: string): CursorState {
  return JSON.parse(Buffer.from(cursor, "base64url").toString());
}

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  // GET /sync/pull — delta sync
  app.get<{ Querystring: PullQueryType }>(
    "/sync/pull",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_VIEW),
      schema: { querystring: PullQuery },
    },
    async (request, reply) => {
      const tenantId = (request as any).policyCtx?.tenantId ?? process.env.HUBPORT_TENANT_ID ?? "";
      const sinceStr = request.query.since;
      const since = sinceStr ? new Date(sinceStr) : new Date(0);
      const cursorState: CursorState = request.query.cursor
        ? decodeCursor(request.query.cursor)
        : { tableIndex: 0, offset: 0 };

      const tables: Record<string, { upserts: unknown[]; deletes: string[] }> = {};
      let totalRecords = 0;
      let hasMore = false;

      for (let i = cursorState.tableIndex; i < SYNCABLE_TABLES.length; i++) {
        const tableConfig = SYNCABLE_TABLES[i];
        const delegate = (prisma as any)[tableConfig.delegate];
        const offset = i === cursorState.tableIndex ? cursorState.offset : 0;

        // Tenant-scoped where clause (models with tenantId get filtered)
        const where: Record<string, unknown> = { updatedAt: { gt: since } };
        // Add tenantId filter for models that have it (most do via Prisma schema)
        if (tenantId) where.tenantId = tenantId;

        const records = await delegate.findMany({
          where,
          orderBy: { updatedAt: "asc" },
          skip: offset,
          take: PAGE_SIZE - totalRecords,
        });

        const upserts = records.filter((r: any) => !r.deletedAt);
        const deletes = records.filter((r: any) => r.deletedAt).map((r: any) => r.id);

        if (upserts.length > 0 || deletes.length > 0) {
          tables[tableConfig.name] = { upserts, deletes };
        }

        totalRecords += records.length;

        if (totalRecords >= PAGE_SIZE) {
          hasMore = true;
          const newCursor = encodeCursor({
            tableIndex: i,
            offset: offset + records.length,
          });
          return reply.send({
            serverTime: new Date().toISOString(),
            tables,
            cursor: newCursor,
            hasMore: true,
          });
        }
      }

      return reply.send({
        serverTime: new Date().toISOString(),
        tables,
        hasMore: false,
      });
    }
  );

  // POST /sync/push — push client changes
  app.post<{ Body: PushBodyType }>(
    "/sync/push",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_VIEW),
      schema: { body: PushBody },
    },
    async (request, reply) => {
      const { changes, deviceId } = request.body;
      const results: Array<{
        recordId: string;
        status: "accepted" | "conflict" | "rejected";
        serverVersion?: number;
        serverData?: unknown;
        clientVersion?: number;
        reason?: string;
      }> = [];

      for (const change of changes) {
        const tableConfig = SYNCABLE_TABLES.find((t) => t.name === change.table);
        if (!tableConfig) {
          results.push({ recordId: change.recordId, status: "rejected", reason: `Unknown table: ${change.table}` });
          continue;
        }

        const delegate = (prisma as any)[tableConfig.delegate];

        try {
          if (change.operation === "create") {
            await delegate.create({ data: { ...change.payload, id: change.recordId, tenantId } });
            results.push({ recordId: change.recordId, status: "accepted", serverVersion: 0 });
          } else if (change.operation === "update") {
            // Note: version-middleware auto-increments syncVersion on update — do NOT set it here
            if (change.force) {
              // Force override — bypass version check (used for "Keep Mine" conflict resolution)
              const updated = await delegate.update({
                where: { id: change.recordId },
                data: change.payload,
              });
              results.push({ recordId: change.recordId, status: "accepted", serverVersion: updated.syncVersion });
            } else {
              // Optimistic concurrency — check version before updating
              const current = await delegate.findUnique({ where: { id: change.recordId } });
              if (!current) {
                results.push({ recordId: change.recordId, status: "rejected", reason: "Record not found" });
                continue;
              }
              if (current.syncVersion !== change.version) {
                results.push({
                  recordId: change.recordId,
                  status: "conflict",
                  serverVersion: current.syncVersion,
                  serverData: current,
                  clientVersion: change.version,
                });
                continue;
              }
              const updated = await delegate.update({
                where: { id: change.recordId },
                data: change.payload,
              });
              results.push({ recordId: change.recordId, status: "accepted", serverVersion: updated.syncVersion });
            }
          } else if (change.operation === "delete") {
            // Soft delete — middleware increments syncVersion automatically
            await delegate.update({
              where: { id: change.recordId },
              data: { deletedAt: new Date() },
            });
            results.push({ recordId: change.recordId, status: "accepted" });
          }
        } catch (err) {
          results.push({
            recordId: change.recordId,
            status: "rejected",
            reason: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      // Update device lastSyncAt
      if (deviceId) {
        await prisma.device.update({
          where: { id: deviceId },
          data: { lastSyncAt: new Date(), lastIp: request.ip },
        }).catch(() => {}); // non-critical
      }

      return reply.send({ results });
    }
  );

  // GET /sync/status — sync metadata + version enforcement
  app.get(
    "/sync/status",
    { preHandler: requirePermission(PERMISSIONS.TERRITORIES_VIEW) },
    async (_request, reply) => {
      const pkg = await import("../../package.json", { with: { type: "json" } }).catch(() => ({ default: { version: "0.0.0" } }));
      return reply.send({
        minClientVersion: process.env.MIN_CLIENT_VERSION ?? "0.0.0",
        serverVersion: pkg.default.version,
        serverTime: new Date().toISOString(),
      });
    }
  );

  // HEAD /sync/status — lightweight connectivity check
  app.head(
    "/sync/status",
    { preHandler: requirePermission(PERMISSIONS.TERRITORIES_VIEW) },
    async (_request, reply) => {
      return reply.status(204).send();
    }
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd hub-api && npx vitest run src/routes/__tests__/sync.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Register sync routes in index.ts**

In `hub-api/src/index.ts`:
```typescript
import { syncRoutes } from "./routes/sync.js";
```
And register: `await app.register(syncRoutes);`

- [ ] **Step 6: Verify build**

Run: `npm run build --workspace=hub-api`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add hub-api/src/routes/sync.ts hub-api/src/routes/__tests__/sync.test.ts hub-api/src/index.ts
git commit -m "feat: add sync pull/push/status endpoints with delta pagination and conflict detection"
```

---

## Chunk 2: Frontend Crypto + Offline DB (Dexie.js, encryption, device manager)

### Task 5: Install Dexie.js dependency

**Files:**
- Modify: `hub-app/package.json`

- [ ] **Step 1: Install dexie**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm install dexie --workspace=hub-app`

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add hub-app/package.json package-lock.json
git commit -m "chore: add dexie.js dependency for offline IndexedDB storage"
```

---

### Task 6: Client-side crypto module (AES-256-GCM key derivation + encrypt/decrypt)

**Files:**
- Create: `hub-app/src/lib/crypto.ts`

- [ ] **Step 1: Write crypto module**

Create `hub-app/src/lib/crypto.ts`:
```typescript
/**
 * Client-side AES-256-GCM encryption via Web Crypto API.
 * Key derived from OIDC sub + deviceId + server-provided salt.
 * Key held in memory only — never persisted.
 */

const PBKDF2_ITERATIONS = 100_000;
const IV_LENGTH = 12;

/** Derive AES-256-GCM key from sub + deviceId + salt */
export async function deriveEncryptionKey(
  sub: string,
  deviceId: string,
  saltBase64: string,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();

  // Step 1: HMAC-SHA256(sub + deviceId) → seed
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(sub),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const seed = await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(deviceId));

  // Step 2: PBKDF2(seed, salt, 100K iterations) → AES-256 key
  const pbkdf2Key = await crypto.subtle.importKey(
    "raw",
    seed,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const salt = Uint8Array.from(atob(saltBase64), (c) => c.charCodeAt(0));

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    pbkdf2Key,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt a string value. Returns base64 string (IV + ciphertext + tag). */
export async function encryptField(key: CryptoKey, plaintext: string): Promise<string> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );
  // Concat IV + ciphertext (chunked to avoid stack overflow on large payloads)
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  let binary = "";
  for (let i = 0; i < combined.length; i++) binary += String.fromCharCode(combined[i]);
  return btoa(binary);
}

/** Decrypt a base64 string (IV + ciphertext + tag). Returns plaintext string. */
export async function decryptField(key: CryptoKey, encrypted: string): Promise<string> {
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}

/** Encrypt an object's specified fields in-place. Returns new object with encrypted fields. */
export async function encryptFields<T extends Record<string, unknown>>(
  key: CryptoKey,
  obj: T,
  fieldNames: string[],
): Promise<T> {
  const result = { ...obj };
  for (const field of fieldNames) {
    const value = result[field];
    if (value != null && typeof value === "string") {
      (result as any)[field] = await encryptField(key, value);
    } else if (value != null && typeof value === "object") {
      (result as any)[field] = await encryptField(key, JSON.stringify(value));
    }
  }
  return result;
}

/** Decrypt an object's specified fields. Returns new object with decrypted fields. */
export async function decryptFields<T extends Record<string, unknown>>(
  key: CryptoKey,
  obj: T,
  fieldNames: string[],
  jsonFields?: string[],
): Promise<T> {
  const result = { ...obj };
  for (const field of fieldNames) {
    const value = result[field];
    if (value != null && typeof value === "string") {
      try {
        const decrypted = await decryptField(key, value);
        (result as any)[field] = jsonFields?.includes(field) ? JSON.parse(decrypted) : decrypted;
      } catch {
        // Field may not be encrypted (migration), keep as-is
      }
    }
  }
  return result;
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/lib/crypto.ts
git commit -m "feat: add AES-256-GCM crypto module for offline data encryption"
```

---

### Task 7: Dexie offline database with encryption middleware

**Files:**
- Create: `hub-app/src/lib/offline-db.ts`

- [ ] **Step 1: Write Dexie database definition with encryption middleware**

Create `hub-app/src/lib/offline-db.ts`:
```typescript
import Dexie, { type Table } from "dexie";
import { encryptFields, decryptFields } from "./crypto.js";

// ─── Table interfaces ───────────────────────

export interface OfflineTerritory {
  id: string;
  number: string;
  name: string;
  description?: string;
  type: string;
  boundaries?: unknown;
  syncVersion: number;
  updatedAt: string;
  syncedAt: string;
}

export interface OfflineAddress {
  id: string;
  territoryId: string;
  street?: string;
  houseNumber?: string;
  city?: string;
  postcode?: string;
  lat: number;
  lng: number;
  type: string;
  status: string;
  notes?: string;
  bellCount: number;
  syncVersion: number;
  updatedAt: string;
  syncedAt: string;
}

export interface OfflineVisit {
  id: string;
  addressId: string;
  publisherId: string;
  outcome: string;
  notes?: string;
  visitedAt: string;
  syncVersion: number;
  updatedAt: string;
  syncedAt: string;
}

export interface OfflineAssignment {
  id: string;
  territoryId: string;
  publisherId: string;
  assignedAt: string;
  returnedAt?: string;
  isActive: boolean;
  syncVersion: number;
  updatedAt: string;
  syncedAt: string;
}

export interface OfflineMeetingPoint {
  id: string;
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  dayOfWeek?: number;
  time?: string;
  syncVersion: number;
  updatedAt: string;
  syncedAt: string;
}

export interface OfflineMeeting {
  id: string;
  meetingPointId?: string;
  date: string;
  time?: string;
  status: string;
  notes?: string;
  syncVersion: number;
  updatedAt: string;
  syncedAt: string;
}

export interface OfflinePublisher {
  id: string;
  firstName: string;
  lastName: string;
  displayName?: string;
  congregationRole: string;
  syncVersion: number;
  updatedAt: string;
  syncedAt: string;
}

export interface OfflineTerritoryShare {
  id: string;
  territoryId: string;
  syncVersion: number;
  updatedAt: string;
  syncedAt: string;
}

export interface PendingChange {
  id?: number;
  table: string;
  recordId: string;
  operation: "create" | "update" | "delete";
  version: number;
  payload: string; // encrypted JSON
  status: "pending" | "pushing" | "accepted" | "conflict" | "failed" | "rejected";
  force?: boolean; // true when user chose "Keep Mine" — bypasses server version check
  createdAt: string;
  errorMessage?: string;
  serverData?: string; // encrypted JSON of server's version (for conflicts)
}

export interface SyncMetaEntry {
  key: string;
  value: string;
}

// ─── Encrypted field maps ───────────────────

export const ENCRYPTED_FIELDS: Record<string, string[]> = {
  territories: ["name", "description", "boundaries"],
  addresses: ["street", "houseNumber", "city", "postcode", "notes"],
  visits: ["notes"],
  meetingPoints: ["name", "address"],
  campaignMeetingPoints: ["name", "address"],
  meetings: ["notes"],
  publishers: ["firstName", "lastName"],
  pendingChanges: ["payload", "serverData"],
};

export const JSON_ENCRYPTED_FIELDS: Record<string, string[]> = {
  territories: ["boundaries"],
};

// ─── Database class ─────────────────────────

export class HubportOfflineDB extends Dexie {
  territories!: Table<OfflineTerritory, string>;
  addresses!: Table<OfflineAddress, string>;
  visits!: Table<OfflineVisit, string>;
  assignments!: Table<OfflineAssignment, string>;
  meetingPoints!: Table<OfflineMeetingPoint, string>;
  campaignMeetingPoints!: Table<OfflineMeetingPoint, string>;
  meetings!: Table<OfflineMeeting, string>;
  publishers!: Table<OfflinePublisher, string>;
  territoryShares!: Table<OfflineTerritoryShare, string>;
  pendingChanges!: Table<PendingChange, number>;
  syncMeta!: Table<SyncMetaEntry, string>;

  constructor(tenantId: string) {
    super(`hubportOffline-${tenantId}`);

    this.version(1).stores({
      territories: "id, number, type",
      addresses: "id, territoryId",
      visits: "id, addressId",
      assignments: "id, territoryId",
      meetingPoints: "id",
      campaignMeetingPoints: "id, campaignId",
      meetings: "id, meetingPointId, date",
      publishers: "id",
      territoryShares: "id, territoryId",
      pendingChanges: "++id, table, status",
      syncMeta: "key",
    });
  }
}

// ─── Singleton with encryption ──────────────

let dbInstance: HubportOfflineDB | null = null;
let encryptionKey: CryptoKey | null = null;

export function initOfflineDB(tenantId: string, key: CryptoKey): HubportOfflineDB {
  if (dbInstance) dbInstance.close();
  encryptionKey = key;
  dbInstance = new HubportOfflineDB(tenantId);

  // Encryption middleware: encrypt on write, decrypt on read
  for (const [tableName, fields] of Object.entries(ENCRYPTED_FIELDS)) {
    const table = (dbInstance as any)[tableName] as Table;
    if (!table) continue;

    table.hook("creating", function (_primKey, obj) {
      // Synchronous hook — encryption happens before put via helper
      // We handle this in the put/bulkPut wrappers instead
    });

    table.hook("reading", function (obj) {
      // Reading hook is synchronous — we handle decryption in query wrappers
      return obj;
    });
  }

  return dbInstance;
}

export function getOfflineDB(): HubportOfflineDB | null {
  return dbInstance;
}

export function getEncryptionKey(): CryptoKey | null {
  return encryptionKey;
}

/** Encrypt an object before storing in Dexie */
export async function encryptForStorage<T extends Record<string, unknown>>(
  tableName: string,
  obj: T,
): Promise<T> {
  const key = getEncryptionKey();
  if (!key) return obj;
  const fields = ENCRYPTED_FIELDS[tableName];
  if (!fields) return obj;
  return encryptFields(key, obj, fields);
}

/** Decrypt an object after reading from Dexie */
export async function decryptFromStorage<T extends Record<string, unknown>>(
  tableName: string,
  obj: T,
): Promise<T> {
  const key = getEncryptionKey();
  if (!key) return obj;
  const fields = ENCRYPTED_FIELDS[tableName];
  if (!fields) return obj;
  return decryptFields(key, obj, fields, JSON_ENCRYPTED_FIELDS[tableName]);
}

/** Wipe all offline data and close DB */
export async function wipeOfflineData(): Promise<void> {
  if (dbInstance) {
    dbInstance.close();
    await dbInstance.delete();
    dbInstance = null;
  }
  encryptionKey = null;
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/lib/offline-db.ts
git commit -m "feat: add Dexie.js offline database with encryption middleware"
```

---

### Task 8: Device manager (client-side registration + metadata)

**Files:**
- Create: `hub-app/src/lib/device-manager.ts`

- [ ] **Step 1: Write device manager**

Create `hub-app/src/lib/device-manager.ts`:
```typescript
import { deriveEncryptionKey } from "./crypto.js";

const DEVICE_ID_KEY = "hubport-device-id";
const API_BASE = ""; // relative — uses same origin

interface DeviceInfo {
  deviceUuid: string;
  userAgent: string;
  platform: string;
  screenSize: string;
}

interface RegisterResult {
  id: string;
  deviceUuid: string;
  displayName: string;
  encSalt: string;
  status: string;
}

interface DeviceStatus {
  id: string;
  status: "active" | "revoked";
  displayName: string;
  revokeReason?: string;
  revokedAt?: string;
}

export interface DeviceListItem {
  id: string;
  deviceUuid: string;
  displayName: string;
  platform: string;
  screenSize: string;
  status: string;
  lastSyncAt?: string;
  registeredAt: string;
  revokedAt?: string;
  revokeReason?: string;
}

function getDeviceUuid(): string {
  let uuid = localStorage.getItem(DEVICE_ID_KEY);
  if (!uuid) {
    uuid = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, uuid);
  }
  return uuid;
}

function collectDeviceInfo(): DeviceInfo {
  const deviceUuid = getDeviceUuid();
  const userAgent = navigator.userAgent;
  // navigator.platform is deprecated — use userAgentData with fallback
  const platform = (navigator as any).userAgentData?.platform
    ?? parsePlatformFromUA(userAgent);
  const screenSize = `${screen.width}x${screen.height}`;
  return { deviceUuid, userAgent, platform, screenSize };
}

function parsePlatformFromUA(ua: string): string {
  const lower = ua.toLowerCase();
  if (lower.includes("iphone")) return "iPhone";
  if (lower.includes("ipad")) return "iPad";
  if (lower.includes("android")) return "Android";
  if (lower.includes("macintosh") || lower.includes("mac os")) return "macOS";
  if (lower.includes("windows")) return "Windows";
  if (lower.includes("linux")) return "Linux";
  return "Unknown";
}

async function apiFetch<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = new Error(body.message ?? `API error ${res.status}`);
    (error as any).status = res.status;
    (error as any).body = body;
    throw error;
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** Register this device or re-register if already known */
export async function registerDevice(token: string): Promise<RegisterResult> {
  const info = collectDeviceInfo();
  return apiFetch<RegisterResult>("/devices/register", token, {
    method: "POST",
    body: JSON.stringify(info),
  });
}

/** Check this device's status (active/revoked) */
export async function checkDeviceStatus(token: string): Promise<DeviceStatus> {
  const uuid = getDeviceUuid();
  return apiFetch<DeviceStatus>(`/devices/me?deviceUuid=${uuid}`, token);
}

/** Get encryption salt for this device */
export async function getEncryptionSalt(token: string): Promise<string> {
  const uuid = getDeviceUuid();
  const res = await apiFetch<{ salt: string }>(`/devices/encryption-salt?deviceUuid=${uuid}`, token);
  return res.salt;
}

/** List own devices */
export async function listDevices(token: string): Promise<DeviceListItem[]> {
  return apiFetch<DeviceListItem[]>("/devices", token);
}

/** Remove own device */
export async function removeDevice(token: string, deviceId: string): Promise<void> {
  await apiFetch<void>(`/devices/${deviceId}`, token, { method: "DELETE" });
}

/** Get current device UUID */
export function getCurrentDeviceUuid(): string {
  return getDeviceUuid();
}

/** Clear device identity (used after revocation) */
export function clearDeviceIdentity(): void {
  localStorage.removeItem(DEVICE_ID_KEY);
}

/** Derive encryption key for this device */
export async function deriveDeviceKey(
  sub: string,
  salt: string,
): Promise<CryptoKey> {
  const deviceId = getDeviceUuid();
  return deriveEncryptionKey(sub, deviceId, salt);
}

/** Check if we have a stored device UUID */
export function hasDeviceRegistration(): boolean {
  return localStorage.getItem(DEVICE_ID_KEY) !== null;
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/lib/device-manager.ts
git commit -m "feat: add client-side device manager for registration and key derivation"
```

---

### Task 9: Sync engine (pull/push/conflict queue)

**Files:**
- Create: `hub-app/src/lib/sync-engine.ts`

- [ ] **Step 1: Write sync engine**

Create `hub-app/src/lib/sync-engine.ts`:
```typescript
import {
  getOfflineDB,
  encryptForStorage,
  decryptFromStorage,
  type PendingChange,
} from "./offline-db.js";

const API_BASE = "";

interface SyncPullResponse {
  serverTime: string;
  tables: Record<string, { upserts: unknown[]; deletes: string[] }>;
  cursor?: string;
  hasMore: boolean;
}

interface SyncPushResult {
  recordId: string;
  status: "accepted" | "conflict" | "rejected";
  serverVersion?: number;
  serverData?: unknown;
  clientVersion?: number;
  reason?: string;
}

interface SyncStatus {
  minClientVersion: string;
  serverVersion: string;
  serverTime: string;
}

export type SyncState = "idle" | "pulling" | "pushing" | "error";

type SyncListener = (state: SyncState, detail?: string) => void;

const listeners = new Set<SyncListener>();

export function onSyncStateChange(fn: SyncListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyState(state: SyncState, detail?: string) {
  listeners.forEach((fn) => fn(state, detail));
}

async function apiFetch<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) throw new Error(`Sync API error ${res.status}`);
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** Check if server is reachable (iOS onLine mitigation) */
export async function checkConnectivity(token: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(`${API_BASE}/api/sync/status`, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return true;
  } catch {
    return false;
  }
}

/** Get sync status (version enforcement) */
export async function getSyncStatus(token: string): Promise<SyncStatus> {
  return apiFetch<SyncStatus>("/sync/status", token);
}

/** Pull changes from server since last sync */
export async function pullChanges(token: string): Promise<number> {
  const db = getOfflineDB();
  if (!db) throw new Error("Offline DB not initialized");

  const lastSync = await db.syncMeta.get("lastSyncAt");
  const since = lastSync?.value ?? "";
  let totalRecords = 0;
  let cursor: string | undefined;
  let hasMore = true;

  notifyState("pulling");

  while (hasMore) {
    const params = new URLSearchParams();
    if (since) params.set("since", since);
    if (cursor) params.set("cursor", cursor);

    const response = await apiFetch<SyncPullResponse>(
      `/sync/pull?${params.toString()}`,
      token,
    );

    for (const [tableName, delta] of Object.entries(response.tables)) {
      const table = (db as any)[tableName];
      if (!table) continue;

      // Upsert records (encrypt before storing)
      for (const record of delta.upserts) {
        const encrypted = await encryptForStorage(tableName, record as Record<string, unknown>);
        await table.put({ ...encrypted, syncedAt: response.serverTime });
        totalRecords++;
      }

      // Delete records
      for (const id of delta.deletes) {
        await table.delete(id);
        totalRecords++;
      }
    }

    hasMore = response.hasMore;
    cursor = response.cursor;

    // Update last sync time
    await db.syncMeta.put({ key: "lastSyncAt", value: response.serverTime });
  }

  notifyState("idle");
  return totalRecords;
}

/** Push pending changes to server */
export async function pushChanges(token: string, deviceId: string): Promise<SyncPushResult[]> {
  const db = getOfflineDB();
  if (!db) throw new Error("Offline DB not initialized");

  const pending = await db.pendingChanges
    .where("status")
    .anyOf(["pending", "failed"])
    .toArray();

  if (pending.length === 0) return [];

  notifyState("pushing");

  // Mark as pushing
  await db.pendingChanges
    .where("id")
    .anyOf(pending.map((p) => p.id!))
    .modify({ status: "pushing" });

  try {
    // Decrypt payloads before sending
    const changes = await Promise.all(
      pending.map(async (p) => {
        const decrypted = await decryptFromStorage("pendingChanges", p as any);
        return {
          table: p.table,
          recordId: p.recordId,
          operation: p.operation,
          version: p.version,
          payload: JSON.parse(decrypted.payload as string),
          force: p.force ?? false,
        };
      }),
    );

    const response = await apiFetch<{ results: SyncPushResult[] }>(
      "/sync/push",
      token,
      {
        method: "POST",
        body: JSON.stringify({ deviceId, changes }),
      },
    );

    // Process results
    for (const result of response.results) {
      const change = pending.find((p) => p.recordId === result.recordId);
      if (!change?.id) continue;

      switch (result.status) {
        case "accepted":
          await db.pendingChanges.delete(change.id);
          break;
        case "conflict":
          await db.pendingChanges.update(change.id, {
            status: "conflict",
            serverData: result.serverData
              ? await (async () => {
                  const encrypted = await encryptForStorage("pendingChanges", {
                    serverData: JSON.stringify(result.serverData),
                  });
                  return encrypted.serverData as string;
                })()
              : undefined,
          });
          break;
        case "rejected":
          await db.pendingChanges.update(change.id, {
            status: "rejected",
            errorMessage: result.reason,
          });
          break;
      }
    }

    notifyState("idle");
    return response.results;
  } catch {
    // Network failure — revert to pending
    await db.pendingChanges
      .where("id")
      .anyOf(pending.map((p) => p.id!))
      .modify({ status: "pending" });
    notifyState("error", "Network error during push");
    throw new Error("Push failed — changes will retry on next sync");
  }
}

/** Queue a local mutation for sync */
export async function queueChange(
  table: string,
  recordId: string,
  operation: "create" | "update" | "delete",
  version: number,
  payload: unknown,
): Promise<void> {
  const db = getOfflineDB();
  if (!db) throw new Error("Offline DB not initialized");

  const encrypted = await encryptForStorage("pendingChanges", {
    payload: JSON.stringify(payload),
  });

  await db.pendingChanges.add({
    table,
    recordId,
    operation,
    version,
    payload: encrypted.payload as string,
    status: "pending",
    createdAt: new Date().toISOString(),
  });
}

/** Get count of pending changes */
export async function getPendingCount(): Promise<number> {
  const db = getOfflineDB();
  if (!db) return 0;
  return db.pendingChanges.where("status").anyOf(["pending", "failed"]).count();
}

/** Get conflicts for resolution */
export async function getConflicts(): Promise<PendingChange[]> {
  const db = getOfflineDB();
  if (!db) return [];
  return db.pendingChanges.where("status").equals("conflict").toArray();
}

/** Resolve a conflict: keep mine (force push) */
export async function resolveKeepMine(changeId: number): Promise<void> {
  const db = getOfflineDB();
  if (!db) return;
  await db.pendingChanges.update(changeId, { status: "pending", force: true });
}

/** Resolve a conflict: use theirs (discard local) */
export async function resolveUseTheirs(changeId: number): Promise<void> {
  const db = getOfflineDB();
  if (!db) return;
  await db.pendingChanges.delete(changeId);
}

/** Full sync cycle: push first, then pull */
export async function fullSync(token: string, deviceId: string): Promise<void> {
  const isOnline = await checkConnectivity(token);
  if (!isOnline) {
    notifyState("error", "No connectivity");
    return;
  }

  // Push first (send local changes)
  await pushChanges(token, deviceId);

  // Then pull (get server updates)
  await pullChanges(token);
}

/** Request persistent storage (iOS eviction protection) */
export async function requestPersistence(): Promise<boolean> {
  if (navigator.storage?.persist) {
    return navigator.storage.persist();
  }
  return false;
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/lib/sync-engine.ts
git commit -m "feat: add sync engine with delta pull/push, conflict queue, and iOS connectivity check"
```

---

## Chunk 3: React hooks + UI components (sync bar, update banner, conflict dialog, device pages)

> **Note:** The existing `useAuth()` hook returns `{ user }` where `user.access_token` holds the token. Throughout this chunk, components use `const { user } = useAuth()` with `user?.access_token` as the token. If a shorthand `token` property is preferred, extend `useAuth` to include `token: user?.access_token ?? null` as a first step.

### Task 10: React hooks — useSyncStatus, useOfflineData

**Files:**
- Create: `hub-app/src/hooks/useSyncStatus.ts`
- Create: `hub-app/src/hooks/useOfflineData.ts`

- [ ] **Step 1: Write useSyncStatus hook**

Create `hub-app/src/hooks/useSyncStatus.ts`:
```typescript
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/auth/useAuth";
import {
  onSyncStateChange,
  fullSync,
  getPendingCount,
  type SyncState,
  checkConnectivity,
} from "@/lib/sync-engine";
import { getCurrentDeviceUuid } from "@/lib/device-manager";
import { getOfflineDB } from "@/lib/offline-db";

export function useSyncStatus() {
  const { user } = useAuth();
  const token = user?.access_token ?? null;
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Listen to sync state changes
  useEffect(() => {
    return onSyncStateChange((state) => {
      setSyncState(state);
      // Refresh pending count after sync
      getPendingCount().then(setPendingCount).catch(() => {});
      // Refresh last sync time
      getOfflineDB()?.syncMeta.get("lastSyncAt").then((entry) => {
        setLastSyncAt(entry?.value ?? null);
      }).catch(() => {});
    });
  }, []);

  // Online/offline detection
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Auto-sync on visibility change (app resume)
  useEffect(() => {
    if (!token) return;
    const handleVisibility = async () => {
      if (document.visibilityState !== "visible") return;
      const db = getOfflineDB();
      if (!db) return;
      const lastSync = await db.syncMeta.get("lastSyncAt");
      const lastTime = lastSync?.value ? new Date(lastSync.value).getTime() : 0;
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      if (lastTime < fiveMinAgo) {
        const deviceId = getCurrentDeviceUuid();
        fullSync(token, deviceId).catch(console.error);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [token]);

  // Auto-push on reconnect (with connectivity probe)
  useEffect(() => {
    if (!token) return;
    const handleOnline = async () => {
      const reachable = await checkConnectivity(token);
      if (reachable) {
        const deviceId = getCurrentDeviceUuid();
        fullSync(token, deviceId).catch(console.error);
      }
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [token]);

  const syncNow = useCallback(async () => {
    if (!token) return;
    const deviceId = getCurrentDeviceUuid();
    await fullSync(token, deviceId);
  }, [token]);

  return { syncState, pendingCount, lastSyncAt, isOnline, syncNow };
}
```

- [ ] **Step 2: Write useOfflineData hook**

Create `hub-app/src/hooks/useOfflineData.ts`:
```typescript
import { useState, useEffect, useCallback } from "react";
import { getOfflineDB, decryptFromStorage, type HubportOfflineDB } from "@/lib/offline-db";

/**
 * Generic hook to read data from Dexie (offline) or API (online).
 * Prefers Dexie when data is available, falls back to API.
 */
export function useOfflineData<T extends Record<string, unknown>>(
  tableName: string,
  queryFn?: () => Promise<T[]>,
  filterFn?: (item: T) => boolean,
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFromDexie = useCallback(async () => {
    const db = getOfflineDB();
    if (!db) return null;

    const table = (db as any)[tableName];
    if (!table) return null;

    const raw = await table.toArray();
    const decrypted = await Promise.all(
      raw.map((item: Record<string, unknown>) => decryptFromStorage(tableName, item)),
    );
    return filterFn ? decrypted.filter(filterFn) : decrypted;
  }, [tableName, filterFn]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      // Try Dexie first
      const offlineData = await loadFromDexie();
      if (offlineData && offlineData.length > 0 && !cancelled) {
        setData(offlineData as T[]);
        setLoading(false);
        return;
      }

      // Fall back to API if available
      if (queryFn && navigator.onLine) {
        try {
          const apiData = await queryFn();
          if (!cancelled) {
            setData(apiData);
            setLoading(false);
          }
        } catch {
          if (!cancelled) setLoading(false);
        }
      } else {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [loadFromDexie, queryFn]);

  return { data, loading, reload: loadFromDexie };
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add hub-app/src/hooks/useSyncStatus.ts hub-app/src/hooks/useOfflineData.ts
git commit -m "feat: add useSyncStatus and useOfflineData React hooks"
```

---

### Task 11: SyncStatusBar component

**Files:**
- Create: `hub-app/src/components/SyncStatusBar.tsx`

- [ ] **Step 1: Write SyncStatusBar**

Create `hub-app/src/components/SyncStatusBar.tsx`:
```typescript
import { RefreshCw, Cloud, CloudOff, AlertCircle, Loader2 } from "lucide-react";
import { FormattedMessage } from "react-intl";
import { useSyncStatus } from "@/hooks/useSyncStatus";

export function SyncStatusBar() {
  const { syncState, pendingCount, isOnline, syncNow } = useSyncStatus();

  const isSyncing = syncState === "pulling" || syncState === "pushing";

  return (
    <div className="flex items-center gap-2">
      {/* Online/offline indicator */}
      {isOnline ? (
        <Cloud size={14} className="text-[var(--green)]" />
      ) : (
        <CloudOff size={14} className="text-[var(--text-muted)]" />
      )}

      {/* Pending changes badge */}
      {pendingCount > 0 && (
        <span className="text-[10px] font-semibold bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full">
          {pendingCount}
        </span>
      )}

      {/* Sync error */}
      {syncState === "error" && (
        <AlertCircle size={14} className="text-[var(--red)]" />
      )}

      {/* Sync button */}
      <button
        onClick={syncNow}
        disabled={isSyncing || !isOnline}
        title={isOnline ? "Sync now" : "Offline"}
        className="p-1.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isSyncing ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <RefreshCw size={14} />
        )}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/components/SyncStatusBar.tsx
git commit -m "feat: add SyncStatusBar component with online/offline indicator and sync button"
```

---

### Task 12: UpdateBanner component (PWA update flow)

**Files:**
- Create: `hub-app/src/components/UpdateBanner.tsx`
- Modify: `hub-app/vite.config.ts`

- [ ] **Step 1: Update vite.config.ts for prompt-based SW**

In `hub-app/vite.config.ts`:
- Change `registerType: "autoUpdate"` to `registerType: "prompt"`
- Remove `skipWaiting: true` and `clientsClaim: true` from `workbox` block
- Add to the `api-cache` `urlPattern`: exclude `/api/sync/` and `/api/devices/`
- Add `define: { __APP_VERSION__: JSON.stringify(require("./package.json").version) }` to vite config (or use `import` for ESM)

Updated workbox API cache pattern:
```typescript
{
  urlPattern: ({ url }) =>
    url.pathname.startsWith("/api/") &&
    !url.pathname.startsWith("/api/sync/") &&
    !url.pathname.startsWith("/api/devices/"),
  handler: "NetworkFirst",
  options: {
    cacheName: "api-cache",
    expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 },
    networkTimeoutSeconds: 10,
  },
},
```

- [ ] **Step 2: Write UpdateBanner component**

Create `hub-app/src/components/UpdateBanner.tsx`:
```typescript
import { useState, useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Download, X, Loader2 } from "lucide-react";
import { FormattedMessage } from "react-intl";
import { getSyncStatus, pushChanges, getPendingCount } from "@/lib/sync-engine";
import { getCurrentDeviceUuid } from "@/lib/device-manager";
import { useAuth } from "@/auth/useAuth";
import { wipeOfflineData } from "@/lib/offline-db";

declare const __APP_VERSION__: string;

export function UpdateBanner() {
  const { user } = useAuth();
  const token = user?.access_token ?? null;
  const [isRequired, setIsRequired] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  // Check if update is required (version enforcement)
  useEffect(() => {
    if (!needRefresh || !token) return;
    getSyncStatus(token)
      .then((status) => {
        const currentVersion = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";
        setIsRequired(currentVersion < status.minClientVersion);
      })
      .catch(() => {});
    getPendingCount().then(setPendingCount).catch(() => {});
  }, [needRefresh, token]);

  const handleUpdate = async () => {
    if (!token) return;
    setUpdating(true);
    try {
      // Push pending changes first
      if (pendingCount > 0) {
        const deviceId = getCurrentDeviceUuid();
        await pushChanges(token, deviceId);
      }
      // Wipe Dexie (will re-sync after reload)
      await wipeOfflineData();
      // Activate new SW and reload
      await updateServiceWorker(true);
    } catch (err) {
      console.error("Update failed:", err);
      setUpdating(false);
    }
  };

  if (!needRefresh || (dismissed && !isRequired)) return null;

  const isOffline = !navigator.onLine;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 text-sm ${
        isRequired
          ? "bg-red-500/15 border-b border-red-500/30"
          : "bg-blue-500/15 border-b border-blue-500/30"
      }`}
    >
      <Download size={16} className={isRequired ? "text-red-400" : "text-blue-400"} />
      <div className="flex-1">
        <span className={`font-medium ${isRequired ? "text-red-400" : "text-blue-400"}`}>
          {isRequired ? (
            <FormattedMessage id="pwa.updateRequired" defaultMessage="Update required" />
          ) : (
            <FormattedMessage id="pwa.updateAvailable" defaultMessage="New version available" />
          )}
        </span>
        {pendingCount > 0 && (
          <span className="text-xs text-[var(--text-muted)] ml-2">
            {pendingCount} pending changes will sync first
          </span>
        )}
      </div>
      <button
        onClick={handleUpdate}
        disabled={updating || isOffline}
        className={`px-3 py-1 text-xs font-semibold rounded-[var(--radius-sm)] transition-colors cursor-pointer disabled:opacity-50 ${
          isRequired
            ? "bg-red-500 text-white hover:bg-red-400"
            : "bg-blue-500 text-white hover:bg-blue-400"
        }`}
      >
        {updating ? (
          <Loader2 size={12} className="animate-spin" />
        ) : isOffline ? (
          "Offline"
        ) : (
          <FormattedMessage id="pwa.updateNow" defaultMessage="Update" />
        )}
      </button>
      {!isRequired && (
        <button
          onClick={() => setDismissed(true)}
          className="p-1 text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add hub-app/src/components/UpdateBanner.tsx hub-app/vite.config.ts
git commit -m "feat: add UpdateBanner component and switch PWA to prompt-based updates"
```

---

### Task 13: ConflictDialog component

**Files:**
- Create: `hub-app/src/components/ConflictDialog.tsx`

- [ ] **Step 1: Write ConflictDialog**

Create `hub-app/src/components/ConflictDialog.tsx`:
```typescript
import { useState } from "react";
import { AlertTriangle, Check, X, GitMerge } from "lucide-react";
import { FormattedMessage } from "react-intl";
import { resolveKeepMine, resolveUseTheirs } from "@/lib/sync-engine";
import type { PendingChange } from "@/lib/offline-db";

interface ConflictDialogProps {
  conflict: PendingChange;
  onResolved: () => void;
}

export function ConflictDialog({ conflict, onResolved }: ConflictDialogProps) {
  const [resolving, setResolving] = useState(false);

  const handleKeepMine = async () => {
    if (!conflict.id) return;
    setResolving(true);
    await resolveKeepMine(conflict.id);
    onResolved();
  };

  const handleUseTheirs = async () => {
    if (!conflict.id) return;
    setResolving(true);
    await resolveUseTheirs(conflict.id);
    onResolved();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
      <div className="bg-[var(--bg-2)] border border-[var(--border)] rounded-xl p-6 max-w-lg w-full mx-4 shadow-2xl">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle size={20} className="text-amber-400 mt-0.5" />
          <div>
            <h3 className="text-lg font-semibold text-[var(--text)]">
              <FormattedMessage id="sync.conflict.title" defaultMessage="Sync Conflict" />
            </h3>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              <FormattedMessage
                id="sync.conflict.description"
                defaultMessage="This record was updated by another user while you were offline."
              />
            </p>
          </div>
        </div>

        <div className="mb-4 p-3 rounded-lg bg-[var(--glass)] text-xs text-[var(--text-muted)]">
          <div><strong>Table:</strong> {conflict.table}</div>
          <div><strong>Record:</strong> {conflict.recordId}</div>
          <div><strong>Operation:</strong> {conflict.operation}</div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={handleUseTheirs}
            disabled={resolving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--glass)] transition-colors cursor-pointer disabled:opacity-50"
          >
            <X size={14} />
            <FormattedMessage id="sync.conflict.useTheirs" defaultMessage="Use Theirs" />
          </button>
          <button
            onClick={handleKeepMine}
            disabled={resolving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-amber-500/80 text-black font-semibold hover:bg-amber-400 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Check size={14} />
            <FormattedMessage id="sync.conflict.keepMine" defaultMessage="Keep Mine" />
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/components/ConflictDialog.tsx
git commit -m "feat: add ConflictDialog for sync conflict resolution UI"
```

---

### Task 14: MyDevices page + DeviceAdmin page

**Files:**
- Create: `hub-app/src/pages/profile/MyDevices.tsx`
- Create: `hub-app/src/pages/settings/DeviceAdmin.tsx`
- Modify: `hub-app/src/App.tsx` (add routes)

- [ ] **Step 1: Write MyDevices page**

Create `hub-app/src/pages/profile/MyDevices.tsx`:
```typescript
import { useState, useEffect } from "react";
import { Smartphone, Monitor, Trash2, Loader2 } from "lucide-react";
import { FormattedMessage, FormattedDate } from "react-intl";
import { useAuth } from "@/auth/useAuth";
import { listDevices, removeDevice, getCurrentDeviceUuid, type DeviceListItem } from "@/lib/device-manager";

export function MyDevices() {
  const { user } = useAuth();
  const token = user?.access_token ?? null;
  const [devices, setDevices] = useState<DeviceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const currentUuid = getCurrentDeviceUuid();

  useEffect(() => {
    if (!token) return;
    listDevices(token)
      .then(setDevices)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  const handleRemove = async (deviceId: string) => {
    if (!token || !confirm("Remove this device?")) return;
    setRemoving(deviceId);
    try {
      await removeDevice(token, deviceId);
      setDevices((prev) => prev.filter((d) => d.id !== deviceId));
    } catch (err) {
      console.error("Failed to remove device:", err);
    } finally {
      setRemoving(null);
    }
  };

  const activeDevices = devices.filter((d) => d.status === "active");

  if (loading) return <Loader2 className="animate-spin mx-auto mt-8" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          <FormattedMessage id="profile.devices.title" defaultMessage="My Devices" />
        </h2>
        <span className="text-xs text-[var(--text-muted)]">
          {activeDevices.length} / 3
        </span>
      </div>

      <div className="space-y-2">
        {devices.map((device) => {
          const isCurrent = device.deviceUuid === currentUuid;
          const isRevoked = device.status === "revoked";
          const Icon = device.platform?.toLowerCase().includes("iphone") ||
            device.platform?.toLowerCase().includes("ipad") ||
            device.platform?.toLowerCase().includes("android")
            ? Smartphone
            : Monitor;

          return (
            <div
              key={device.id}
              className={`flex items-center gap-3 p-3 rounded-[var(--radius)] border border-[var(--border)] ${
                isCurrent ? "bg-amber-500/5 border-amber-500/20" : "bg-[var(--bg-1)]"
              } ${isRevoked ? "opacity-50" : ""}`}
            >
              <Icon size={20} className="text-[var(--text-muted)]" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--text)]">
                  {device.displayName}
                  {isCurrent && (
                    <span className="text-xs text-amber-400 ml-2">← this device</span>
                  )}
                </div>
                <div className="text-[10px] text-[var(--text-muted)]">
                  {device.screenSize}
                  {device.lastSyncAt && (
                    <> · Last sync: <FormattedDate value={device.lastSyncAt} /></>
                  )}
                  {isRevoked && device.revokeReason && (
                    <> · Revoked: {device.revokeReason}</>
                  )}
                </div>
              </div>
              {!isCurrent && !isRevoked && (
                <button
                  onClick={() => handleRemove(device.id)}
                  disabled={removing === device.id}
                  className="p-1.5 text-red-400 hover:bg-red-500/10 rounded transition-colors cursor-pointer disabled:opacity-50"
                >
                  {removing === device.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                </button>
              )}
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  isRevoked
                    ? "bg-red-500/20 text-red-400"
                    : "bg-green-500/20 text-green-400"
                }`}
              >
                {isRevoked ? "Revoked" : "Active"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write DeviceAdmin page**

Create `hub-app/src/pages/settings/DeviceAdmin.tsx`:
```typescript
import { useState, useEffect } from "react";
import { Smartphone, Monitor, ShieldX, Loader2 } from "lucide-react";
import { FormattedMessage, FormattedDate } from "react-intl";
import { useAuth } from "@/auth/useAuth";

interface AdminDevice {
  id: string;
  userId: string;
  displayName: string;
  platform: string;
  screenSize: string;
  status: string;
  lastSyncAt?: string;
  registeredAt: string;
  revokedAt?: string;
  revokeReason?: string;
  revokedBy?: string;
}

export function DeviceAdmin() {
  const { user } = useAuth();
  const token = user?.access_token ?? null;
  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch("/api/admin/devices", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setDevices)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  const handleRevoke = async (deviceId: string) => {
    if (!token) return;
    const reason = prompt("Reason for revoking this device:");
    if (reason === null) return; // cancelled
    setRevoking(deviceId);
    try {
      await fetch(`/api/admin/devices/${deviceId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      setDevices((prev) => prev.map((d) =>
        d.id === deviceId ? { ...d, status: "revoked", revokeReason: reason } : d
      ));
    } catch (err) {
      console.error("Failed to revoke device:", err);
    } finally {
      setRevoking(null);
    }
  };

  // Group by userId
  const grouped = devices.reduce<Record<string, AdminDevice[]>>((acc, d) => {
    (acc[d.userId] ??= []).push(d);
    return acc;
  }, {});

  if (loading) return <Loader2 className="animate-spin mx-auto mt-8" />;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">
        <FormattedMessage id="admin.devices.title" defaultMessage="All Devices" />
      </h2>
      {Object.entries(grouped).map(([userId, userDevices]) => (
        <div key={userId} className="space-y-2">
          <h3 className="text-sm font-medium text-[var(--text-muted)]">{userId}</h3>
          {userDevices.map((device) => {
            const isRevoked = device.status === "revoked";
            const Icon = device.platform?.toLowerCase().match(/iphone|ipad|android/) ? Smartphone : Monitor;
            return (
              <div key={device.id} className={`flex items-center gap-3 p-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-1)] ${isRevoked ? "opacity-50" : ""}`}>
                <Icon size={20} className="text-[var(--text-muted)]" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--text)]">{device.displayName}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">
                    {device.screenSize}
                    {device.lastSyncAt && <> · Last sync: <FormattedDate value={device.lastSyncAt} /></>}
                    {isRevoked && device.revokeReason && <> · Revoked: {device.revokeReason}</>}
                  </div>
                </div>
                {!isRevoked && (
                  <button onClick={() => handleRevoke(device.id)} disabled={revoking === device.id}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 rounded transition-colors cursor-pointer disabled:opacity-50">
                    {revoking === device.id ? <Loader2 size={12} className="animate-spin" /> : <ShieldX size={12} />}
                    Revoke
                  </button>
                )}
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${isRevoked ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"}`}>
                  {isRevoked ? "Revoked" : "Active"}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Add routes to App.tsx**

In `hub-app/src/App.tsx`, add:
```typescript
import { MyDevices } from "./pages/profile/MyDevices";
import { DeviceAdmin } from "./pages/settings/DeviceAdmin";
```
Routes:
```tsx
<Route path="/profile/devices" element={<MyDevices />} />
<Route path="/settings/devices" element={
  <PermissionGuard requires="app:admin.devices.view"><DeviceAdmin /></PermissionGuard>
} />
```

- [ ] **Step 4: Add SyncStatusBar and UpdateBanner to Layout**

In the Layout component (or App.tsx), add `<UpdateBanner />` above the main content and `<SyncStatusBar />` in the header.

- [ ] **Step 5: Verify build**

Run: `npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add hub-app/src/pages/profile/MyDevices.tsx hub-app/src/pages/settings/DeviceAdmin.tsx hub-app/src/App.tsx
git commit -m "feat: add MyDevices and DeviceAdmin pages with sync status in layout"
```

---

## Chunk 4: Push Notifications (backend + frontend)

### Task 15: Install web-push dependency + generate VAPID keys

**Files:**
- Modify: `hub-api/package.json`

- [ ] **Step 1: Install web-push**

Run: `npm install web-push --workspace=hub-api && npm install -D @types/web-push --workspace=hub-api`

- [ ] **Step 2: Generate VAPID keys and store in Vault (per ADR-0083)**

Run: `npx web-push generate-vapid-keys --json`

Store the generated `publicKey` and `privateKey` in Vault:
- `secret/data/hubport/<tenant>/vapid` → `{ "public_key": "...", "private_key": "..." }`
- Set env vars `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in tenant container config
- The public key is also exposed via `GET /push/vapid-key` endpoint (safe to share)

- [ ] **Step 3: Commit**

```bash
git add hub-api/package.json package-lock.json
git commit -m "chore: add web-push dependency for VAPID push notifications"
```

---

### Task 16: Push notification service + routes

**Files:**
- Create: `hub-api/src/lib/push-service.ts`
- Create: `hub-api/src/routes/push.ts`
- Modify: `hub-api/src/index.ts`

- [ ] **Step 1: Write push service**

Create `hub-api/src/lib/push-service.ts`:
```typescript
import webpush from "web-push";

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@hubport.cloud";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  type: "territory_assignment" | "meeting_update" | "sync_conflict" | "device_revoked";
}

export async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
): Promise<boolean> {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      { TTL: 3600 },
    );
    return true;
  } catch (err: any) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      // Subscription expired — should be cleaned up
      return false;
    }
    console.error("Push notification failed:", err);
    return false;
  }
}

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC;
}
```

- [ ] **Step 2: Write push routes**

Create `hub-api/src/routes/push.ts`:
```typescript
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { getVapidPublicKey } from "../lib/push-service.js";

const SubscriptionBody = Type.Object({
  deviceId: Type.String({ format: "uuid" }),
  endpoint: Type.String(),
  p256dh: Type.String(),
  auth: Type.String(),
});
type SubscriptionBodyType = Static<typeof SubscriptionBody>;

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  // GET /push/vapid-key — public key for client subscription
  app.get(
    "/push/vapid-key",
    { preHandler: requirePermission(PERMISSIONS.DEVICES_VIEW) },
    async (_request, reply) => {
      return reply.send({ publicKey: getVapidPublicKey() });
    }
  );

  // POST /push/subscribe — store push subscription
  app.post<{ Body: SubscriptionBodyType }>(
    "/push/subscribe",
    {
      preHandler: requirePermission(PERMISSIONS.DEVICES_VIEW),
      schema: { body: SubscriptionBody },
    },
    async (request, reply) => {
      const tenantId = (request as any).policyCtx?.tenantId ?? "";
      const { deviceId, endpoint, p256dh, auth } = request.body;

      // Verify device belongs to user
      const device = await prisma.device.findUnique({ where: { id: deviceId } });
      if (!device || device.userId !== request.user.sub) {
        return reply.status(403).send({ error: "not_your_device" });
      }

      await prisma.pushSubscription.upsert({
        where: { deviceId },
        update: { endpoint, p256dh, auth },
        create: { tenantId, deviceId, endpoint, p256dh, auth },
      });

      return reply.status(201).send({ ok: true });
    }
  );

  // DELETE /push/subscribe — remove push subscription
  app.delete<{ Body: { deviceId: string } }>(
    "/push/subscribe",
    { preHandler: requirePermission(PERMISSIONS.DEVICES_VIEW) },
    async (request, reply) => {
      const { deviceId } = request.body as { deviceId: string };
      await prisma.pushSubscription.deleteMany({ where: { deviceId } });
      return reply.status(204).send();
    }
  );
}
```

- [ ] **Step 3: Register push routes in index.ts**

Add to `hub-api/src/index.ts`:
```typescript
import { pushRoutes } from "./routes/push.js";
```
And: `await app.register(pushRoutes);`

- [ ] **Step 4: Verify build**

Run: `npm run build --workspace=hub-api`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add hub-api/src/lib/push-service.ts hub-api/src/routes/push.ts hub-api/src/index.ts
git commit -m "feat: add push notification service and subscription endpoints"
```

---

### Task 17: Frontend push notification hook + settings page

**Files:**
- Create: `hub-app/src/hooks/usePushNotifications.ts`
- Create: `hub-app/src/pages/settings/NotificationSettings.tsx`

- [ ] **Step 1: Write usePushNotifications hook**

Create `hub-app/src/hooks/usePushNotifications.ts`:
```typescript
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/auth/useAuth";
import { getCurrentDeviceUuid } from "@/lib/device-manager";

export function usePushNotifications() {
  const { token } = useAuth();
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "default",
  );
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    const isSupported =
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window;
    setSupported(isSupported);

    // Check if already subscribed
    if (isSupported) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          setSubscribed(!!sub);
        });
      });
    }
  }, []);

  const subscribe = useCallback(async () => {
    if (!token || !supported) return false;

    const perm = await Notification.requestPermission();
    setPermission(perm);
    if (perm !== "granted") return false;

    // Get VAPID key
    const res = await fetch("/api/push/vapid-key", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { publicKey } = await res.json();

    // Subscribe
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: publicKey,
    });

    // Send to server
    const keys = sub.toJSON().keys!;
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deviceId: getCurrentDeviceUuid(),
        endpoint: sub.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      }),
    });

    setSubscribed(true);
    return true;
  }, [token, supported]);

  const unsubscribe = useCallback(async () => {
    if (!token) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();

    await fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ deviceId: getCurrentDeviceUuid() }),
    });

    setSubscribed(false);
  }, [token]);

  return { supported, permission, subscribed, subscribe, unsubscribe };
}
```

- [ ] **Step 2: Write NotificationSettings page**

Create `hub-app/src/pages/settings/NotificationSettings.tsx`:
```typescript
import { Bell, BellOff } from "lucide-react";
import { FormattedMessage } from "react-intl";
import { usePushNotifications } from "@/hooks/usePushNotifications";

const NOTIFICATION_TYPES = [
  { key: "territory_assignment", labelId: "notifications.territory", defaultLabel: "Territory Assignments" },
  { key: "meeting_update", labelId: "notifications.meeting", defaultLabel: "Meeting Updates" },
  { key: "sync_conflict", labelId: "notifications.conflict", defaultLabel: "Sync Conflicts" },
] as const;

function getTypeEnabled(key: string): boolean {
  return localStorage.getItem(`push-${key}`) !== "false";
}
function setTypeEnabled(key: string, enabled: boolean): void {
  localStorage.setItem(`push-${key}`, String(enabled));
}

export function NotificationSettings() {
  const { supported, permission, subscribed, subscribe, unsubscribe } = usePushNotifications();

  if (!supported) {
    return (
      <div className="p-4 text-sm text-[var(--text-muted)]">
        <FormattedMessage id="notifications.unsupported" defaultMessage="Push notifications are not supported on this device/browser." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">
        <FormattedMessage id="notifications.title" defaultMessage="Notifications" />
      </h2>

      {/* Master toggle */}
      <div className="flex items-center justify-between p-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-1)]">
        <div className="flex items-center gap-2">
          {subscribed ? <Bell size={16} className="text-amber-400" /> : <BellOff size={16} className="text-[var(--text-muted)]" />}
          <span className="text-sm font-medium">
            <FormattedMessage id="notifications.master" defaultMessage="Push Notifications" />
          </span>
        </div>
        <button
          onClick={() => subscribed ? unsubscribe() : subscribe()}
          className={`px-3 py-1 text-xs font-semibold rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
            subscribed ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
          }`}
        >
          {subscribed ? "Disable" : "Enable"}
        </button>
      </div>

      {permission === "denied" && (
        <p className="text-xs text-red-400">
          <FormattedMessage id="notifications.denied" defaultMessage="Notifications blocked. Enable in browser settings." />
        </p>
      )}

      {/* Per-type toggles (only when subscribed) */}
      {subscribed && (
        <div className="space-y-1 pl-2">
          {NOTIFICATION_TYPES.map(({ key, labelId, defaultLabel }) => (
            <label key={key} className="flex items-center gap-2 p-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                defaultChecked={getTypeEnabled(key)}
                onChange={(e) => setTypeEnabled(key, e.target.checked)}
                className="accent-amber-500"
              />
              <FormattedMessage id={labelId} defaultMessage={defaultLabel} />
            </label>
          ))}
          <p className="text-[10px] text-[var(--text-muted)] pl-6">
            <FormattedMessage id="notifications.revoke.always" defaultMessage="Device revocation alerts are always enabled." />
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add service worker push handler**

Add push event handling to the service worker. Since vite-plugin-pwa uses `generateSW` mode, add a custom SW snippet via the `additionalManifestEntries` or switch to `injectManifest` mode. The simplest approach: create `hub-app/src/sw-custom.ts` and configure vite-plugin-pwa with `injectManifest` + `swSrc`:

```javascript
self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? "Hubport", {
      body: data.body ?? "",
      icon: "/icons/icon-192x192.png",
      data: { url: data.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(clients.openWindow(url));
});
```

- [ ] **Step 4: Verify build**

Run: `npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add hub-app/src/hooks/usePushNotifications.ts hub-app/src/pages/settings/NotificationSettings.tsx hub-app/src/sw-custom.ts
git commit -m "feat: add push notification hook, settings page, and SW push handler"
```

---

## Chunk 5: Integration + Build + Deploy

### Task 18: Integration — wire device registration into auth flow

**Files:**
- Modify: `hub-app/src/App.tsx` or create `hub-app/src/providers/OfflineProvider.tsx`

- [ ] **Step 1: Create OfflineProvider**

Create `hub-app/src/providers/OfflineProvider.tsx`:
```typescript
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/auth/useAuth";
import {
  registerDevice,
  checkDeviceStatus,
  getEncryptionSalt,
  deriveDeviceKey,
  clearDeviceIdentity,
  hasDeviceRegistration,
} from "@/lib/device-manager";
import { initOfflineDB, wipeOfflineData } from "@/lib/offline-db";
import { fullSync, requestPersistence } from "@/lib/sync-engine";

interface OfflineState {
  ready: boolean;
  deviceId: string | null;
  error: string | null;
}

const OfflineContext = createContext<OfflineState>({ ready: false, deviceId: null, error: null });

export function useOffline() {
  return useContext(OfflineContext);
}

export function OfflineProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const token = user?.access_token ?? null;
  const sub = user?.profile?.sub ?? null;
  const tenantId = (user?.profile as any)?.tenant_id ?? process.env.VITE_TENANT_ID ?? "";

  const [state, setState] = useState<OfflineState>({ ready: false, deviceId: null, error: null });

  useEffect(() => {
    if (!token || !sub) return;
    let cancelled = false;

    async function init() {
      try {
        // 1. Register device (or re-register)
        const device = await registerDevice(token!);

        // 2. Check if revoked
        if (device.status === "revoked") {
          await wipeOfflineData();
          clearDeviceIdentity();
          setState({ ready: false, deviceId: null, error: "Device revoked. Please re-login." });
          return;
        }

        // 3. Derive encryption key from sub + salt
        const key = await deriveDeviceKey(sub!, device.encSalt);

        // 4. Init Dexie with encryption
        initOfflineDB(tenantId, key);

        // 5. Request persistent storage (iOS eviction protection)
        await requestPersistence();

        if (!cancelled) {
          setState({ ready: true, deviceId: device.id, error: null });

          // 6. Auto-sync on init
          fullSync(token!, device.id).catch(console.error);
        }
      } catch (err) {
        console.error("Offline init failed:", err);
        if (!cancelled) {
          setState({ ready: false, deviceId: null, error: "Offline init failed" });
        }
      }
    }

    init();
    return () => { cancelled = true; };
  }, [token, sub, tenantId]);

  return (
    <OfflineContext.Provider value={state}>
      {children}
    </OfflineContext.Provider>
  );
}
```

- [ ] **Step 2: Wrap App with OfflineProvider**

In `hub-app/src/App.tsx`, wrap authenticated content with `<OfflineProvider>`.

- [ ] **Step 3: Verify build**

Run: `npm run build --workspace=hub-app && npm run build --workspace=hub-api`
Expected: Both builds succeed

- [ ] **Step 4: Commit**

```bash
git add hub-app/src/providers/OfflineProvider.tsx hub-app/src/App.tsx
git commit -m "feat: add OfflineProvider — device registration + key derivation on auth"
```

---

### Task 19: Full build + Docker push

- [ ] **Step 1: Run all tests**

Run: `cd hub-api && npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Build both workspaces**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-api && npm run build --workspace=hub-app`
Expected: Both succeed

- [ ] **Step 3: Bump version**

Update `package.json` version to next CalVer.

- [ ] **Step 4: Docker build + push**

Run: `docker buildx build --platform linux/amd64,linux/arm64 -t ghcr.io/itunified-io/hubport.cloud:<version> -t ghcr.io/itunified-io/hubport.cloud:latest --push .`
Expected: Push succeeds

- [ ] **Step 5: Clean up Docker**

Run: `docker image prune -f && docker buildx prune --keep-storage=2GB -f`

- [ ] **Step 6: Update CHANGELOG.md**

Add new CalVer entry to `CHANGELOG.md` listing all PWA offline features added in this release.

- [ ] **Step 7: Commit and tag**

```bash
git add hub-api/ hub-app/ package.json package-lock.json CHANGELOG.md
git commit -m "feat: PWA offline mode, encryption, device management, push notifications"
```

Tag with current CalVer (e.g., `v2026.04.XX.Y`) and push:
```bash
git tag -a v<version> -m "v<version>: PWA offline + encryption + device management"
git push origin --tags
```

---

### Task 20: Prisma db push on tenant

- [ ] **Step 1: Pull and restart tenant container**

After pulling the new image, the container runs `prisma db push` on startup which applies the new `Device`, `PushSubscription` models and `syncVersion`/`deletedAt` columns.

- [ ] **Step 2: Verify via Settings → Devices**

Navigate to the app, check that device registration happens automatically and the "My Devices" page shows the current device.

- [ ] **Step 3: Test offline mode**

1. Open app, verify sync completes (SyncStatusBar shows green cloud)
2. Toggle airplane mode / disconnect
3. Navigate through territories, addresses — data should load from Dexie
4. Log a visit offline
5. Reconnect — pending change should auto-push
6. Verify the visit appears in the server data

- [ ] **Step 4: Test device limit**

Register 3 devices, try a 4th — should show "Remove a device" dialog.

- [ ] **Step 5: Test admin revoke**

Admin revokes a device → next app open on that device shows revocation message and wipes data.
