# Field Work Mode: GPS + Quick-Action Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mobile-first field work mode with GPS location on map, one-tap visit logging, proximity-sorted address list, location sharing within field groups, and overseer dashboard.

**Architecture:** Extends existing `CampaignFieldGroup` + `LocationShare` Prisma models with heading/accuracy/joinCode fields. Shared React components (`useGpsTracker`, `MyLocationMarker`, `QuickActionBar`, `ProximityList`, `BottomSheet`) rendered in device-appropriate layouts — full-screen map with bottom sheet on mobile, enhanced sidebar on desktop. HTTP polling for location updates (existing pattern). 2 new permissions only; rest reuses existing RBAC.

**Tech Stack:** React 18, MapLibre GL JS (custom HTML Markers), Geolocation API, DeviceOrientationEvent, Prisma/PostgreSQL, Fastify, TypeBox schemas, IndexedDB (offline queue)

**Spec:** `docs/superpowers/specs/2026-04-01-field-work-gps-quickaction-design.md`

---

## Chunk 1: Backend (Schema + Permissions + Endpoints)

### Task 1: Prisma Schema Migration

**Files:**
- Modify: `hub-api/prisma/schema.prisma`

- [ ] **Step 1: Add fields to LocationShare model**

In `hub-api/prisma/schema.prisma`, add two new fields to the `LocationShare` model (after `lastLongitude`):

```prisma
model LocationShare {
  // ... existing fields ...
  lastLatitude   Float?            /// Cleared on deactivation
  lastLongitude  Float?            /// Cleared on deactivation
  heading        Float?            /// Compass heading in degrees (0-360)
  accuracy       Float?            /// GPS accuracy in meters
  // ... rest of existing fields ...
}
```

- [ ] **Step 2: Add joinCode to CampaignFieldGroup model**

In the same file, add `joinCode` to `CampaignFieldGroup` (after `notes`):

```prisma
model CampaignFieldGroup {
  // ... existing fields ...
  notes           String?
  joinCode        String?          /// 6-char alphanumeric join code, unique while active
  createdAt       DateTime         @default(now())
  // ... rest ...
}
```

- [ ] **Step 3: Run Prisma db push**

```bash
cd hub-api && npx prisma db push --accept-data-loss
```

Expected: schema changes applied without errors. The `--accept-data-loss` is safe here since we're only adding nullable columns.

- [ ] **Step 4: Generate Prisma client**

```bash
cd hub-api && npx prisma generate
```

Expected: Prisma Client generated successfully.

- [ ] **Step 5: Commit**

```bash
git add hub-api/prisma/schema.prisma
git commit -m "feat: add heading/accuracy to LocationShare, joinCode to CampaignFieldGroup"
```

---

### Task 2: Add New Permissions

**Files:**
- Modify: `hub-api/src/lib/permissions.ts`

- [ ] **Step 1: Add FIELD_WORK_GPS and FIELD_WORK_OVERSEER permission keys**

In `hub-api/src/lib/permissions.ts`, add after the existing Field Service section (after line ~126, after `SERVICE_MEETINGS_CONDUCT`):

```typescript
  // Field Work
  FIELD_WORK_GPS: "app:field_work.gps",
  FIELD_WORK_OVERSEER: "app:field_work.overseer",
```

- [ ] **Step 2: Add FIELD_WORK_GPS to publisher BASE_ROLE_PERMISSIONS**

In the `publisher` array of `BASE_ROLE_PERMISSIONS`, add after `SERVICE_MEETINGS_SIGNUP`:

```typescript
    PERMISSIONS.FIELD_WORK_GPS,
```

- [ ] **Step 3: Add FIELD_WORK_OVERSEER to elder BASE_ROLE_PERMISSIONS**

In the `elder` array of `BASE_ROLE_PERMISSIONS`, add after the last existing permission:

```typescript
    PERMISSIONS.FIELD_WORK_OVERSEER,
```

- [ ] **Step 4: Add PAGE_PERMISSIONS entry for overseer dashboard**

In `PAGE_PERMISSIONS`, add:

```typescript
  "/territories/field-work": [PERMISSIONS.FIELD_WORK_OVERSEER],
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd hub-api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add hub-api/src/lib/permissions.ts
git commit -m "feat: add FIELD_WORK_GPS and FIELD_WORK_OVERSEER permissions"
```

---

### Task 3: Add FIELD_WORK_OVERSEER to Service Overseer Seed Role

**Files:**
- Modify: `hub-api/src/lib/seed-roles.ts`

- [ ] **Step 1: Add permission to Service Overseer role**

In `hub-api/src/lib/seed-roles.ts`, find the "Service Overseer" role definition and add `P.FIELD_WORK_OVERSEER` to its permissions array (after `P.CHAT_CROSS_TENANT`):

```typescript
      P.CHAT_VIEW, P.CHAT_SEND, P.CHAT_CROSS_TENANT,
      P.FIELD_WORK_OVERSEER,
    ],
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd hub-api && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add hub-api/src/lib/seed-roles.ts
git commit -m "feat: add FIELD_WORK_OVERSEER to Service Overseer seed role"
```

---

### Task 4: Extend Location Update Endpoint with Heading + Accuracy

**Files:**
- Modify: `hub-api/src/routes/field-groups.ts`

- [ ] **Step 1: Add heading and accuracy to LocationShareUpdateBody schema**

In `hub-api/src/routes/field-groups.ts`, modify `LocationShareUpdateBody` (around line 49):

```typescript
const LocationShareUpdateBody = Type.Object({
  publisherId: Type.String({ format: "uuid" }),
  latitude: Type.Number(),
  longitude: Type.Number(),
  heading: Type.Optional(Type.Number({ minimum: 0, maximum: 360 })),
  accuracy: Type.Optional(Type.Number({ minimum: 0 })),
});
```

- [ ] **Step 2: Update the location-share/update handler to persist heading + accuracy**

In the same file, find the `location-share/update` handler. In the `prisma.locationShare.update` call (around line 318), add heading and accuracy to the data:

```typescript
      const updated = await prisma.locationShare.update({
        where: { id: share.id },
        data: {
          lastLatitude: request.body.latitude,
          lastLongitude: request.body.longitude,
          heading: request.body.heading ?? null,
          accuracy: request.body.accuracy ?? null,
          lastUpdatedAt: new Date(),
        },
      });
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd hub-api && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add hub-api/src/routes/field-groups.ts
git commit -m "feat: extend location-share/update with heading and accuracy fields"
```

