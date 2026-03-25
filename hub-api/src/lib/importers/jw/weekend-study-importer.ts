/**
 * Weekend study importer — parses Watchtower Study edition EPUB from JW CDN.
 *
 * Parser rules:
 * - Use EPUB from JW CDN (structured XHTML, reliable extraction)
 * - Normalize to internal types, not display strings
 * - Idempotent by edition identity and checksum
 * - Support preview before commit
 * - Auto-create weekend meetings when importing study weeks
 * - Reimport cleanup: delete assignments → unlink meetings → delete weeks → recreate
 */

import { fetchStudyEpub } from "./jw-client.js";
import { parseWtStudyEpub } from "./wt-study-epub-parser.js";
import { validateStudyEdition } from "./import-validator.js";
import type {
  ImportedStudyEdition,
  ImportPreview,
  StudyImportResult,
} from "./types.js";
import prisma from "../../prisma.js";

/**
 * Preview a study edition import.
 * Fetches the EPUB from JW CDN, parses it, and returns structured data + warnings.
 */
export async function previewStudyImport(
  language: string,
  issueKey: string,
): Promise<ImportPreview<ImportedStudyEdition>> {
  const fetched = await fetchStudyEpub(language, issueKey);
  const edition = await parseWtStudyEpub(
    fetched.data, language, issueKey, fetched.checksum,
  );

  const validation = validateStudyEdition(edition);
  if (!validation.valid) {
    throw new Error(`Study import validation failed: ${validation.errors.join("; ")}`);
  }

  const existing = await prisma.weekendStudyEdition.findUnique({
    where: { language_issueKey: { language, issueKey } },
  });

  return {
    edition,
    warnings: validation.warnings,
    existingEditionId: existing?.id ?? null,
    wouldReplace: !!existing,
  };
}

/**
 * Commit a study edition import.
 *
 * Transaction cleanup order (critical for FK constraints):
 * 1. Delete auto_seeded assignments for linked meetings
 * 2. Unlink meetings from study weeks (weekendStudyWeekId = null)
 * 3. Delete existing study weeks
 * 4. Upsert edition
 * 5. Create new study weeks
 * 6. For each week: find or CREATE weekend meeting
 * 7. Link meeting to study week
 * 8. Seed weekend slot templates
 */
