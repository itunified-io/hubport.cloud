/**
 * Assignment overdue check — runs daily, creates notifications for
 * assignments approaching or past their due date.
 *
 * Checks TerritoryAssignment records where dueDate is within
 * CongregationSettings.overdueReminderDays from now.
 */

import type { FastifyBaseLogger } from "fastify";
import prisma from "../lib/prisma.js";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function startAssignmentOverdueCheck(log: FastifyBaseLogger): void {
  // Run daily starting after a 30s delay (let DB settle)
  setTimeout(() => checkOverdueAssignments(log), 30_000);
  setInterval(() => checkOverdueAssignments(log), CHECK_INTERVAL_MS);
  log.info("[assignment-overdue-check] Job started (interval: 24h)");
}

async function checkOverdueAssignments(
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    const settings = await prisma.congregationSettings.findFirst();
    const overdueReminderDays = settings?.overdueReminderDays ?? 14;

    const now = new Date();
    const warningThreshold = new Date();
    warningThreshold.setDate(
      warningThreshold.getDate() + overdueReminderDays,
    );

    // Find assignments due within the reminder window or already overdue
    const dueSoon = await prisma.territoryAssignment.findMany({
      where: {
        isActive: true,
        isSuspended: false,
        dueDate: { lte: warningThreshold },
      },
      include: {
        territory: { select: { number: true, name: true } },
        publisher: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (dueSoon.length === 0) {
      log.debug("[assignment-overdue-check] No overdue/due-soon assignments");
      return;
    }

    let notifiedCount = 0;

    for (const assignment of dueSoon) {
      if (!assignment.dueDate) continue;

      const isOverdue = assignment.dueDate < now;
      const type = isOverdue
        ? "assignment_overdue"
        : "assignment_due_soon";
      const label = isOverdue ? "overdue" : "due soon";

      // Check if we already sent a notification today for this assignment
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const existingNotification = await prisma.notification.findFirst({
        where: {
          publisherId: assignment.publisher.id,
          type,
          createdAt: { gte: todayStart },
          data: {
            path: ["assignmentId"],
            equals: assignment.id,
          },
        },
      });

      if (existingNotification) continue;

      await prisma.notification.create({
        data: {
          publisherId: assignment.publisher.id,
          type,
          title: `Territory ${assignment.territory.number} is ${label}`,
          body: `Territory "${assignment.territory.name}" (${assignment.territory.number}) is ${label}. Due date: ${assignment.dueDate.toISOString().slice(0, 10)}`,
          data: {
            assignmentId: assignment.id,
            territoryId: assignment.territoryId,
          },
        },
      });
      notifiedCount++;
    }

    if (notifiedCount > 0) {
      log.info(
        `[assignment-overdue-check] Created ${notifiedCount} notification(s)`,
      );
    }
  } catch (err) {
    log.error(
      { err },
      "[assignment-overdue-check] Failed to check overdue assignments",
    );
  }
}