---

### Task 5: Add Active Locations Overseer Endpoint

**Files:**
- Modify: `hub-api/src/routes/field-groups.ts`

- [ ] **Step 1: Add GET /field-groups/active-locations endpoint**

In `hub-api/src/routes/field-groups.ts`, add this route inside the `fieldGroupRoutes` function, **before** the existing `"/field-groups/:id"` PUT route (to avoid route parameter collision):

```typescript
  // Active locations for overseer dashboard — FIELD_WORK_OVERSEER
  app.get(
    "/field-groups/active-locations",
    {
      preHandler: requirePermission(PERMISSIONS.FIELD_WORK_OVERSEER),
    },
    async (_request, reply) => {
      const activeShares = await prisma.locationShare.findMany({
        where: { isActive: true },
        include: {
          publisher: { select: { id: true, firstName: true, lastName: true } },
          fieldGroup: {
            select: {
              id: true,
              name: true,
              status: true,
              territoryIds: true,
              meetingPointId: true,
            },
          },
        },
      });

      // Filter expired shares
      const now = new Date();
      const valid = activeShares.filter((s) => s.expiresAt > now);

      return reply.send(valid);
    },
  );
```

- [ ] **Step 2: Import FIELD_WORK_OVERSEER permission**

Verify that `PERMISSIONS` import already covers `FIELD_WORK_OVERSEER` (it does — the constant is on the same `PERMISSIONS` object). No import changes needed.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd hub-api && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add hub-api/src/routes/field-groups.ts
git commit -m "feat: add GET /field-groups/active-locations overseer endpoint"
```

---

### Task 6: Add Join Code Endpoints

**Files:**
- Modify: `hub-api/src/routes/field-groups.ts`

- [ ] **Step 1: Add join code generation helper**

At the top of `hub-api/src/routes/field-groups.ts`, after the imports, add:

```typescript
import crypto from "node:crypto";

/** Generate a 6-character alphanumeric join code */
function generateJoinCode(): string {
  return crypto.randomBytes(4).toString("base36").slice(0, 6).toUpperCase();
}
```

- [ ] **Step 2: Add POST /field-groups/:id/generate-code endpoint**

Inside `fieldGroupRoutes`, add after the close handler:

```typescript
  // Generate join code — CAMPAIGNS_CONDUCT
  app.post<{ Params: FieldGroupIdParamsType }>(
    "/field-groups/:id/generate-code",
    {
      preHandler: requirePermission(PERMISSIONS.CAMPAIGNS_CONDUCT),
      schema: { params: FieldGroupIdParams },
    },
    async (request, reply) => {
      const fg = await prisma.campaignFieldGroup.findUnique({
        where: { id: request.params.id },
      });
      if (!fg) {
        return reply.code(404).send({ error: "Field group not found" });
      }
      if (fg.status === "closed") {
        return reply.code(409).send({
          error: "Conflict",
          message: "Cannot generate code for closed group",
        });
      }

      // Generate unique code (retry on collision)
      let code: string;
      let attempts = 0;
      do {
        code = generateJoinCode();
        const existing = await prisma.campaignFieldGroup.findFirst({
          where: { joinCode: code, status: { not: "closed" } },
        });
        if (!existing) break;
        attempts++;
      } while (attempts < 5);

      const updated = await prisma.campaignFieldGroup.update({
        where: { id: request.params.id },
        data: { joinCode: code },
      });
      return reply.send({ joinCode: updated.joinCode });
    },
  );
```

- [ ] **Step 3: Add JoinByCodeBody schema and POST /field-groups/join endpoint**

Add the schema near the other schemas:

```typescript
const JoinByCodeBody = Type.Object({
  code: Type.String({ minLength: 6, maxLength: 6 }),
  publisherId: Type.String({ format: "uuid" }),
});
type JoinByCodeBodyType = Static<typeof JoinByCodeBody>;
```

Add the route inside `fieldGroupRoutes`, **before** the `"/field-groups/:id"` routes:

```typescript
  // Join field group by code — CAMPAIGNS_ASSIST
  app.post<{ Body: JoinByCodeBodyType }>(
    "/field-groups/join",
    {
      preHandler: requireAnyPermission(
        PERMISSIONS.CAMPAIGNS_ASSIST,
        PERMISSIONS.CAMPAIGNS_CONDUCT,
      ),
      schema: { body: JoinByCodeBody },
    },
    async (request, reply) => {
      const fg = await prisma.campaignFieldGroup.findFirst({
        where: {
          joinCode: request.body.code.toUpperCase(),
          status: { not: "closed" },
        },
      });
      if (!fg) {
        return reply.code(404).send({ error: "Invalid or expired join code" });
      }

      // Add publisher to memberIds if not already present
      const memberIds = fg.memberIds ?? [];
      if (!memberIds.includes(request.body.publisherId)) {
        await prisma.campaignFieldGroup.update({
          where: { id: fg.id },
          data: { memberIds: [...memberIds, request.body.publisherId] },
        });
      }

      return reply.send(fg);
    },
  );
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd hub-api && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add hub-api/src/routes/field-groups.ts
git commit -m "feat: add join code generation and join-by-code endpoints"
```

---

### Task 7: Add Auto-Timeout Cleanup for Stale Field Groups

**Files:**
- Modify: `hub-api/src/routes/field-groups.ts`

- [ ] **Step 1: Register cleanup interval at end of fieldGroupRoutes**

At the end of `fieldGroupRoutes` (before the closing `}`), add:

```typescript
  // Auto-close stale field groups (in_field > 4 hours)
  const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  const MAX_FIELD_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours

  const cleanupTimer = setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - MAX_FIELD_DURATION_MS);
      const stale = await prisma.campaignFieldGroup.findMany({
        where: { status: "in_field", startedAt: { lt: cutoff } },
      });

      for (const fg of stale) {
        await prisma.$transaction(async (tx) => {
          await tx.locationShare.updateMany({
            where: { fieldGroupId: fg.id, isActive: true },
            data: { isActive: false, lastLatitude: null, lastLongitude: null },
          });
          await tx.campaignFieldGroup.update({
            where: { id: fg.id },
            data: { status: "closed", closedAt: new Date() },
          });
        });
        app.log.info(`Auto-closed stale field group ${fg.id}`);
      }
    } catch (err) {
      app.log.error(err, "Field group cleanup failed");
    }
  }, CLEANUP_INTERVAL_MS);

  app.addHook("onClose", () => clearInterval(cleanupTimer));
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd hub-api && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add hub-api/src/routes/field-groups.ts
git commit -m "feat: add auto-timeout cleanup for stale field groups (4h max)"
```

---

## Chunk 2: Frontend Core Components (GPS Hook + Map Marker + Quick Actions)

### Task 8: Create useGpsTracker Hook

**Files:**
- Create: `hub-app/src/hooks/useGpsTracker.ts`

- [ ] **Step 1: Create the hook file**

Create `hub-app/src/hooks/useGpsTracker.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from "react";

