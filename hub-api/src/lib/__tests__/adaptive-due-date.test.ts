import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { calculateSuggestedDue } from "../adaptive-due-date.js";

describe("calculateSuggestedDue", () => {
  const NOW = new Date("2026-06-01T00:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns default checkout days when fewer than 3 completed assignments", () => {
    const result = calculateSuggestedDue(10, 20, 120, [
      { assignedAt: new Date("2026-01-01"), returnedAt: new Date("2026-02-01") },
      { assignedAt: new Date("2026-02-01"), returnedAt: new Date("2026-03-01") },
    ]);
    const expected = new Date(NOW);
    expected.setDate(expected.getDate() + 120);
    expect(result!.toISOString()).toBe(expected.toISOString());
  });

  it("returns default checkout days when addressCount is 0", () => {
    const result = calculateSuggestedDue(0, 20, 120, [
      { assignedAt: new Date("2026-01-01"), returnedAt: new Date("2026-02-01") },
      { assignedAt: new Date("2026-02-01"), returnedAt: new Date("2026-03-01") },
      { assignedAt: new Date("2026-03-01"), returnedAt: new Date("2026-04-01") },
    ]);
    const expected = new Date(NOW);
    expected.setDate(expected.getDate() + 120);
    expect(result!.toISOString()).toBe(expected.toISOString());
  });

  it("returns default checkout days when avgAddressCount is 0", () => {
    const result = calculateSuggestedDue(10, 0, 120, [
      { assignedAt: new Date("2026-01-01"), returnedAt: new Date("2026-02-01") },
      { assignedAt: new Date("2026-02-01"), returnedAt: new Date("2026-03-01") },
      { assignedAt: new Date("2026-03-01"), returnedAt: new Date("2026-04-01") },
    ]);
    const expected = new Date(NOW);
    expected.setDate(expected.getDate() + 120);
    expect(result!.toISOString()).toBe(expected.toISOString());
  });

  it("returns default when no past assignments", () => {
    const result = calculateSuggestedDue(10, 20, 90, []);
    const expected = new Date(NOW);
    expected.setDate(expected.getDate() + 90);
    expect(result!.toISOString()).toBe(expected.toISOString());
  });

  it("ignores incomplete (unreturned) assignments in history", () => {
    const result = calculateSuggestedDue(10, 20, 120, [
      { assignedAt: new Date("2026-01-01"), returnedAt: new Date("2026-02-01") },
      { assignedAt: new Date("2026-02-01"), returnedAt: new Date("2026-03-01") },
      { assignedAt: new Date("2026-03-01"), returnedAt: null }, // still active
    ]);
    // Only 2 completed — falls back to default
    const expected = new Date(NOW);
    expected.setDate(expected.getDate() + 120);
    expect(result!.toISOString()).toBe(expected.toISOString());
  });

  it("calculates adaptive due date with average-paced publisher", () => {
    // Publisher averages ~120 days per territory, same as default
    // Address count equal to average — ratio = 1.0
    const assignments = [
      { assignedAt: new Date("2025-01-01"), returnedAt: new Date("2025-05-01") }, // ~120 days
      { assignedAt: new Date("2025-05-01"), returnedAt: new Date("2025-09-01") }, // ~123 days
      { assignedAt: new Date("2025-09-01"), returnedAt: new Date("2025-12-29") }, // ~119 days
    ];
    const result = calculateSuggestedDue(20, 20, 120, assignments);
    // addressRatio = 1.0, historyRatio ≈ 1.0 → ~120 days
    const daysFromNow = Math.round(
      (result!.getTime() - NOW.getTime()) / (1000 * 60 * 60 * 24),
    );
    expect(daysFromNow).toBeGreaterThanOrEqual(115);
    expect(daysFromNow).toBeLessThanOrEqual(125);
  });

  it("increases due date for larger territories", () => {
    // Publisher averages ~120 days with avg 20 addresses
    // This territory has 40 addresses (2x) → should get longer
    const assignments = [
      { assignedAt: new Date("2025-01-01"), returnedAt: new Date("2025-05-01") },
      { assignedAt: new Date("2025-05-01"), returnedAt: new Date("2025-09-01") },
      { assignedAt: new Date("2025-09-01"), returnedAt: new Date("2025-12-29") },
    ];
    const result = calculateSuggestedDue(40, 20, 120, assignments);
    const daysFromNow = Math.round(
      (result!.getTime() - NOW.getTime()) / (1000 * 60 * 60 * 24),
    );
    // addressRatio = 2.0 → would be 240, but capped at 2.0 * 120 = 240
    expect(daysFromNow).toBe(240);
  });

  it("decreases due date for smaller territories", () => {
    const assignments = [
      { assignedAt: new Date("2025-01-01"), returnedAt: new Date("2025-05-01") },
      { assignedAt: new Date("2025-05-01"), returnedAt: new Date("2025-09-01") },
      { assignedAt: new Date("2025-09-01"), returnedAt: new Date("2025-12-29") },
    ];
    const result = calculateSuggestedDue(10, 20, 120, assignments);
    const daysFromNow = Math.round(
      (result!.getTime() - NOW.getTime()) / (1000 * 60 * 60 * 24),
    );
    // addressRatio = 0.5, historyRatio ≈ 1.0 → ~60 days (min = 0.5 * 120 = 60)
    expect(daysFromNow).toBe(60);
  });

  it("clamps to minimum 0.5x default checkout days", () => {
    // Very fast publisher with tiny territory
    const assignments = [
      { assignedAt: new Date("2025-06-01"), returnedAt: new Date("2025-06-15") }, // 14 days
      { assignedAt: new Date("2025-06-15"), returnedAt: new Date("2025-06-29") }, // 14 days
      { assignedAt: new Date("2025-07-01"), returnedAt: new Date("2025-07-15") }, // 14 days
    ];
    const result = calculateSuggestedDue(5, 20, 120, assignments);
    const daysFromNow = Math.round(
      (result!.getTime() - NOW.getTime()) / (1000 * 60 * 60 * 24),
    );
    // Would be very low but clamped at 0.5 * 120 = 60
    expect(daysFromNow).toBe(60);
  });

  it("clamps to maximum 2.0x default checkout days", () => {
    // Very slow publisher with huge territory
    const assignments = [
      { assignedAt: new Date("2024-01-01"), returnedAt: new Date("2024-12-31") }, // ~365 days
      { assignedAt: new Date("2025-01-01"), returnedAt: new Date("2025-12-31") }, // ~365 days
      { assignedAt: new Date("2024-06-01"), returnedAt: new Date("2025-05-31") }, // ~365 days
    ];
    const result = calculateSuggestedDue(60, 20, 120, assignments);
    const daysFromNow = Math.round(
      (result!.getTime() - NOW.getTime()) / (1000 * 60 * 60 * 24),
    );
    // Would be very high but capped at 2.0 * 120 = 240
    expect(daysFromNow).toBe(240);
  });
});
