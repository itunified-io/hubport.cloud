import { describe, it, expect, vi } from "vitest";
import {
  applySyncVersionIncrement,
  syncVersionExtension,
  SYNCABLE_MODELS,
} from "../version-middleware.js";

describe("version-middleware / applySyncVersionIncrement", () => {
  it("increments syncVersion on update for syncable models", async () => {
    const args = { data: { street: "New Street" } } as Record<string, unknown>;
    const next = vi.fn().mockResolvedValue({ id: "1", syncVersion: 1 });

    await applySyncVersionIncrement({
      model: "Address",
      operation: "update",
      args,
      query: next,
    });

    expect((args.data as Record<string, unknown>).syncVersion).toEqual({
      increment: 1,
    });
    expect(next).toHaveBeenCalledWith(args);
  });

  it("increments syncVersion on updateMany for syncable models", async () => {
    const args = {
      where: { active: true },
      data: { notes: "batch" },
    } as Record<string, unknown>;
    const next = vi.fn().mockResolvedValue({ count: 5 });

    await applySyncVersionIncrement({
      model: "Territory",
      operation: "updateMany",
      args,
      query: next,
    });

    expect((args.data as Record<string, unknown>).syncVersion).toEqual({
      increment: 1,
    });
  });

  it("does NOT increment syncVersion for non-syncable models", async () => {
    const args = { data: { code: "abc" } } as Record<string, unknown>;
    const next = vi.fn().mockResolvedValue({ id: "1" });

    await applySyncVersionIncrement({
      model: "InviteCode",
      operation: "update",
      args,
      query: next,
    });

    expect(
      (args.data as Record<string, unknown>).syncVersion,
    ).toBeUndefined();
    expect(next).toHaveBeenCalledWith(args);
  });

  it("does NOT increment syncVersion on create", async () => {
    const args = { data: { street: "New" } } as Record<string, unknown>;
    const next = vi.fn().mockResolvedValue({ id: "1" });

    await applySyncVersionIncrement({
      model: "Address",
      operation: "create",
      args,
      query: next,
    });

    expect(
      (args.data as Record<string, unknown>).syncVersion,
    ).toBeUndefined();
  });

  it("does NOT increment syncVersion on delete", async () => {
    const args = { where: { id: "1" } } as Record<string, unknown>;
    const next = vi.fn().mockResolvedValue({ id: "1" });

    await applySyncVersionIncrement({
      model: "Address",
      operation: "delete",
      args,
      query: next,
    });

    expect(args.syncVersion).toBeUndefined();
  });

  it("initialises data when args.data is absent (updateMany without existing data)", async () => {
    const args = { where: { active: true } } as Record<string, unknown>;
    const next = vi.fn().mockResolvedValue({ count: 3 });

    await applySyncVersionIncrement({
      model: "TerritoryShare",
      operation: "updateMany",
      args,
      query: next,
    });

    expect((args.data as Record<string, unknown>).syncVersion).toEqual({
      increment: 1,
    });
  });
});

describe("version-middleware / syncVersionExtension", () => {
  it("exports a Prisma extension function", () => {
    // Prisma.defineExtension returns a function (extension builder)
    expect(typeof syncVersionExtension).toBe("function");
  });
});

describe("version-middleware / SYNCABLE_MODELS", () => {
  it("contains all expected syncable model names", () => {
    const expected = [
      "Territory",
      "Address",
      "AddressVisit",
      "TerritoryAssignment",
      "Publisher",
      "FieldServiceMeetingPoint",
      "CampaignMeetingPoint",
      "ServiceGroupMeeting",
      "TerritoryShare",
    ];
    for (const model of expected) {
      expect(SYNCABLE_MODELS.has(model)).toBe(true);
    }
  });

  it("does not include non-syncable models", () => {
    expect(SYNCABLE_MODELS.has("InviteCode")).toBe(false);
    expect(SYNCABLE_MODELS.has("Role")).toBe(false);
  });
});
