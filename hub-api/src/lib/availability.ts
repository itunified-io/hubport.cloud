/**
 * Shared availability calculation — reused by midweek, weekend, and public talk planners.
 */

import prisma from "./prisma.js";

export interface DateRange {
  start: Date;
  end: Date;
}

export interface AvailableDate {
  date: Date;
  dayOfWeek: number;
  available: boolean;
  reason?: "away" | "scheduled" | "cap_reached";
}

/**
 * Calculate availability for a publisher within a date range.
 * Checks away periods and existing meeting assignments.
 * For speakers: also checks monthly invite cap.
 */
export async function getPublisherAvailability(
  publisherId: string,
  range: DateRange,
  options?: { speakerId?: string; meetingDay?: number },
): Promise<AvailableDate[]> {
  const awayPeriods = await prisma.awayPeriod.findMany({
    where: {
      publisherId,
      startDate: { lte: range.end },
      endDate: { gte: range.start },
    },
  });

  const assignments = await prisma.meetingAssignment.findMany({
    where: {
      assigneePublisherId: publisherId,
      meeting: { date: { gte: range.start, lte: range.end } },
    },
    include: { meeting: { select: { date: true } } },
  });

  const assignedDates = new Set(
    assignments.map((a) => a.meeting.date.toISOString().slice(0, 10)),
  );

  // Speaker monthly talk counts (for cap check)
  let speakerCap: number | null = null;
  const monthTalkCounts = new Map<string, number>();

  if (options?.speakerId) {
    const speaker = await prisma.speaker.findUnique({
      where: { id: options.speakerId },
      select: { monthlyInviteCap: true },
    });
    speakerCap = speaker?.monthlyInviteCap ?? null;

    if (speakerCap !== null) {
      const schedules = await prisma.publicTalkSchedule.findMany({
        where: {
          speakerId: options.speakerId,
          invitationState: { in: ["confirmed", "invited"] },
          meeting: { date: { gte: range.start, lte: range.end } },
        },
        include: { meeting: { select: { date: true } } },
      });
      for (const s of schedules) {
        const mk = s.meeting.date.toISOString().slice(0, 7); // "YYYY-MM"
        monthTalkCounts.set(mk, (monthTalkCounts.get(mk) ?? 0) + 1);
      }
    }
  }

  const dates: AvailableDate[] = [];
  const current = new Date(range.start);
  while (current <= range.end) {
    const dow = current.getDay();
    if (options?.meetingDay === undefined || dow === options.meetingDay) {
      const iso = current.toISOString().slice(0, 10);
      const isAway = awayPeriods.some((p) => current >= p.startDate && current <= p.endDate);
      const isScheduled = assignedDates.has(iso);

      let reason: AvailableDate["reason"];
      let available = true;

      if (isAway) { available = false; reason = "away"; }
      else if (isScheduled) { available = false; reason = "scheduled"; }

      // Speaker monthly cap
      if (available && speakerCap !== null) {
        const mk = current.toISOString().slice(0, 7);
        if ((monthTalkCounts.get(mk) ?? 0) >= speakerCap) {
          available = false;
          reason = "cap_reached";
        }
      }

      dates.push({ date: new Date(current), dayOfWeek: dow, available, reason });
    }
    current.setDate(current.getDate() + 1);
  }

  return dates;
}
