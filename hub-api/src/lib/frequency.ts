export const VALID_FREQUENCIES = ["1w", "2w", "1m", "3m", "6m", "1y"] as const;
export type Frequency = (typeof VALID_FREQUENCIES)[number];

export function isValidFrequency(value: string): value is Frequency {
  return (VALID_FREQUENCIES as readonly string[]).includes(value);
}

export function calculateNextDue(from: Date, frequency: Frequency): Date {
  const next = new Date(from);

  switch (frequency) {
    case "1w":
      next.setDate(next.getDate() + 7);
      break;
    case "2w":
      next.setDate(next.getDate() + 14);
      break;
    case "1m":
      next.setMonth(next.getMonth() + 1);
      break;
    case "3m":
      next.setMonth(next.getMonth() + 3);
      break;
    case "6m":
      next.setMonth(next.getMonth() + 6);
      break;
    case "1y":
      next.setFullYear(next.getFullYear() + 1);
      break;
  }

  return next;
}
