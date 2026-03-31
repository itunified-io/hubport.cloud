/**
 * Adaptive due-date calculation for territory assignments.
 *
 * Uses publisher history and address count ratio to suggest a due date
 * that scales with territory size and the publisher's pace.
 */

export function calculateSuggestedDue(
  addressCount: number,
  avgAddressCount: number,
  defaultCheckoutDays: number,
  pastAssignments: { assignedAt: Date; returnedAt: Date | null }[],
): Date | null {
  // Need at least 3 completed past assignments for history-based calculation
  const completed = pastAssignments.filter((a) => a.returnedAt);
  if (completed.length < 3 || addressCount === 0 || avgAddressCount === 0) {
    const d = new Date();
    d.setDate(d.getDate() + defaultCheckoutDays);
    return d;
  }

  const avgDays =
    completed.reduce((sum, a) => {
      const diff =
        (a.returnedAt!.getTime() - a.assignedAt.getTime()) /
        (1000 * 60 * 60 * 24);
      return sum + diff;
    }, 0) / completed.length;

  const addressRatio = addressCount / avgAddressCount;
  const historyRatio = avgDays / defaultCheckoutDays;

  const suggestedDays = Math.round(
    Math.max(
      defaultCheckoutDays * 0.5,
      Math.min(
        defaultCheckoutDays * 2.0,
        defaultCheckoutDays * addressRatio * historyRatio,
      ),
    ),
  );

  const d = new Date();
  d.setDate(d.getDate() + suggestedDays);
  return d;
}
