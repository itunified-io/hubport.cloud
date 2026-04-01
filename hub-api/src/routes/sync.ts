import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";

// ─── Constants ────────────────────────────────────────────────────────

const PAGE_SIZE = 500;
const EPOCH = new Date(0);

// ─── Syncable Tables Config ───────────────────────────────────────────

/**
 * Each entry maps a response table name to:
 * - delegate: Prisma client delegate key
 * - tenantField: field name to filter by tenantId (undefined = no tenantId on table)
 * - timestampField: field used for delta filtering + ordering (most tables use updatedAt;
 *   AddressVisit has no updatedAt so we fall back to visitedAt)
 */
const SYNCABLE_TABLES = [
  { name: "territories",            delegate: "territory",                tenantField: undefined,            timestampField: "updatedAt" },
  { name: "addresses",              delegate: "address",                  tenantField: undefined,            timestampField: "updatedAt" },
  { name: "visits",                 delegate: "addressVisit",             tenantField: undefined,            timestampField: "visitedAt" },
  { name: "assignments",            delegate: "territoryAssignment",      tenantField: undefined,            timestampField: "updatedAt" },
  { name: "publishers",             delegate: "publisher",                tenantField: undefined,            timestampField: "updatedAt" },
  { name: "meetingPoints",          delegate: "fieldServiceMeetingPoint", tenantField: "tenantId" as const,  timestampField: "updatedAt" },
  { name: "campaignMeetingPoints",  delegate: "campaignMeetingPoint",     tenantField: "tenantId" as const,  timestampField: "updatedAt" },
  { name: "meetings",               delegate: "serviceGroupMeeting",      tenantField: "tenantId" as const,  timestampField: "updatedAt" },
  { name: "territoryShares",        delegate: "territoryShare",           tenantField: undefined,            timestampField: "updatedAt" },
] as const;

type TableName = (typeof SYNCABLE_TABLES)[number]["name"];

// ─── Cursor helpers ───────────────────────────────────────────────────

interface SyncCursor {
  tableIndex: number;
  offset: number;
}

