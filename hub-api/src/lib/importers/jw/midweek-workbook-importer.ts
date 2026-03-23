/**
 * Midweek workbook importer — parses JW.org HTML into normalized internal types.
 *
 * Parser rules:
 * - Prefer HTML over PDF
 * - Normalize to internal types, not display strings
 * - Idempotent by edition identity and checksum
 * - Support preview before commit
 * - Store source metadata for parser drift debugging
 */

import { fetchWorkbookEdition } from "./jw-client.js";
import { validateWorkbookEdition } from "./import-validator.js";
import type {
  ImportedEdition,
  ImportedWeek,
  ImportedPart,
  ImportPreview,
  ImportResult,
} from "./types.js";
import prisma from "../../prisma.js";

/**
 * Preview a workbook import without persisting.
 * Returns parsed data + warnings + whether it would replace an existing edition.
 */
export async function previewWorkbookImport(
  language: string,
  yearMonth: string,
): Promise<ImportPreview<ImportedEdition>> {
  const fetched = await fetchWorkbookEdition(language, yearMonth);
  const edition = parseWorkbookHtml(fetched.html, language, yearMonth, fetched.url, fetched.checksum);

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
        rawMetadata: { parserVersion: "1.0", fetchedAt: new Date().toISOString() },
        importedAt: new Date(),
      },
      create: {
        language: edition.language,
        yearMonth: edition.yearMonth,
        sourceUrl: edition.sourceUrl,
        sourcePublicationCode: edition.sourcePublicationCode,
        checksum: edition.checksum,
        rawMetadata: { parserVersion: "1.0", fetchedAt: new Date().toISOString() },
      },
    });

    // 2. Delete existing weeks/parts for reimport (cascade handles parts)
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

    // 4. Create or update MeetingPeriod
    const weekDates = edition.weeks.map((w) => new Date(w.weekOf));
    const startDate = new Date(Math.min(...weekDates.map((d) => d.getTime())));
    const endDate = new Date(Math.max(...weekDates.map((d) => d.getTime())));
    // End date is the Sunday of the last week
    endDate.setDate(endDate.getDate() + 6);

    const period = await tx.meetingPeriod.create({
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

/**
 * Parse workbook HTML into normalized ImportedEdition.
 *
 * This is a structured parser that extracts weeks and parts from JW.org HTML.
 * If the HTML structure changes, this parser needs updating.
 */
export function parseWorkbookHtml(
  html: string,
  language: string,
  yearMonth: string,
  sourceUrl: string,
  checksum: string,
): ImportedEdition {
  const weeks: ImportedWeek[] = [];

  // JW.org workbook HTML uses specific class patterns for weeks and parts.
  // This parser handles the common patterns; language-specific variations
  // may need additional rules.

  // Split by week sections — JW.org uses various markers
  const weekPattern = /<h[12][^>]*class="[^"]*(?:du-color--gold|dc-icon)[^"]*"[^>]*>/gi;
  const weekSections = html.split(weekPattern).slice(1); // Skip preamble

  // If structured parsing fails, try a simpler approach
  if (weekSections.length === 0) {
    return parseWorkbookSimple(html, language, yearMonth, sourceUrl, checksum);
  }

  let sortOrder = 0;
  for (const section of weekSections) {
    sortOrder++;
    const week = parseWeekSection(section, sortOrder);
    if (week) {
      weeks.push(week);
    }
  }

  // If no weeks found from structured parse, use simple parser
  if (weeks.length === 0) {
    return parseWorkbookSimple(html, language, yearMonth, sourceUrl, checksum);
  }

  return {
    language,
    yearMonth,
    sourceUrl,
    sourcePublicationCode: "mwb",
    checksum,
    weeks,
  };
}

/**
 * Simple/fallback parser — generates placeholder weeks for a month.
 * Used when the HTML structure doesn't match expected patterns.
 */
function parseWorkbookSimple(
  _html: string,
  language: string,
  yearMonth: string,
  sourceUrl: string,
  checksum: string,
): ImportedEdition {
  const [year, month] = yearMonth.split("-").map(Number);
  const weeks: ImportedWeek[] = [];

  // Generate weeks for the month (Mondays)
  const firstDay = new Date(year, month - 1, 1);
  const daysUntilMonday = (8 - firstDay.getDay()) % 7;
  const firstMonday = new Date(year, month - 1, firstDay.getDate() + daysUntilMonday);

  if (firstDay.getDay() !== 1 && firstDay.getDay() !== 0) {
    // If month doesn't start on Mon/Sun, include partial first week
    const prevMonday = new Date(firstDay);
    prevMonday.setDate(firstDay.getDate() - ((firstDay.getDay() + 6) % 7));
    if (prevMonday.getMonth() === month - 1 || prevMonday.getDate() > 24) {
      weeks.push(createPlaceholderWeek(prevMonday, weeks.length));
    }
  }

  let current = new Date(firstMonday);
  while (current.getMonth() === month - 1 || (current.getMonth() === month && current.getDate() <= 7)) {
    if (current.getMonth() <= month - 1 || weeks.length < 5) {
      weeks.push(createPlaceholderWeek(current, weeks.length));
    }
    current = new Date(current);
    current.setDate(current.getDate() + 7);
    if (weeks.length >= 5) break; // Max 5 weeks per month
  }

  return {
    language,
    yearMonth,
    sourceUrl,
    sourcePublicationCode: "mwb",
    checksum,
    weeks,
  };
}

function createPlaceholderWeek(monday: Date, index: number): ImportedWeek {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const dateRange = `${formatDate(monday)}–${formatDate(sunday)}`;

  return {
    weekOf: monday.toISOString().split("T")[0],
    dateRange,
    theme: "",
    bibleReading: "",
    songNumbers: [],
    sortOrder: index,
    parts: createDefaultMidweekParts(),
  };
}

function createDefaultMidweekParts(): ImportedPart[] {
  return [
    { section: "treasures", partType: "gems", title: "Spiritual Gems", durationMinutes: 10, sourceRef: null, sourceUrl: null, requiresAssistant: false, sortOrder: 0 },
    { section: "treasures", partType: "bible_reading", title: "Bible Reading", durationMinutes: 4, sourceRef: null, sourceUrl: null, requiresAssistant: false, sortOrder: 1 },
    { section: "ministry", partType: "initial_call", title: "Initial Call", durationMinutes: 3, sourceRef: null, sourceUrl: null, requiresAssistant: true, sortOrder: 2 },
    { section: "ministry", partType: "return_visit", title: "Return Visit", durationMinutes: 4, sourceRef: null, sourceUrl: null, requiresAssistant: true, sortOrder: 3 },
    { section: "ministry", partType: "bible_study", title: "Bible Study", durationMinutes: 5, sourceRef: null, sourceUrl: null, requiresAssistant: true, sortOrder: 4 },
    { section: "living", partType: "talk", title: "Talk", durationMinutes: 15, sourceRef: null, sourceUrl: null, requiresAssistant: false, sortOrder: 5 },
    { section: "living", partType: "cbs_conductor", title: "Congregation Bible Study", durationMinutes: 30, sourceRef: null, sourceUrl: null, requiresAssistant: false, sortOrder: 6 },
  ];
}

/**
 * Parse a single week section from HTML.
 */
function parseWeekSection(html: string, sortOrder: number): ImportedWeek | null {
  // Extract date range from header
  const dateMatch = html.match(/(\w+\s+\d+)\s*[-–]\s*(\w+\s+\d+)/);
  const dateRange = dateMatch ? dateMatch[0] : "";

  // Extract theme/scripture
  const themeMatch = html.match(/<em[^>]*>([^<]+)<\/em>/);
  const theme = themeMatch ? cleanText(themeMatch[1]) : "";

  // Try to determine weekOf from date range
  const weekOf = extractWeekDate(dateRange, sortOrder) ?? "";
  if (!weekOf) return null;

  // Parse parts by section
  const parts: ImportedPart[] = [];
  let partSortOrder = 0;

  // Look for section markers
  const sectionPatterns = [
    { section: "treasures" as const, pattern: /SCHÄTZE|TREASURES|TESOROS|TRÉSORS/i },
    { section: "ministry" as const, pattern: /DIENST|MINISTRY|MINISTERIO|MINISTÈRE|VERBESSERN/i },
    { section: "living" as const, pattern: /LEBEN|LIVING|VIVAMOS|NOTRE VIE/i },
  ];

  let currentSection: "treasures" | "ministry" | "living" = "treasures";
  const lines = html.split(/<(?:li|p|div)[^>]*>/);

  for (const line of lines) {
    const cleanLine = cleanText(line);
    if (!cleanLine) continue;

    // Check for section change
    for (const sp of sectionPatterns) {
      if (sp.pattern.test(cleanLine)) {
        currentSection = sp.section;
      }
    }

    // Extract duration and part info
    const durationMatch = cleanLine.match(/\((\d+)\s*[Mm]in\.?\)/);
    const duration = durationMatch ? parseInt(durationMatch[1], 10) : null;

    if (duration || isPartTitle(cleanLine)) {
      const partType = inferPartType(cleanLine, currentSection);
      if (partType) {
        parts.push({
          section: currentSection,
          partType,
          title: cleanLine.replace(/\(\d+\s*[Mm]in\.?\)/, "").trim(),
          durationMinutes: duration,
          sourceRef: null,
          sourceUrl: null,
          requiresAssistant: partType === "initial_call" || partType === "return_visit" || partType === "bible_study",
          sortOrder: partSortOrder++,
        });
      }
    }
  }

  // If no parts parsed, use defaults
  if (parts.length === 0) {
    return {
      weekOf,
      dateRange,
      theme,
      bibleReading: "",
      songNumbers: [],
      sortOrder,
      parts: createDefaultMidweekParts(),
    };
  }

  // Extract song numbers
  const songMatches = html.matchAll(/[Ll]ied\s*(\d+)|[Ss]ong\s*(\d+)|[Cc]anción\s*(\d+)/g);
  const songNumbers = [...songMatches].map((m) => parseInt(m[1] || m[2] || m[3], 10)).filter(Boolean);

  return {
    weekOf,
    dateRange,
    theme,
    bibleReading: "",
    songNumbers,
    sortOrder,
    parts,
  };
}

function cleanText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function isPartTitle(text: string): boolean {
  return /\(\d+\s*[Mm]in/.test(text) || /Bibellesung|Bible Reading|Lectura/i.test(text);
}

function inferPartType(text: string, section: "treasures" | "ministry" | "living"): string | null {
  const lower = text.toLowerCase();

  if (/schätze|gems|gemas|joyaux/i.test(lower)) return "gems";
  if (/bibellesung|bible reading|lectura/i.test(lower)) return "bible_reading";
  if (/erstes? gespräch|initial call|primera visita|premier contact/i.test(lower)) return "initial_call";
  if (/rückbesuch|return visit|revisita|nouvelle visite/i.test(lower)) return "return_visit";
  if (/bibelstudium|bible study|estudio bíblico|étude biblique/i.test(lower) && section === "ministry") return "bible_study";
  if (/vortrag|talk|discurso|allocution/i.test(lower) && section === "living") return "talk";
  if (/VBS|congregation bible study|estudio bíblico de la congregación/i.test(lower)) return "cbs_conductor";

  return null;
}

function extractWeekDate(dateRange: string, sortOrder: number): string | null {
  // Try to parse "Month Day" pattern
  const match = dateRange.match(/(\w+)\s+(\d+)/);
  if (!match) {
    // Fallback: generate date based on sort order in current/next month
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysUntilMonday = (8 - monday.getDay()) % 7;
    monday.setDate(monday.getDate() + daysUntilMonday + (sortOrder - 1) * 7);
    return monday.toISOString().split("T")[0];
  }
  return null;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}
