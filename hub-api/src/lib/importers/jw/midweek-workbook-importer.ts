/**
 * Midweek workbook importer — parses JW.org EPUB into normalized internal types.
 *
 * Parser rules:
 * - Use EPUB from JW CDN (structured XHTML, reliable CSS class markers)
 * - Normalize to internal types, not display strings
 * - Idempotent by edition identity and checksum
 * - Support preview before commit
 * - Store source metadata for parser drift debugging
 */

import { fetchWorkbookEpub } from "./jw-client.js";
import { parseWorkbookEpub } from "./epub-parser.js";
import { validateWorkbookEdition } from "./import-validator.js";
import type {
  ImportedEdition,
  ImportPreview,
  ImportResult,
} from "./types.js";
import prisma from "../../prisma.js";

/**
 * Preview a workbook import without persisting.
 * Fetches the EPUB from JW CDN, parses it, and returns structured data + warnings.
 */
export async function previewWorkbookImport(
  language: string,
  yearMonth: string,
): Promise<ImportPreview<ImportedEdition>> {
  const fetched = await fetchWorkbookEpub(language, yearMonth);
  const edition = await parseWorkbookEpub(
    fetched.data, language, yearMonth, fetched.url, fetched.checksum,
  );

  const validation = validateWorkbookEdition(edition);
  if (!validation.valid) {
    throw new Error(`Import validation failed: ${validation.errors.join("; ")}`);
  }

  // Check if this edition already exists
  const existing = await prisma.workbookEdition.findUnique({
    where: { language_yearMonth: { language, yearMonth } },
  });

  return {
    edition,
    warnings: validation.warnings,
    existingEditionId: existing?.id ?? null,
    wouldReplace: !!existing,
  };
}

/**
 * Commit a workbook import: persist edition, weeks, parts, create period + meetings + slots.
 */
