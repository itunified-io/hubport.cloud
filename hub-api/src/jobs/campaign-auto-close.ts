/**
 * Campaign auto-close job — runs daily, closes campaigns past their endDate.
 *
 * Only closes campaigns with status "active" and endDate < now.
 * Uses a simplified close flow (marks as closed + deactivates shares).
 * Full close with report generation should be done manually via the API.
 */

import type { FastifyBaseLogger } from "fastify";
import prisma from "../lib/prisma.js";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function startCampaignAutoClose(log: FastifyBaseLogger): void {
  // Run daily starting after a 45s delay
  setTimeout(() => autoCloseCampaigns(log), 45_000);
  setInterval(() => autoCloseCampaigns(log), CHECK_INTERVAL_MS);
  log.info("[campaign-auto-close] Job started (interval: 24h)");
}

async function autoCloseCampaigns(log: FastifyBaseLogger): Promise<void> {
  try {
    const now = new Date();

    const expiredCampaigns = await prisma.campaign.findMany({
      where: {
        status: "active",
        endDate: { lt: now },
        deletedAt: null,
      },
      include: {
        meetingPoints: {
          include: {
            fieldGroups: true,
          },
        },
      },
    });

    if (expiredCampaigns.length === 0) {
      log.debug("[campaign-auto-close] No expired campaigns");
      return;
    }

    for (const campaign of expiredCampaigns) {
      try {
        const campaignTerritoryIds = campaign.meetingPoints.flatMap(
          (mp) => mp.territoryIds,
        );
        const campaignDurationDays = Math.ceil(
          (campaign.endDate.getTime() - campaign.startDate.getTime()) /
            (1000 * 60 * 60 * 24),
        );

        await prisma.$transaction(async (tx) => {
          // Deactivate campaign assignments
          await tx.territoryAssignment.updateMany({
            where: { campaignId: campaign.id, isActive: true },
            data: { isActive: false, returnedAt: now },
          });

          // Close all field groups and deactivate location shares
          for (const mp of campaign.meetingPoints) {
            for (const fg of mp.fieldGroups) {
              if (fg.status !== "closed") {
                await tx.campaignFieldGroup.update({
                  where: { id: fg.id },
                  data: { status: "closed", closedAt: now },
                });
              }
              await tx.locationShare.updateMany({
                where: { fieldGroupId: fg.id, isActive: true },
                data: {
                  isActive: false,
                  lastLatitude: null,
                  lastLongitude: null,
                },
              });
            }
          }

          // Unsuspend regular assignments
          if (campaignTerritoryIds.length > 0) {
            await tx.territoryAssignment.updateMany({
              where: {
                territoryId: { in: campaignTerritoryIds },
                isSuspended: true,
                campaignId: null,
              },
              data: { isSuspended: false },
            });

            // Extend due dates by campaign duration
            const unsuspended = await tx.territoryAssignment.findMany({
              where: {
                territoryId: { in: campaignTerritoryIds },
                isActive: true,
                campaignId: null,
                dueDate: { not: null },
              },
            });
            for (const a of unsuspended) {
              if (a.dueDate) {
                const newDue = new Date(a.dueDate);
                newDue.setDate(newDue.getDate() + campaignDurationDays);
                await tx.territoryAssignment.update({
                  where: { id: a.id },
                  data: { dueDate: newDue },
                });
              }
            }
          }

          // Set status closed
          await tx.campaign.update({
            where: { id: campaign.id },
            data: { status: "closed" },
          });

          // Notify creator
          const creator = await tx.publisher.findFirst({
            where: { keycloakSub: campaign.createdBy },
          });
          if (creator) {
            await tx.notification.create({
              data: {
                publisherId: creator.id,
                type: "campaign_auto_closed",
                title: `Campaign "${campaign.title}" auto-closed`,
                body: `Campaign ended on ${campaign.endDate.toISOString().slice(0, 10)} and has been automatically closed.`,
                data: { campaignId: campaign.id },
              },
            });
          }
        });

        log.info(
          `[campaign-auto-close] Auto-closed campaign "${campaign.title}" (${campaign.id})`,
        );
      } catch (err) {
        log.error(
          { err, campaignId: campaign.id },
          `[campaign-auto-close] Failed to auto-close campaign "${campaign.title}"`,
        );
      }
    }
  } catch (err) {
    log.error(
      { err },
      "[campaign-auto-close] Failed to run auto-close check",
    );
  }
}