export interface GpsState {
  lat: number | null;
  lng: number | null;
  heading: number | null;
  accuracy: number | null;
  speed: number | null;
  active: boolean;
  error: string | null;
  toggle: () => void;
}

/**
 * GPS position + compass heading tracker.
 *
 * Uses navigator.geolocation.watchPosition with high accuracy.
 * Heading from DeviceOrientationEvent (mobile compass) with fallback
 * to position-delta heading when speed > 1 m/s.
 */
export function useGpsTracker(): GpsState {
  const [active, setActive] = useState(false);
  const [position, setPosition] = useState<{
    lat: number | null;
    lng: number | null;
    accuracy: number | null;
    speed: number | null;
  }>({ lat: null, lng: null, accuracy: null, speed: null });
  const [heading, setHeading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const prevPosRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const headingThrottleRef = useRef<number>(0);

  // Position watcher
  useEffect(() => {
    if (!active) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    if (!navigator.geolocation) {
      setError("Geolocation not supported");
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy, speed } = pos.coords;
        setPosition({ lat: latitude, lng: longitude, accuracy, speed });
        setError(null);

        // Fallback heading from position delta when speed > 1 m/s
        const now = Date.now();
        if (prevPosRef.current && speed && speed > 1) {
          const dLng = longitude - prevPosRef.current.lng;
          const dLat = latitude - prevPosRef.current.lat;
          const angle = (Math.atan2(dLng, dLat) * 180) / Math.PI;
          setHeading((h) => {
            // Only use delta heading if no compass heading recently
            if (now - headingThrottleRef.current > 2000) {
              return (angle + 360) % 360;
            }
            return h;
          });
        }
        prevPosRef.current = { lat: latitude, lng: longitude, time: now };
      },
      (err) => {
        setError(err.message);
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 },
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [active]);

  // Compass heading (DeviceOrientationEvent)
  useEffect(() => {
    if (!active) return;

    function handleOrientation(e: DeviceOrientationEvent) {
      const now = Date.now();
      // Throttle to 500ms
      if (now - headingThrottleRef.current < 500) return;
      headingThrottleRef.current = now;

      // iOS: webkitCompassHeading (degrees from north, 0-360)
      // Android: alpha (degrees, but reversed)
      const evt = e as DeviceOrientationEvent & { webkitCompassHeading?: number };
      if (typeof evt.webkitCompassHeading === "number") {
        setHeading(evt.webkitCompassHeading);
      } else if (typeof e.alpha === "number") {
        setHeading((360 - e.alpha) % 360);
      }
    }

    window.addEventListener("deviceorientation", handleOrientation, true);
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation, true);
    };
  }, [active]);

  const toggle = useCallback(() => {
    setActive((a) => !a);
    setError(null);
  }, []);

  return {
    lat: position.lat,
    lng: position.lng,
    heading,
    accuracy: position.accuracy,
    speed: position.speed,
    active,
    error,
    toggle,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd hub-app && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/hooks/useGpsTracker.ts
git commit -m "feat: create useGpsTracker hook with compass heading + position tracking"
```

---

### Task 9: Create MyLocationMarker Component

**Files:**
- Create: `hub-app/src/components/map/MyLocationMarker.tsx`

- [ ] **Step 1: Create the marker component**

Create `hub-app/src/components/map/MyLocationMarker.tsx`:

```tsx
import { useEffect, useRef } from "react";
import type { MapInstance } from "../../hooks/useMapLibre";

interface MyLocationMarkerProps {
  map: MapInstance | null;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  accuracy: number | null;
  visible: boolean;
}

/**
 * Apple Maps-style blue dot with heading cone and accuracy circle.
 * Uses MapLibre custom HTML Marker (not GeoJSON source) to avoid
 * full layer re-render on every GPS tick.
 */
export function MyLocationMarker({
  map,
  lat,
  lng,
  heading,
  accuracy,
  visible,
}: MyLocationMarkerProps) {
  const markerRef = useRef<unknown>(null);
  const elRef = useRef<HTMLDivElement | null>(null);

  // Create / update marker
  useEffect(() => {
    if (!map || lat == null || lng == null || !visible) {
      // Remove marker if hidden
      if (markerRef.current) {
        (markerRef.current as { remove: () => void }).remove();
        markerRef.current = null;
      }
      return;
    }

    async function initMarker() {
      if (!map || lat == null || lng == null) return;

      const maplibregl = await import("maplibre-gl");

      if (!elRef.current) {
        // Build DOM elements safely (no innerHTML)
        const el = document.createElement("div");
        el.className = "my-location-marker";

        const accuracyCircle = document.createElement("div");
        accuracyCircle.className = "accuracy-circle";

        const headingCone = document.createElement("div");
        headingCone.className = "heading-cone";

        const dotOuter = document.createElement("div");
        dotOuter.className = "dot-outer";

        const dotInner = document.createElement("div");
        dotInner.className = "dot-inner";

        el.appendChild(accuracyCircle);
        el.appendChild(headingCone);
        el.appendChild(dotOuter);
        el.appendChild(dotInner);

        elRef.current = el;
      }

      if (!markerRef.current) {
        const marker = new maplibregl.Marker({ element: elRef.current })
          .setLngLat([lng, lat])
          .addTo(map as unknown as maplibregl.Map);
        markerRef.current = marker;
      } else {
        (markerRef.current as { setLngLat: (pos: [number, number]) => void }).setLngLat([lng, lat]);
      }

      // Update heading cone rotation
      const cone = elRef.current.querySelector(".heading-cone") as HTMLElement | null;
      if (cone) {
        if (heading != null) {
          cone.style.transform = `rotate(${heading}deg)`;
          cone.style.opacity = "1";
        } else {
          cone.style.opacity = "0";
        }
      }

      // Update accuracy circle size (approximate meters → pixels at current zoom)
      const circle = elRef.current.querySelector(".accuracy-circle") as HTMLElement | null;
      if (circle && accuracy != null) {
        // Rough conversion: at zoom 16, 1m ≈ 1.5px
        const zoom = (map as unknown as { getZoom: () => number }).getZoom?.() ?? 16;
        const metersPerPixel = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * Math.pow(2, zoom));
        const radiusPx = Math.min(Math.max(accuracy / metersPerPixel, 14), 200);
        circle.style.width = `${radiusPx * 2}px`;
        circle.style.height = `${radiusPx * 2}px`;
      }
    }

    initMarker();
  }, [map, lat, lng, heading, accuracy, visible]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (markerRef.current) {
        (markerRef.current as { remove: () => void }).remove();
        markerRef.current = null;
      }
    };
  }, []);

  return null; // Renders via MapLibre marker, not React DOM
}