export async function commitWorkbookImport(
  edition: ImportedEdition,
  actorId: string,
): Promise<ImportResult> {
  const warnings: string[] = [];

  return await prisma.$transaction(async (tx) => {
    // 1. Upsert WorkbookEdition
    const dbEdition = await tx.workbookEdition.upsert({
      where: {
        language_yearMonth: {
          language: edition.language,
          yearMonth: edition.yearMonth,
        },
      },
      update: {
        sourceUrl: edition.sourceUrl,
        sourcePublicationCode: edition.sourcePublicationCode,
        checksum: edition.checksum,
        rawMetadata: { parserVersion: "2.0-epub", fetchedAt: new Date().toISOString() },
        importedAt: new Date(),
      },
      create: {
        language: edition.language,
        yearMonth: edition.yearMonth,
        sourceUrl: edition.sourceUrl,
        sourcePublicationCode: edition.sourcePublicationCode,
        checksum: edition.checksum,
        rawMetadata: { parserVersion: "2.0-epub", fetchedAt: new Date().toISOString() },
      },
    });

    // 2. Clear auto-seeded assignments BEFORE deleting weeks/parts.
    // WorkbookPart deletion would fail if MeetingAssignment still references
    // them via workbookPartId FK (DB constraint is NO ACTION by default).
    const existingWeeks = await tx.workbookWeek.findMany({
      where: { editionId: dbEdition.id },
      select: { id: true },
    });
    if (existingWeeks.length > 0) {
      // Find all meetings linked to these weeks and delete their auto-seeded assignments
      const linkedMeetings = await tx.meeting.findMany({
        where: { workbookWeekId: { in: existingWeeks.map((w) => w.id) } },
        select: { id: true },
      });
      if (linkedMeetings.length > 0) {
        await tx.meetingAssignment.deleteMany({
          where: {
            meetingId: { in: linkedMeetings.map((m) => m.id) },
            source: "auto_seeded",
          },
        });
        // Unlink meetings from weeks (prevents cascade issues)
        await tx.meeting.updateMany({
          where: { workbookWeekId: { in: existingWeeks.map((w) => w.id) } },
          data: { workbookWeekId: null },
        });
      }
    }

    // Now safe to delete weeks/parts (no FK references remain)
    await tx.workbookWeek.deleteMany({
      where: { editionId: dbEdition.id },
    });

    // 3. Create weeks and parts
    for (const week of edition.weeks) {
      const dbWeek = await tx.workbookWeek.create({
        data: {
          editionId: dbEdition.id,
          weekOf: new Date(week.weekOf),
          dateRange: week.dateRange,
          theme: week.theme,
          bibleReading: week.bibleReading,
          songNumbers: week.songNumbers,
          sortOrder: week.sortOrder,
        },
      });

      for (const part of week.parts) {
        await tx.workbookPart.create({
          data: {
            weekId: dbWeek.id,
            section: part.section,
            partType: part.partType,
            title: part.title,
            durationMinutes: part.durationMinutes,
            sourceRef: part.sourceRef,
            sourceUrl: part.sourceUrl,
            requiresAssistant: part.requiresAssistant,
            sortOrder: part.sortOrder,
          },
        });
      }
    }

    // 4. Find existing or create MeetingPeriod (prevent duplicates)
    const weekDates = edition.weeks.map((w) => new Date(w.weekOf));
    const startDate = new Date(Math.min(...weekDates.map((d) => d.getTime())));
    const endDate = new Date(Math.max(...weekDates.map((d) => d.getTime())));
    // End date is the Sunday of the last week
    endDate.setDate(endDate.getDate() + 6);

    // Check for existing period linked to this edition
    let period = await tx.meetingPeriod.findFirst({
      where: { sourceEditionId: dbEdition.id },
    });

    if (period) {
      // Update existing period dates (reimport may shift them)
      period = await tx.meetingPeriod.update({
        where: { id: period.id },
        data: { startDate, endDate },
      });
    } else {
      period = await tx.meetingPeriod.create({
        data: {
          type: "midweek_workbook",
          status: "open",
          language: edition.language,
          startDate,
          endDate,
          sourceEditionId: dbEdition.id,
          openedBy: actorId,
          openedAt: new Date(),
        },
      });
    }

    // 5. Create meetings for each week + seed assignment slots
    let meetingsCreated = 0;
    let slotsSeeded = 0;

    // Get congregation settings for default meeting day/time
    const settings = await tx.congregationSettings.findFirst();
    const meetingDay = settings?.defaultMidweekDay ?? 3; // Wednesday
    const meetingTime = settings?.defaultMidweekTime ?? "19:00";

    // Get all midweek slot templates
    const slotTemplates = await tx.meetingSlotTemplate.findMany({
      where: {
        meetingType: { in: ["midweek", "all"] },
        isActive: true,
      },
      orderBy: { sortOrder: "asc" },
    });

    for (const week of edition.weeks) {
      const weekDate = new Date(week.weekOf);
      // Calculate meeting date (adjust to congregation's meeting day)
      const meetingDate = new Date(weekDate);
      const dayDiff = (meetingDay - weekDate.getDay() + 7) % 7;
      meetingDate.setDate(meetingDate.getDate() + dayDiff);

      // Check if meeting already exists for this date
      const existingMeeting = await tx.meeting.findFirst({
        where: {
          type: "midweek",
          date: meetingDate,
        },
      });

      const dbWeek = await tx.workbookWeek.findFirst({
        where: { editionId: dbEdition.id, weekOf: new Date(week.weekOf) },
        include: { parts: true },
      });

      let meetingId: string;

      if (existingMeeting) {
        // Link existing meeting to period/week
        await tx.meeting.update({
          where: { id: existingMeeting.id },
          data: {
            meetingPeriodId: period.id,
            workbookWeekId: dbWeek?.id,
            title: week.theme || `Midweek Meeting`,
          },
        });
        meetingId = existingMeeting.id;
      } else {
        const meeting = await tx.meeting.create({
          data: {
            title: week.theme || `Midweek Meeting`,
            type: "midweek",
            date: meetingDate,
            startTime: meetingTime,
            meetingPeriodId: period.id,
            workbookWeekId: dbWeek?.id,
            status: "draft",
          },
        });
        meetingId = meeting.id;
        meetingsCreated++;
      }

      // Seed assignment slots for program parts from workbook
      if (dbWeek?.parts) {
        for (const part of dbWeek.parts) {
          // Find matching slot template
          const slotTemplate = findSlotTemplateForPart(part.partType, slotTemplates);
          if (slotTemplate) {
            await tx.meetingAssignment.create({
              data: {
                meetingId,
                slotTemplateId: slotTemplate.id,
                workbookPartId: part.id,
                status: "pending",
                source: "auto_seeded",
              },
            });
            slotsSeeded++;
          }
        }
      }

      // Seed standalone program slots (chairman, prayers) — these are program
      // category but not linked to workbook parts
      const seededSlotIds = new Set(
        (dbWeek?.parts ?? [])
          .map((p) => findSlotTemplateForPart(p.partType, slotTemplates)?.id)
          .filter(Boolean),
      );
      const STANDALONE_SLOTS = ["chairman_midweek", "opening_prayer_midweek", "closing_prayer_midweek"];
      const standaloneTemplates = slotTemplates.filter(
        (t) => STANDALONE_SLOTS.includes(t.slotKey) && !seededSlotIds.has(t.id),
      );
      for (const tmpl of standaloneTemplates) {
        await tx.meetingAssignment.create({
          data: {
            meetingId,
            slotTemplateId: tmpl.id,
            status: "pending",
            source: "auto_seeded",
          },
        });
        slotsSeeded++;
      }

      // Seed duty slots (sound, video, attendants, etc.)
      const dutyTemplates = slotTemplates.filter((t) => t.category === "duty");
      for (const duty of dutyTemplates) {
        await tx.meetingAssignment.create({
          data: {
            meetingId,
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
      periodId: period.id,
      meetingsCreated,
      slotsSeeded,
      warnings,
    };
  });
}

/**
 * Match a workbook part type to a slot template.
 */
function findSlotTemplateForPart(
  partType: string,
  templates: { id: string; slotKey: string; category: string }[],
): { id: string } | undefined {
  const mapping: Record<string, string> = {
    gems: "gems",
    talk_treasures: "gems", // First treasures talk maps to gems slot
    bible_reading: "bible_reading",
    initial_call: "initial_call",
    return_visit: "return_visit",
    bible_study: "bible_study_demo",
    talk: "talk_midweek",
    cbs_conductor: "cbs_conductor",
    cbs_reader: "cbs_reader",
  };

  const slotKey = mapping[partType];
  if (!slotKey) return undefined;
  return templates.find((t) => t.slotKey === slotKey && t.category === "program");
}
