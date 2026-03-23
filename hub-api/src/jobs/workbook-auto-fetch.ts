/**
 * Auto-fetch workbook editions on startup and periodically.
 *
 * Checks if the current bimonthly workbook edition has been imported.
 * If not, auto-imports it so the planner is ready without manual action.
 */

import type { FastifyBaseLogger } from "fastify";
import prisma from "../lib/prisma.js";
import { checkWorkbookAvailability } from "../lib/importers/jw/jw-availability.js";
import {
  previewWorkbookImport,
  commitWorkbookImport,
} from "../lib/importers/jw/midweek-workbook-importer.js";

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

export function startWorkbookAutoFetch(log: FastifyBaseLogger): void {
  // Run on startup (after a short delay to let DB settle)
  setTimeout(() => autoFetchCurrentEdition(log), 10_000);

  // Then every 12 hours
  setInterval(() => autoFetchCurrentEdition(log), CHECK_INTERVAL_MS);

  log.info("[workbook-auto-fetch] Job started (interval: 12h)");
}

async function autoFetchCurrentEdition(log: FastifyBaseLogger): Promise<void> {
  try {
    // Get congregation language (default: de)
    const settings = await prisma.congregationSettings.findFirst();
    const language = settings?.language ?? "de";

    // Check what's available
    const available = await checkWorkbookAvailability(language);

    // Find current edition (first available that's not yet imported)
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    for (const edition of available) {
      const [y, m] = edition.yearMonth.split("-").map(Number);

      // Only auto-import if it's the current or next bimonthly period
      const isCurrentOrNext =
        (y === currentYear && m >= currentMonth - 1 && m <= currentMonth + 2) ||
        (y === currentYear + 1 && currentMonth >= 11);

      if (!edition.available || !isCurrentOrNext) continue;

      // Check if already imported
      const existing = await prisma.workbookEdition.findFirst({
        where: { language, yearMonth: edition.yearMonth },
      });

      if (existing) continue;

      // Auto-import
      log.info(`[workbook-auto-fetch] Auto-importing ${edition.yearMonth} (${language})`);

      try {
        const preview = await previewWorkbookImport(language, edition.yearMonth);
        const result = await commitWorkbookImport(preview.edition, "system:auto-fetch");

        log.info(
          `[workbook-auto-fetch] Imported ${edition.yearMonth}: ` +
          `${result.meetingsCreated} meetings, ${result.slotsSeeded} slots`,
        );
      } catch (importErr) {
        log.warn(
          `[workbook-auto-fetch] Failed to import ${edition.yearMonth}: ` +
          (importErr instanceof Error ? importErr.message : String(importErr)),
        );
      }
    }
  } catch (err) {
    log.warn(
      `[workbook-auto-fetch] Check failed: ` +
      (err instanceof Error ? err.message : String(err)),
    );
  }
}