/**
 * CSS for MyLocationMarker. Inject once via a <style> tag or import as CSS module.
 */
export const MY_LOCATION_MARKER_CSS = `
.my-location-marker {
  position: relative;
  width: 44px;
  height: 44px;
}
.my-location-marker .dot-outer {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 18px;
  height: 18px;
  margin: -9px 0 0 -9px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 0 6px rgba(59, 130, 246, 0.5);
}
.my-location-marker .dot-inner {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;
  border-radius: 50%;
  background: #3b82f6;
}
.my-location-marker .heading-cone {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  margin-left: -12px;
  margin-top: -40px;
  border-left: 12px solid transparent;
  border-right: 12px solid transparent;
  border-bottom: 32px solid rgba(59, 130, 246, 0.12);
  transform-origin: center bottom;
  transition: transform 0.3s ease, opacity 0.3s ease;
  opacity: 0;
}
.my-location-marker .accuracy-circle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.15);
  animation: pulse-accuracy 3s ease-in-out infinite;
  pointer-events: none;
}
@keyframes pulse-accuracy {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
`;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd hub-app && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/components/map/MyLocationMarker.tsx
git commit -m "feat: create MyLocationMarker with blue dot, heading cone, accuracy circle"
```

---

### Task 10: Create QuickActionBar Component

**Files:**
- Create: `hub-app/src/components/territory/QuickActionBar.tsx`

- [ ] **Step 1: Create the component**

Create `hub-app/src/components/territory/QuickActionBar.tsx`:

```tsx
import { useState } from "react";
import { useAuth } from "../../lib/auth";
import { logVisit, type VisitOutcome } from "../../lib/territory-api";

interface QuickActionBarProps {
  territoryId: string;
  addressId: string;
  onLogged?: (outcome: VisitOutcome) => void;
  compact?: boolean;
}

const OUTCOMES: {
  label: string;
  outcome: VisitOutcome;
  icon: string;
  color: string;
  bgColor: string;
}[] = [
  { label: "Contacted", outcome: "contacted", icon: "\u2713", color: "#16a34a", bgColor: "#dcfce7" },
  { label: "Not Home", outcome: "not_at_home", icon: "\ud83c\udfe0", color: "#d97706", bgColor: "#fef3c7" },
  { label: "DNC", outcome: "do_not_call", icon: "\ud83d\udeab", color: "#dc2626", bgColor: "#fee2e2" },
  { label: "Letter", outcome: "letter_sent", icon: "\u2709\ufe0f", color: "#2563eb", bgColor: "#dbeafe" },
  { label: "Moved", outcome: "moved", icon: "\u2192", color: "#6b7280", bgColor: "#f3f4f6" },
  { label: "Phone", outcome: "phone_attempted", icon: "\ud83d\udcde", color: "#2563eb", bgColor: "#dbeafe" },
];

/**
 * One-tap visit outcome buttons. Fires immediately on tap — no confirmation.
 * Shows brief toast on success.
 */
