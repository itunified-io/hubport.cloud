/**
 * Prisma client extension that automatically increments syncVersion
 * on every update to syncable models.
 *
 * The sync engine relies on this — it does NOT set syncVersion explicitly
 * on updates, letting this extension handle it.
 */
import { Prisma } from "@prisma/client";

export const SYNCABLE_MODELS = new Set([
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

/**
 * Core logic: inject syncVersion increment when an update targets a syncable model.
 * Exported separately so it can be unit-tested without a live Prisma client.
 */
export async function applySyncVersionIncrement(ctx: {
  model: string | undefined;
  operation: string;
  args: Record<string, unknown>;
  query: (args: Record<string, unknown>) => Promise<unknown>;
}): Promise<unknown> {
  const { model, operation, args, query } = ctx;
  if (
    model &&
    SYNCABLE_MODELS.has(model) &&
    (operation === "update" || operation === "updateMany")
  ) {
    args.data = args.data ?? {};
    (args.data as Record<string, unknown>).syncVersion = { increment: 1 };
  }
  return query(args);
}

export const syncVersionExtension = Prisma.defineExtension({
  name: "sync-version",
  query: {
    $allOperations: ({ model, operation, args, query }) =>
      applySyncVersionIncrement({
        model,
        operation,
        args: args as Record<string, unknown>,
        query: query as (args: Record<string, unknown>) => Promise<unknown>,
      }),
  },
});