function encodeCursor(cursor: SyncCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(encoded: string): SyncCursor | null {
  try {
    const raw = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as SyncCursor).tableIndex === "number" &&
      typeof (parsed as SyncCursor).offset === "number"
    ) {
      return parsed as SyncCursor;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Schemas ──────────────────────────────────────────────────────────

const PullQuerystring = Type.Object({
  since:  Type.Optional(Type.String()),
  cursor: Type.Optional(Type.String()),
});
type PullQuerystringType = Static<typeof PullQuerystring>;

const ChangeItem = Type.Object({
  table:     Type.String(),
  recordId:  Type.String(),
  operation: Type.Union([
    Type.Literal("create"),
    Type.Literal("update"),
    Type.Literal("delete"),
  ]),
  version: Type.Optional(Type.Number()),
  payload: Type.Optional(Type.Any()),
  force:   Type.Optional(Type.Boolean()),
});
type ChangeItemType = Static<typeof ChangeItem>;

const PushBody = Type.Object({
  deviceId: Type.String(),
  changes:  Type.Array(ChangeItem),
});
type PushBodyType = Static<typeof PushBody>;

// ─── Route Plugin ─────────────────────────────────────────────────────

export async function syncRoutes(app: FastifyInstance): Promise<void> {

  // ─── GET /sync/status ──────────────────────────────────────────────
  // Lightweight version enforcement + metadata.
  // HEAD /sync/status is an iOS online-detection mitigation — returns 204.
  // Fastify auto-handles HEAD for every GET; we detect the method and return 204 directly.

  app.route({
    method: ["GET", "HEAD"],
    url:    "/sync/status",
    preHandler: requirePermission(PERMISSIONS.TERRITORIES_VIEW),
    handler: async (request, reply) => {
      if (request.method === "HEAD") {
        return reply.code(204).send();
      }
      return reply.code(200).send({
        minClientVersion: process.env.MIN_CLIENT_VERSION ?? "0.0.0",
        serverVersion:    process.env.npm_package_version ?? "0.0.0",
        serverTime:       new Date().toISOString(),
      });
    },
  });

  // ─── GET /sync/pull?since=ISO&cursor=base64 ────────────────────────
  // Delta sync pull — 500 records per page across all syncable tables.

  app.get<{ Querystring: PullQuerystringType }>(
    "/sync/pull",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_VIEW),
      schema: { querystring: PullQuerystring },
    },
    async (request, reply) => {
      const tenantId = (request as any).policyCtx?.tenantId as string | undefined;
      const sinceParam = request.query.since;
      const cursorParam = request.query.cursor;

      // Parse `since` — no value means full dump from epoch
      const since: Date = sinceParam ? new Date(sinceParam) : EPOCH;

      // Parse cursor — determines starting table/offset
      let startTableIndex = 0;
      let startOffset = 0;
      if (cursorParam) {
        const cursor = decodeCursor(cursorParam);
        if (cursor) {
          startTableIndex = cursor.tableIndex;
          startOffset = cursor.offset;
        }
      }

      const serverTime = new Date().toISOString();
      const tables: Record<TableName, { upserts: unknown[]; deletes: string[] }> = {
        territories:           { upserts: [], deletes: [] },
        addresses:             { upserts: [], deletes: [] },
        visits:                { upserts: [], deletes: [] },
        assignments:           { upserts: [], deletes: [] },
        publishers:            { upserts: [], deletes: [] },
        meetingPoints:         { upserts: [], deletes: [] },
        campaignMeetingPoints: { upserts: [], deletes: [] },
        meetings:              { upserts: [], deletes: [] },
        territoryShares:       { upserts: [], deletes: [] },
      };

      let remaining = PAGE_SIZE;
      let nextCursor: string | undefined;
      let hasMore = false;

      for (let i = startTableIndex; i < SYNCABLE_TABLES.length; i++) {
        if (remaining <= 0) {
          hasMore = true;
          break;
        }

        const tableConfig = SYNCABLE_TABLES[i];
        const delegate = (prisma as any)[tableConfig.delegate];
        const offset = i === startTableIndex ? startOffset : 0;

        // Build where clause
        // Use the table's timestamp field — most use updatedAt, AddressVisit uses visitedAt
        const tsField = tableConfig.timestampField;
        const where: Record<string, unknown> = {
          [tsField]: { gt: since },
        };
        if (tableConfig.tenantField && tenantId) {
          where[tableConfig.tenantField] = tenantId;
        }

        const records: Array<Record<string, unknown>> = await delegate.findMany({
          where,
          skip: offset,
          take: remaining,
          orderBy: { [tsField]: "asc" as const },
        });

        // Split into upserts and deletes
        const upserts: unknown[] = [];
        const deletes: string[] = [];

        for (const record of records) {
          if (record.deletedAt != null) {
            deletes.push(record.id as string);
          } else {
            upserts.push(record);
          }
        }

        tables[tableConfig.name as TableName].upserts.push(...upserts);
        tables[tableConfig.name as TableName].deletes.push(...deletes);

        remaining -= records.length;

        // If budget exhausted after this table, check if more records exist
        if (remaining === 0) {
          const fetchedSoFar = offset + records.length;
          // Check if there are more records in this table beyond what we fetched
          const totalInTable = await delegate.count({ where });
          if (fetchedSoFar < totalInTable) {
            nextCursor = encodeCursor({ tableIndex: i, offset: fetchedSoFar });
          } else if (i + 1 < SYNCABLE_TABLES.length) {
            nextCursor = encodeCursor({ tableIndex: i + 1, offset: 0 });
          }
          hasMore = nextCursor !== undefined;
          break;
        }
      }

      const response: Record<string, unknown> = {
        serverTime,
        tables,
      };
      if (hasMore && nextCursor) {
        response.cursor = nextCursor;
        response.hasMore = true;
      } else {
        response.hasMore = false;
      }

      return reply.code(200).send(response);
    },
  );

  // ─── POST /sync/push ───────────────────────────────────────────────
  // Push client changes with optimistic concurrency control.

  app.post<{ Body: PushBodyType }>(
    "/sync/push",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_VIEW),
      schema: { body: PushBody },
    },
    async (request, reply) => {
      const tenantId = (request as any).policyCtx?.tenantId as string | undefined;
      const { deviceId, changes } = request.body;

      const results: Array<{
        recordId: string;
        status: "accepted" | "conflict" | "error";
        serverVersion?: number;
        serverData?: unknown;
        clientVersion?: number;
        reason?: string;
      }> = [];

      for (const change of changes) {
        const { table, recordId, operation, version, payload, force } = change;

        // Validate table name
        const tableConfig = SYNCABLE_TABLES.find((t) => t.name === table);
        if (!tableConfig) {
          results.push({
            recordId,
            status: "error",
            reason: `Unknown table: ${table}`,
          });
          continue;
        }

        const delegate = (prisma as any)[tableConfig.delegate];

        try {
          if (operation === "create") {
            // Build create data — include tenantId if table supports it
            const data: Record<string, unknown> = {
              id: recordId,
              ...(payload ?? {}),
            };
            if (tableConfig.tenantField && tenantId) {
              data[tableConfig.tenantField] = tenantId;
            }

            const created = await delegate.create({ data });
            results.push({
              recordId,
              status: "accepted",
              serverVersion: created.syncVersion ?? 1,
            });

          } else if (operation === "update") {
            // Fetch current server record
            const existing = await delegate.findUnique({ where: { id: recordId } });

            if (!existing) {
              results.push({
                recordId,
                status: "error",
                reason: "Record not found",
              });
              continue;
            }

            // Optimistic concurrency check
            const serverVersion: number = existing.syncVersion ?? 0;
            const clientVersion: number = version ?? 0;

            if (!force && serverVersion !== clientVersion) {
              results.push({
                recordId,
                status: "conflict",
                serverVersion,
                serverData: existing,
                clientVersion,
                reason: "Version mismatch",
              });
              continue;
            }

            // IMPORTANT: Do NOT set syncVersion — version-middleware auto-increments it
            const updateData: Record<string, unknown> = { ...(payload ?? {}) };
            // Strip forbidden fields that must not be set by client
            delete updateData.id;
            delete updateData.syncVersion;
            if (tableConfig.tenantField) delete updateData[tableConfig.tenantField];

            const updated = await delegate.update({
              where: { id: recordId },
              data: updateData,
            });

            results.push({
              recordId,
              status: "accepted",
              serverVersion: updated.syncVersion,
            });

          } else if (operation === "delete") {
            // Fetch current server record
            const existing = await delegate.findUnique({ where: { id: recordId } });

            if (!existing) {
              // Already gone — idempotent accept
              results.push({ recordId, status: "accepted" });
              continue;
            }

            // Soft delete via deletedAt
            const deleted = await delegate.update({
              where: { id: recordId },
              data: { deletedAt: new Date() },
            });

            results.push({
              recordId,
              status: "accepted",
              serverVersion: deleted.syncVersion,
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          results.push({
            recordId,
            status: "error",
            reason: message,
          });
        }
      }

      // Update device.lastSyncAt (non-critical)
      try {
        await prisma.device.updateMany({
          where: { id: deviceId },
          data: { lastSyncAt: new Date() },
        });
      } catch {
        // Non-critical — ignore
      }

      return reply.code(200).send({ results });
    },
  );
}