export async function commitStudyImport(
  edition: ImportedStudyEdition,
  _actorId: string,
): Promise<StudyImportResult> {
  const warnings: string[] = [];

  return await prisma.$transaction(async (tx) => {
    // 1. Upsert WeekendStudyEdition
    const dbEdition = await tx.weekendStudyEdition.upsert({
      where: {
        language_issueKey: {
          language: edition.language,
          issueKey: edition.issueKey,
        },
      },
      update: {
        checksum: edition.checksum,
        rawMetadata: { parserVersion: "2.0-epub", fetchedAt: new Date().toISOString() },
        importedAt: new Date(),
      },
      create: {
        language: edition.language,
        issueKey: edition.issueKey,
        checksum: edition.checksum,
        rawMetadata: { parserVersion: "2.0-epub", fetchedAt: new Date().toISOString() },
      },
    });

    // 2. Reimport cleanup — delete assignments FIRST (FK constraint safety)
    const existingWeeks = await tx.weekendStudyWeek.findMany({
      where: { editionId: dbEdition.id },
      select: { id: true },
    });

    if (existingWeeks.length > 0) {
      // Find all meetings linked to these study weeks
      const linkedMeetings = await tx.meeting.findMany({
        where: { weekendStudyWeekId: { in: existingWeeks.map((w) => w.id) } },
        select: { id: true },
      });

      if (linkedMeetings.length > 0) {
        // Delete auto-seeded assignments (prevents FK issues on study week deletion)
        await tx.meetingAssignment.deleteMany({
          where: {
            meetingId: { in: linkedMeetings.map((m) => m.id) },
            source: "auto_seeded",
          },
        });

        // Unlink meetings from study weeks
        await tx.meeting.updateMany({
          where: { weekendStudyWeekId: { in: existingWeeks.map((w) => w.id) } },
          data: { weekendStudyWeekId: null },
        });
      }
    }

    // 3. Now safe to delete existing weeks (no FK references remain)
    await tx.weekendStudyWeek.deleteMany({
      where: { editionId: dbEdition.id },
    });

    // 4. Create new study weeks
    let weeksCreated = 0;
    for (const week of edition.weeks) {
      await tx.weekendStudyWeek.create({
        data: {
          editionId: dbEdition.id,
          weekOf: new Date(week.weekOf),
          articleTitle: week.articleTitle,
          articleUrl: week.articleUrl,
          studyNumber: week.studyNumber,
          sourceRef: week.sourceRef,
          sortOrder: week.sortOrder,
        },
      });
      weeksCreated++;
    }

    // 5. Link study weeks to existing or NEW weekend meetings + seed slots
    let meetingsLinked = 0;
    let meetingsCreated = 0;
    let slotsSeeded = 0;

    // Get congregation settings for default weekend day/time
    const settings = await tx.congregationSettings.findFirst();
    const weekendDay = settings?.defaultWeekendDay ?? 0; // 0 = Sunday
    const weekendTime = settings?.defaultWeekendTime ?? "10:00";

    // Get all weekend + shared slot templates
    const slotTemplates = await tx.meetingSlotTemplate.findMany({
      where: {
        meetingType: { in: ["weekend", "all"] },
        isActive: true,
      },
      orderBy: { sortOrder: "asc" },
    });

    for (const week of edition.weeks) {
      const studyWeek = await tx.weekendStudyWeek.findFirst({
        where: { editionId: dbEdition.id, weekOf: new Date(week.weekOf) },
      });
      if (!studyWeek) continue;

      // Calculate meeting date based on congregation's weekend day
      const sunday = new Date(week.weekOf);
      const meetingDate = new Date(sunday);
      if (weekendDay !== 0) {
        // Adjust from Sunday to configured day (e.g., Saturday = 6)
        const dayOffset = weekendDay >= sunday.getDay()
          ? weekendDay - sunday.getDay()
          : weekendDay - sunday.getDay() + 7;
        meetingDate.setDate(sunday.getDate() + dayOffset);
      }

      // Find existing weekend meeting for this date
      let meeting = await tx.meeting.findFirst({
        where: {
          type: "weekend",
          date: meetingDate,
        },
      });

      if (meeting) {
        // Link existing meeting to study week
        await tx.meeting.update({
          where: { id: meeting.id },
          data: { weekendStudyWeekId: studyWeek.id },
        });
        meetingsLinked++;
      } else {
        // AUTO-CREATE weekend meeting
        meeting = await tx.meeting.create({
          data: {
            title: "Weekend Meeting",
            type: "weekend",
            date: meetingDate,
            startTime: weekendTime,
            weekendStudyWeekId: studyWeek.id,
            status: "draft",
          },
        });
        meetingsCreated++;
        meetingsLinked++;
      }

      // Seed weekend program slots (chairman, prayers, public talk, WT conductor/reader)
      const WEEKEND_PROGRAM_SLOTS = [
        "chairman_weekend",
        "opening_prayer_weekend",
        "public_talk",
        "wt_conductor",
        "wt_reader",
        "closing_prayer_weekend",
      ];
      const programTemplates = slotTemplates.filter(
        (t) => WEEKEND_PROGRAM_SLOTS.includes(t.slotKey) && t.category === "program",
      );
      for (const tmpl of programTemplates) {
        await tx.meetingAssignment.create({
          data: {
            meetingId: meeting.id,
            slotTemplateId: tmpl.id,
            status: "pending",
            source: "auto_seeded",
          },
        });
        slotsSeeded++;
      }

      // Seed shared duty slots (sound, video, attendants, etc.)
      const dutyTemplates = slotTemplates.filter((t) => t.category === "duty");
      for (const duty of dutyTemplates) {
        await tx.meetingAssignment.create({
          data: {
            meetingId: meeting.id,
            slotTemplateId: duty.id,
            status: "pending",
            source: "auto_seeded",
          },
        });
        slotsSeeded++;
      }
    }

    return {
      editionId: dbEdition.id,
      weeksCreated,
      meetingsLinked,
      meetingsCreated,
      slotsSeeded,
      warnings,
    };
  });
}