export function QuickActionBar({
  territoryId,
  addressId,
  onLogged,
  compact = false,
}: QuickActionBarProps) {
  const { token } = useAuth();
  const [loading, setLoading] = useState<VisitOutcome | null>(null);

  async function handleTap(outcome: VisitOutcome) {
    if (loading || !token) return;
    setLoading(outcome);
    try {
      await logVisit(territoryId, addressId, { outcome }, token);
      onLogged?.(outcome);
    } catch (err) {
      console.error("Quick action failed:", err);
    } finally {
      setLoading(null);
    }
  }

  const items = compact ? OUTCOMES.slice(0, 3) : OUTCOMES;

  return (
    <div style={{
      display: "flex",
      gap: compact ? "4px" : "8px",
      flexWrap: "wrap",
      justifyContent: "center",
    }}>
      {items.map((o) => (
        <button
          key={o.outcome}
          onClick={() => handleTap(o.outcome)}
          disabled={loading !== null}
          style={{
            display: "flex",
            flexDirection: compact ? "row" : "column",
            alignItems: "center",
            gap: "2px",
            padding: compact ? "4px 8px" : "8px 12px",
            border: "1px solid transparent",
            borderRadius: "8px",
            background: loading === o.outcome ? o.color : o.bgColor,
            color: loading === o.outcome ? "white" : o.color,
            cursor: loading ? "wait" : "pointer",
            fontSize: compact ? "11px" : "12px",
            fontWeight: 600,
            transition: "all 0.15s ease",
            opacity: loading && loading !== o.outcome ? 0.5 : 1,
            minWidth: compact ? "auto" : "60px",
          }}
        >
          <span style={{ fontSize: compact ? "14px" : "18px" }}>{o.icon}</span>
          {!compact && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd hub-app && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/components/territory/QuickActionBar.tsx
git commit -m "feat: create QuickActionBar with one-tap visit outcome buttons"
```

---

## Chunk 3: Proximity List + Bottom Sheet + Field Work Mode

### Task 11: Create ProximityList Component

**Files:**
- Create: `hub-app/src/components/territory/ProximityList.tsx`

- [ ] **Step 1: Create the proximity list component**

Create `hub-app/src/components/territory/ProximityList.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { QuickActionBar } from "./QuickActionBar";
import type { VisitOutcome } from "../../lib/territory-api";

interface Address {
  addressId: string;
  streetAddress: string | null;
  status: string;
  lastVisitDate: string | null;
  latitude: number;
  longitude: number;
}

interface ProximityListProps {
  addresses: Address[];
  territoryId: string;
  userLat: number | null;
  userLng: number | null;
  onAddressSelect?: (addressId: string) => void;
  onVisitLogged?: (addressId: string, outcome: VisitOutcome) => void;
}

/** Haversine distance in meters */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

/**
 * Address list sorted by GPS proximity. Re-sorts every 5 seconds.
 * Shows inline quick-action mini-buttons per row.
 */
export function ProximityList({
  addresses,
  territoryId,
  userLat,
  userLng,
  onAddressSelect,
  onVisitLogged,
}: ProximityListProps) {
  const [frozen, setFrozen] = useState(false);
  const [sortMode, setSortMode] = useState<"distance" | "street">("distance");
  const [tick, setTick] = useState(0);
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;

  // Re-sort tick every 5s
  useEffect(() => {
    const timer = setInterval(() => {
      if (!frozenRef.current) setTick((t) => t + 1);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const sorted = useMemo(() => {
    const withDist = addresses.map((a) => ({
      ...a,
      distance:
        userLat != null && userLng != null
          ? haversineM(userLat, userLng, a.latitude, a.longitude)
          : Infinity,
    }));

    if (sortMode === "distance") {
      withDist.sort((a, b) => a.distance - b.distance);
    } else {
      withDist.sort((a, b) =>
        (a.streetAddress ?? "").localeCompare(b.streetAddress ?? ""),
      );
    }
    return withDist;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses, userLat, userLng, sortMode, tick]);

  const hasGps = userLat != null && userLng != null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px",
        borderBottom: "1px solid var(--border, #e5e7eb)",
        fontSize: "13px",
      }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            onClick={() => setSortMode(sortMode === "distance" ? "street" : "distance")}
            style={{
              background: "none",
              border: "1px solid var(--border, #d1d5db)",
              borderRadius: "4px",
              padding: "2px 8px",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            {sortMode === "distance" ? "\ud83d\udccd Distance" : "\ud83c\udfe0 Street"}
          </button>
          {sortMode === "distance" && hasGps && (
            <button
              onClick={() => setFrozen((f) => !f)}
              style={{
                background: frozen ? "#fef3c7" : "none",
                border: "1px solid var(--border, #d1d5db)",
                borderRadius: "4px",
                padding: "2px 8px",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              {frozen ? "\ud83d\udd12 Frozen" : "\ud83d\udd13 Live"}
            </button>
          )}
        </div>
        <span style={{ color: "var(--text-muted, #6b7280)" }}>
          {addresses.length} addresses
        </span>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {sorted.map((addr) => {
          const isDone = addr.status === "contacted" || addr.lastVisitDate;
          const isDnc = addr.status === "do_not_call";

          return (
            <div
              key={addr.addressId}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "8px 12px",
                borderBottom: "1px solid var(--border, #f3f4f6)",
                borderLeft: isDnc
                  ? "3px solid #dc2626"
                  : isDone
                    ? "3px solid #16a34a"
                    : "3px solid transparent",
                opacity: isDnc ? 0.5 : 1,
                cursor: "pointer",
                gap: "8px",
              }}
              onClick={() => onAddressSelect?.(addr.addressId)}
            >
              {/* Address info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: "14px",
                  fontWeight: 500,
                  textDecoration: isDone ? "line-through" : "none",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                  {addr.streetAddress ?? "Unknown"}
                </div>
                {hasGps && addr.distance < Infinity && (
                  <div style={{ fontSize: "11px", color: "var(--text-muted, #9ca3af)" }}>
                    {formatDistance(addr.distance)}
                  </div>
                )}
              </div>

              {/* Quick actions (hidden for DNC / done) */}
              {!isDnc && !isDone && (
                <div onClick={(e) => e.stopPropagation()}>
                  <QuickActionBar
                    territoryId={territoryId}
                    addressId={addr.addressId}
                    compact
                    onLogged={(outcome) => onVisitLogged?.(addr.addressId, outcome)}
                  />
                </div>
              )}

              {isDone && (
                <span style={{ fontSize: "11px", color: "#16a34a", fontWeight: 600 }}>
                  Done
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd hub-app && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/components/territory/ProximityList.tsx
git commit -m "feat: create ProximityList with Haversine GPS sort and inline quick actions"
```

---

### Task 12: Create BottomSheet Component

**Files:**
- Create: `hub-app/src/components/territory/BottomSheet.tsx`

- [ ] **Step 1: Create the bottom sheet component**

Create `hub-app/src/components/territory/BottomSheet.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";

type SheetState = "collapsed" | "peek" | "expanded";

interface BottomSheetProps {
  state: SheetState;
  onStateChange: (state: SheetState) => void;
  /** Content shown in collapsed bar (60px) */
  collapsedContent?: React.ReactNode;
  /** Content shown in peek mode (~180px) */
  peekContent?: React.ReactNode;
  /** Content shown in expanded mode (60vh) */
  expandedContent?: React.ReactNode;
}

const HEIGHTS: Record<SheetState, string> = {
  collapsed: "60px",
  peek: "180px",
  expanded: "60vh",
};

/**
 * Mobile bottom sheet with 3 states and drag gestures.
 */
export function BottomSheet({
  state,
  onStateChange,
  collapsedContent,
  peekContent,
  expandedContent,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number | null>(null);
  const dragStartState = useRef<SheetState>(state);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      dragStartY.current = e.touches[0].clientY;
      dragStartState.current = state;
    },
    [state],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (dragStartY.current == null) return;
      const deltaY = dragStartY.current - e.changedTouches[0].clientY;
      dragStartY.current = null;

      const threshold = 40;

      if (deltaY > threshold) {
        // Swipe up
        if (dragStartState.current === "collapsed") onStateChange("peek");
        else if (dragStartState.current === "peek") onStateChange("expanded");
      } else if (deltaY < -threshold) {
        // Swipe down
        if (dragStartState.current === "expanded") onStateChange("peek");
        else if (dragStartState.current === "peek") onStateChange("collapsed");
      }
    },
    [onStateChange],
  );

  return (
    <div
      ref={sheetRef}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: HEIGHTS[state],
        background: "var(--bg-surface, white)",
        borderTopLeftRadius: "16px",
        borderTopRightRadius: "16px",
        boxShadow: "0 -4px 20px rgba(0,0,0,0.15)",
        transition: "height 0.3s ease",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Drag handle */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          padding: "8px 0 4px",
          cursor: "grab",
        }}
      >
        <div
          style={{
            width: "36px",
            height: "4px",
            borderRadius: "2px",
            background: "var(--border, #d1d5db)",
          }}
        />
      </div>

      {/* Collapsed bar — always visible */}
      <div style={{ padding: "0 16px", minHeight: "36px", flexShrink: 0 }}>
        {collapsedContent}
      </div>

      {/* Peek content */}
      {(state === "peek" || state === "expanded") && (
        <div style={{ padding: "8px 16px", flexShrink: 0 }}>
          {peekContent}
        </div>
      )}

      {/* Expanded content */}
      {state === "expanded" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
          {expandedContent}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd hub-app && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/components/territory/BottomSheet.tsx
git commit -m "feat: create BottomSheet component with 3 states and drag gestures"
```

---

### Task 13: Add Field Work API Functions to territory-api.ts

**Files:**
- Modify: `hub-app/src/lib/territory-api.ts`

- [ ] **Step 1: Add field work types and API functions**

At the end of `hub-app/src/lib/territory-api.ts`, add:

```typescript
// ─── Field Work / Location Sharing API ─────────────────────────────

export interface LocationShareData {
  id: string;
  fieldGroupId: string;
  publisherId: string;
  lastLatitude: number | null;
  lastLongitude: number | null;
  heading: number | null;
  accuracy: number | null;
  isActive: boolean;
  expiresAt: string;
  publisher?: { id: string; firstName: string; lastName: string };
  fieldGroup?: {
    id: string;
    name: string | null;
    status: string;
    territoryIds: string[];
  };
}

export async function updateLocationShare(
  fieldGroupId: string,
  data: {
    publisherId: string;
    latitude: number;
    longitude: number;
    heading?: number | null;
    accuracy?: number | null;
  },
  token: string,
): Promise<LocationShareData> {
  const res = await fetch(
    `${getApiUrl()}/field-groups/${fieldGroupId}/location-share/update`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    },
  );
  if (!res.ok) throw new Error(`Location update failed: ${res.status}`);
  return res.json();
}

export async function getActiveLocations(
  token: string,
): Promise<LocationShareData[]> {
  const res = await fetch(`${getApiUrl()}/field-groups/active-locations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Active locations fetch failed: ${res.status}`);
  return res.json();
}

export async function generateJoinCode(
  fieldGroupId: string,
  token: string,
): Promise<{ joinCode: string }> {
  const res = await fetch(
    `${getApiUrl()}/field-groups/${fieldGroupId}/generate-code`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) throw new Error(`Generate code failed: ${res.status}`);
  return res.json();
}

export async function joinFieldGroupByCode(
  code: string,
  publisherId: string,
  token: string,
): Promise<unknown> {
  const res = await fetch(`${getApiUrl()}/field-groups/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code, publisherId }),
  });
  if (!res.ok) throw new Error(`Join by code failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd hub-app && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/lib/territory-api.ts
git commit -m "feat: add field work location sharing API functions to territory-api"
```

---

### Task 14: Create FieldWorkMode Page (Mobile)

**Files:**
- Create: `hub-app/src/pages/territories/FieldWorkMode.tsx`

- [ ] **Step 1: Create the field work mode page**

Create `hub-app/src/pages/territories/FieldWorkMode.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { useGpsTracker } from "../../hooks/useGpsTracker";
import { useMapLibre } from "../../hooks/useMapLibre";
import { MyLocationMarker, MY_LOCATION_MARKER_CSS } from "../../components/map/MyLocationMarker";
import { QuickActionBar } from "../../components/territory/QuickActionBar";
import { ProximityList } from "../../components/territory/ProximityList";
import { BottomSheet } from "../../components/territory/BottomSheet";
import {
  fetchTerritoryById,
  fetchAddresses,
  type VisitOutcome,
} from "../../lib/territory-api";

type SheetState = "collapsed" | "peek" | "expanded";

interface Address {
  addressId: string;
  streetAddress: string | null;
  status: string;
  lastVisitDate: string | null;
  latitude: number;
  longitude: number;
}

export default function FieldWorkMode() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const gps = useGpsTracker();

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const { mapRef, isLoaded } = useMapLibre({
    container: mapContainerRef,
    zoom: 17,
  });

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddr, setSelectedAddr] = useState<Address | null>(null);
  const [sheetState, setSheetState] = useState<SheetState>("collapsed");
  const [territoryName, setTerritoryName] = useState("");

  // Inject marker CSS once
  useEffect(() => {
    const styleId = "my-location-marker-style";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = MY_LOCATION_MARKER_CSS;
      document.head.appendChild(style);
    }
  }, []);

  // Load territory + addresses
  useEffect(() => {
    if (!id || !token) return;
    Promise.all([
      fetchTerritoryById(id, token),
      fetchAddresses(id, token),
    ]).then(([territory, addrs]) => {
      setTerritoryName(territory.name ?? territory.number ?? "");
      setAddresses(addrs as Address[]);
    });
  }, [id, token]);

  // Auto-activate GPS
  useEffect(() => {
    if (!gps.active) gps.toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Center map on first GPS fix
  const centeredRef = useRef(false);
  useEffect(() => {
    if (gps.lat != null && gps.lng != null && !centeredRef.current && mapRef.current) {
      mapRef.current.fitBounds(
        [[gps.lng - 0.002, gps.lat - 0.002], [gps.lng + 0.002, gps.lat + 0.002]],
        { padding: 60 },
      );
      centeredRef.current = true;
    }
  }, [gps.lat, gps.lng, mapRef]);

  const handleAddressSelect = useCallback((addressId: string) => {
    const addr = addresses.find((a) => a.addressId === addressId);
    if (addr) {
      setSelectedAddr(addr);
      setSheetState("peek");
    }
  }, [addresses]);

  const handleVisitLogged = useCallback((addressId: string, outcome: VisitOutcome) => {
    setAddresses((prev) =>
      prev.map((a) =>
        a.addressId === addressId
          ? { ...a, lastVisitDate: new Date().toISOString(), status: outcome === "do_not_call" ? "do_not_call" : a.status }
          : a,
      ),
    );
    // Brief delay then collapse sheet
    setTimeout(() => setSheetState("collapsed"), 800);
  }, []);

  const handleRecenter = useCallback(() => {
    if (gps.lat != null && gps.lng != null && mapRef.current) {
      mapRef.current.fitBounds(
        [[gps.lng - 0.001, gps.lat - 0.001], [gps.lng + 0.001, gps.lat + 0.001]],
        { padding: 60 },
      );
    }
  }, [gps.lat, gps.lng, mapRef]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 900, background: "black" }}>
      {/* Map */}
      <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />

      {/* GPS marker */}
      <MyLocationMarker
        map={mapRef.current}
        lat={gps.lat}
        lng={gps.lng}
        heading={gps.heading}
        accuracy={gps.accuracy}
        visible={gps.active}
      />

      {/* Back button */}
      <button
        onClick={() => navigate(`/territories/${id}`)}
        style={{
          position: "fixed",
          top: "12px",
          left: "12px",
          zIndex: 1001,
          background: "var(--bg-surface, white)",
          border: "none",
          borderRadius: "8px",
          padding: "8px 12px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          cursor: "pointer",
          fontSize: "14px",
          fontWeight: 600,
        }}
      >
        \u2190 {territoryName}
      </button>

      {/* Recenter button */}
      <button
        onClick={handleRecenter}
        style={{
          position: "fixed",
          bottom: sheetState === "collapsed" ? "80px" : sheetState === "peek" ? "200px" : "62vh",
          right: "12px",
          zIndex: 1001,
          background: "var(--bg-surface, white)",
          border: "none",
          borderRadius: "50%",
          width: "44px",
          height: "44px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          cursor: "pointer",
          fontSize: "18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "bottom 0.3s ease",
        }}
      >
        \u2316
      </button>

      {/* Bottom sheet */}
      <BottomSheet
        state={sheetState}
        onStateChange={setSheetState}
        collapsedContent={
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
            <span style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: gps.active ? "#3b82f6" : "#9ca3af",
            }} />
            <span>{gps.active ? "GPS active" : "GPS off"}</span>
            {gps.error && <span style={{ color: "#dc2626" }}>{gps.error}</span>}
          </div>
        }
        peekContent={
          selectedAddr && id ? (
            <div>
              <div style={{ fontWeight: 600, fontSize: "16px", marginBottom: "8px" }}>
                {selectedAddr.streetAddress ?? "Unknown address"}
              </div>
              <QuickActionBar
                territoryId={id}
                addressId={selectedAddr.addressId}
                onLogged={(outcome) => handleVisitLogged(selectedAddr.addressId, outcome)}
              />
            </div>
          ) : null
        }
        expandedContent={
          id ? (
            <ProximityList
              addresses={addresses}
              territoryId={id}
              userLat={gps.lat}
              userLng={gps.lng}
              onAddressSelect={handleAddressSelect}
              onVisitLogged={handleVisitLogged}
            />
          ) : null
        }
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd hub-app && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/pages/territories/FieldWorkMode.tsx
git commit -m "feat: create FieldWorkMode page with full-screen map and bottom sheet"
```

---

## Chunk 4: Desktop Integration + Location Sharing Hook + Overseer Dashboard + Build

### Task 15: Create useLocationSharing Hook

**Files:**
- Create: `hub-app/src/hooks/useLocationSharing.ts`

- [ ] **Step 1: Create the hook**

Create `hub-app/src/hooks/useLocationSharing.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { updateLocationShare } from "../lib/territory-api";
import type { GpsState } from "./useGpsTracker";

interface UseLocationSharingOptions {
  fieldGroupId: string | null;
  publisherId: string | null;
  gps: GpsState;
  /** Polling interval in ms (default: 10000 = 10s) */
  intervalMs?: number;
}

interface UseLocationSharingReturn {
  sharing: boolean;
  error: string | null;
}

/**
 * Polls location updates to the server while GPS is active and
 * the publisher is in a field group with location sharing enabled.
 */
export function useLocationSharing({
  fieldGroupId,
  publisherId,
  gps,
  intervalMs = 10000,
}: UseLocationSharingOptions): UseLocationSharingReturn {
  const { token } = useAuth();
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sendUpdate = useCallback(async () => {
    if (!fieldGroupId || !publisherId || !token || gps.lat == null || gps.lng == null) return;

    try {
      await updateLocationShare(fieldGroupId, {
        publisherId,
        latitude: gps.lat,
        longitude: gps.lng,
        heading: gps.heading,
        accuracy: gps.accuracy,
      }, token);
      setSharing(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
      // 410 = expired
      if (err instanceof Error && err.message.includes("410")) {
        setSharing(false);
      }
    }
  }, [fieldGroupId, publisherId, token, gps.lat, gps.lng, gps.heading, gps.accuracy]);

  useEffect(() => {
    if (!fieldGroupId || !publisherId || !gps.active) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setSharing(false);
      return;
    }

    // Send immediately, then poll
    sendUpdate();
    timerRef.current = setInterval(sendUpdate, intervalMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [fieldGroupId, publisherId, gps.active, intervalMs, sendUpdate]);

  return { sharing, error };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd hub-app && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/hooks/useLocationSharing.ts
git commit -m "feat: create useLocationSharing hook for GPS polling to server"
```

---

### Task 16: Integrate GPS + Quick Actions into TerritoryDetail (Desktop)

**Files:**
- Modify: `hub-app/src/pages/territories/TerritoryDetail.tsx`

- [ ] **Step 1: Read the current TerritoryDetail.tsx**

Read the file to understand its structure and identify insertion points.

- [ ] **Step 2: Add imports**

At the top of `TerritoryDetail.tsx`, add:

```typescript
import { useGpsTracker } from "../../hooks/useGpsTracker";
import { MyLocationMarker, MY_LOCATION_MARKER_CSS } from "../../components/map/MyLocationMarker";
```

- [ ] **Step 3: Add GPS tracker initialization**

Inside the component function, near other hooks:

```typescript
const gps = useGpsTracker();
```

- [ ] **Step 4: Inject marker CSS**

Add a `useEffect` to inject the CSS:

```typescript
useEffect(() => {
  const styleId = "my-location-marker-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = MY_LOCATION_MARKER_CSS;
    document.head.appendChild(style);
  }
}, []);
```

- [ ] **Step 5: Add MyLocationMarker to the map area**

Near where the map is rendered, add the MyLocationMarker component:

```tsx
<MyLocationMarker
  map={mapRef.current}
  lat={gps.lat}
  lng={gps.lng}
  heading={gps.heading}
  accuracy={gps.accuracy}
  visible={gps.active}
/>
```

- [ ] **Step 6: Add GPS toggle button to map toolbar**

Find the map toolbar area and add a "locate me" button:

```tsx
<button
  onClick={gps.toggle}
  title={gps.active ? "Disable GPS" : "Enable GPS"}
  style={{
    background: gps.active ? "#3b82f6" : "var(--bg-surface, white)",
    color: gps.active ? "white" : "inherit",
    border: "1px solid var(--border, #d1d5db)",
    borderRadius: "6px",
    padding: "6px 10px",
    cursor: "pointer",
    fontSize: "14px",
  }}
>
  {gps.active ? "\ud83d\udccd GPS" : "\ud83d\udccd"}
</button>
```

- [ ] **Step 7: Add link to field work mode (mobile)**

Add a button that navigates to field work mode:

```tsx
<button
  onClick={() => navigate(`/territories/${id}/field-work`)}
  style={{
    background: "#3b82f6",
    color: "white",
    border: "none",
    borderRadius: "6px",
    padding: "8px 16px",
    cursor: "pointer",
    fontWeight: 600,
  }}
>
  Field Work Mode
</button>
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd hub-app && npx tsc --noEmit
```

- [ ] **Step 9: Commit**

```bash
git add hub-app/src/pages/territories/TerritoryDetail.tsx
git commit -m "feat: integrate GPS marker and field work mode button into TerritoryDetail"
```

---

### Task 17: Create FieldWorkDashboard Page (Overseer)

**Files:**
- Create: `hub-app/src/pages/territories/FieldWorkDashboard.tsx`

- [ ] **Step 1: Create the dashboard page**

Create `hub-app/src/pages/territories/FieldWorkDashboard.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../lib/auth";
import { useMapLibre, MAP_STYLES } from "../../hooks/useMapLibre";
import { getActiveLocations, type LocationShareData } from "../../lib/territory-api";

/**
 * Overseer dashboard: full-screen map showing all publishers sharing location.
 * Permission-gated: FIELD_WORK_OVERSEER
 */
export default function FieldWorkDashboard() {
  const { token } = useAuth();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const { mapRef, isLoaded } = useMapLibre({
    container: mapContainerRef,
    zoom: 13,
  });

  const [locations, setLocations] = useState<LocationShareData[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Poll active locations every 10s
  useEffect(() => {
    if (!token) return;

    async function fetchLocations() {
      try {
        const data = await getActiveLocations(token!);
        setLocations(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch");
      }
    }

    fetchLocations();
    const timer = setInterval(fetchLocations, 10000);
    return () => clearInterval(timer);
  }, [token]);

  // Render publisher markers on map
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;

    // Remove old markers (re-create on every update for simplicity)
    const existingMarkers = document.querySelectorAll(".overseer-publisher-marker");
    existingMarkers.forEach((el) => el.remove());

    locations.forEach(async (loc) => {
      if (loc.lastLatitude == null || loc.lastLongitude == null) return;

      const maplibregl = await import("maplibre-gl");

      const el = document.createElement("div");
      el.className = "overseer-publisher-marker";
      el.style.cssText =
        "width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.3);";

      // Color by field group (hash to hue)
      const hue = Math.abs(
        loc.fieldGroupId.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 360,
      );
      el.style.background = `hsl(${hue}, 70%, 50%)`;

      el.title = `${loc.publisher?.firstName ?? ""} ${loc.publisher?.lastName ?? ""}`;

      new maplibregl.Marker({ element: el })
        .setLngLat([loc.lastLongitude!, loc.lastLatitude!])
        .addTo(mapRef.current as unknown as maplibregl.Map);
    });
  }, [locations, mapRef, isLoaded]);

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* Map */}
      <div ref={mapContainerRef} style={{ flex: 1 }} />

      {/* Sidebar */}
      <div style={{
        width: "300px",
        borderLeft: "1px solid var(--border, #e5e7eb)",
        overflowY: "auto",
        padding: "16px",
      }}>
        <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "16px" }}>
          Field Work Overview
        </h2>

        {error && (
          <div style={{ color: "#dc2626", marginBottom: "12px", fontSize: "13px" }}>
            {error}
          </div>
        )}

        <div style={{ fontSize: "13px", color: "var(--text-muted, #6b7280)", marginBottom: "16px" }}>
          {locations.length} publisher{locations.length !== 1 ? "s" : ""} sharing
        </div>

        {/* Group by field group */}
        {Object.entries(
          locations.reduce<Record<string, LocationShareData[]>>((acc, loc) => {
            const key = loc.fieldGroup?.name ?? loc.fieldGroupId;
            if (!acc[key]) acc[key] = [];
            acc[key].push(loc);
            return acc;
          }, {}),
        ).map(([groupName, members]) => (
          <div key={groupName} style={{ marginBottom: "16px" }}>
            <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "4px" }}>
              {groupName}
            </div>
            {members.map((m) => (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "4px 0",
                  fontSize: "13px",
                }}
              >
                <span style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: m.isActive ? "#16a34a" : "#9ca3af",
                }} />
                <span>
                  {m.publisher?.firstName} {m.publisher?.lastName}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd hub-app && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/pages/territories/FieldWorkDashboard.tsx
git commit -m "feat: create FieldWorkDashboard overseer page with live publisher map"
```

---

### Task 18: Build, Docker Push, Deploy

- [ ] **Step 1: Build hub-api**

```bash
cd hub-api && npm run build
```

Expected: builds successfully with no errors.

- [ ] **Step 2: Build hub-app**

```bash
cd hub-app && npm run build
```

Expected: builds successfully with no errors.

- [ ] **Step 3: Run Prisma db push on tenant**

Ensure schema changes (heading, accuracy, joinCode) are applied to the tenant database.

- [ ] **Step 4: Docker build and push**

Build the hubport.cloud Docker image and push to GHCR. Use the `/hubport-deploy` skill for the full deploy workflow.

- [ ] **Step 5: Pull and restart tenant container**

On the tenant server, pull the new image and restart.

- [ ] **Step 6: Purge CF cache**

Purge Cloudflare edge cache for the tenant domain to ensure new JS bundle is served.

- [ ] **Step 7: Verify field work mode**

Navigate to a territory detail page on mobile, tap "Field Work Mode", verify:
- GPS blue dot appears on map
- Bottom sheet shows collapsed bar with GPS status
- Tapping an address shows QuickActionBar in peek mode
- One-tap outcomes log visits
- Swiping up shows ProximityList sorted by distance

- [ ] **Step 8: Commit final version bump**

```bash
git add -A
git commit -m "feat: field work mode v1 — GPS, quick actions, proximity list, location sharing"
```
