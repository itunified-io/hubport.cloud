/**
 * Weekend study importer — parses Watchtower Study edition data from JW.org.
 */

import { fetchStudyEdition } from "./jw-client.js";
import { validateStudyEdition } from "./import-validator.js";
import type {
  ImportedStudyEdition,
  ImportedStudyWeek,
  ImportPreview,
  StudyImportResult,
} from "./types.js";
import prisma from "../../prisma.js";

/**
 * Preview a study edition import.
 */
export async function previewStudyImport(
  language: string,
  issueKey: string,
): Promise<ImportPreview<ImportedStudyEdition>> {
  const fetched = await fetchStudyEdition(language, issueKey);
  const edition = parseStudyHtml(fetched.html, language, issueKey, fetched.checksum);

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
 */
export async function commitStudyImport(
  edition: ImportedStudyEdition,
  _actorId: string,
): Promise<StudyImportResult> {
  const warnings: string[] = [];

  return await prisma.$transaction(async (tx) => {
    // 1. Upsert edition
    const dbEdition = await tx.weekendStudyEdition.upsert({
      where: {
        language_issueKey: {
          language: edition.language,
          issueKey: edition.issueKey,
        },
      },
      update: {
        checksum: edition.checksum,
        rawMetadata: { parserVersion: "1.0", fetchedAt: new Date().toISOString() },
        importedAt: new Date(),
      },
      create: {
        language: edition.language,
        issueKey: edition.issueKey,
        checksum: edition.checksum,
        rawMetadata: { parserVersion: "1.0", fetchedAt: new Date().toISOString() },
      },
    });

    // 2. Delete existing weeks for reimport
    await tx.weekendStudyWeek.deleteMany({
      where: { editionId: dbEdition.id },
    });

    // 3. Create study weeks
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

    // 4. Link study weeks to existing weekend meetings
    let meetingsLinked = 0;
    for (const week of edition.weeks) {
      const studyWeek = await tx.weekendStudyWeek.findFirst({
        where: { editionId: dbEdition.id, weekOf: new Date(week.weekOf) },
      });
      if (!studyWeek) continue;

      // Find weekend meeting on or near this Sunday
      const sunday = new Date(week.weekOf);
      const settings = await tx.congregationSettings.findFirst();
      const weekendDay = settings?.defaultWeekendDay ?? 0;

      // Calculate meeting date for this week
      const meetingDate = new Date(sunday);
      if (weekendDay !== 0) {
        meetingDate.setDate(sunday.getDate() + weekendDay);
      }

      const meeting = await tx.meeting.findFirst({
        where: {
          type: "weekend",
          date: meetingDate,
        },
      });

      if (meeting) {
        await tx.meeting.update({
          where: { id: meeting.id },
          data: { weekendStudyWeekId: studyWeek.id },
        });
        meetingsLinked++;
      }
    }

    return {
      editionId: dbEdition.id,
      weeksCreated,
      meetingsLinked,
      warnings,
    };
  });
}

/**
 * Parse study edition HTML into normalized data.
 */
export function parseStudyHtml(
  html: string,
  language: string,
  issueKey: string,
  checksum: string,
): ImportedStudyEdition {
  const weeks: ImportedStudyWeek[] = [];

  // Try to extract study articles from HTML
  // Watchtower Study articles typically have specific class patterns
  const articlePattern = /<article[^>]*>([\s\S]*?)<\/article>/gi;
  const articles = [...html.matchAll(articlePattern)];

  let sortOrder = 0;
  for (const match of articles) {
    const articleHtml = match[1];

    // Extract title
    const titleMatch = articleHtml.match(/<h[12][^>]*>([^<]+)<\/h[12]>/);
    const title = titleMatch ? cleanText(titleMatch[1]) : "";
    if (!title) continue;

    // Skip non-study articles (e.g., life stories, questions)
    if (isStudyArticle(articleHtml)) {
      sortOrder++;

      // Extract study article URL
      const urlMatch = articleHtml.match(/href="([^"]+)"/);
      const url = urlMatch ? urlMatch[1] : null;

      // Calculate week date (Sundays)
      const weekDate = calculateStudyWeekDate(issueKey, sortOrder);

      weeks.push({
        weekOf: weekDate,
        articleTitle: title,
        articleUrl: url ? ensureAbsoluteUrl(url) : null,
        studyNumber: sortOrder,
        sourceRef: null,
        sortOrder,
      });
    }
  }

  // Fallback if structured parsing finds nothing
  if (weeks.length === 0) {
    return createPlaceholderStudyEdition(language, issueKey, checksum);
  }

  return { language, issueKey, checksum, weeks };
}

function isStudyArticle(html: string): boolean {
  // Study articles typically contain paragraph numbering and questions
  return /(?:study|estudio|étude|studium)/i.test(html) ||
    /class="[^"]*(?:study|qu)[^"]*"/i.test(html);
}

function cleanText(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function ensureAbsoluteUrl(url: string): string {
  if (url.startsWith("http")) return url;
  return `https://www.jw.org${url}`;
}

function calculateStudyWeekDate(issueKey: string, articleIndex: number): string {
  // issueKey format: "YYYYMM" or "w_YYYY_MM"
  const match = issueKey.match(/(\d{4})[\-_]?(\d{2})/);
  if (!match) {
    const now = new Date();
    now.setDate(now.getDate() + (articleIndex - 1) * 7);
    return now.toISOString().split("T")[0];
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);

  // Calculate the nth Sunday of the month
  const firstDay = new Date(year, month - 1, 1);
  const daysUntilSunday = (7 - firstDay.getDay()) % 7;
  const firstSunday = new Date(year, month - 1, 1 + daysUntilSunday);
  const targetSunday = new Date(firstSunday);
  targetSunday.setDate(firstSunday.getDate() + (articleIndex - 1) * 7);

  return targetSunday.toISOString().split("T")[0];
}

function createPlaceholderStudyEdition(
  language: string,
  issueKey: string,
  checksum: string,
): ImportedStudyEdition {
  const match = issueKey.match(/(\d{4})[\-_]?(\d{2})/);
  const year = match ? parseInt(match[1], 10) : new Date().getFullYear();
  const month = match ? parseInt(match[2], 10) : new Date().getMonth() + 1;

  const weeks: ImportedStudyWeek[] = [];
  const firstDay = new Date(year, month - 1, 1);
  const daysUntilSunday = (7 - firstDay.getDay()) % 7;
  let sunday = new Date(year, month - 1, 1 + daysUntilSunday);

  for (let i = 0; i < 4; i++) {
    if (sunday.getMonth() >= month && i > 0) break;
    weeks.push({
      weekOf: sunday.toISOString().split("T")[0],
      articleTitle: `Study Article ${i + 1}`,
      articleUrl: null,
      studyNumber: i + 1,
      sourceRef: null,
      sortOrder: i,
    });
    sunday = new Date(sunday);
    sunday.setDate(sunday.getDate() + 7);
  }

  return { language, issueKey, checksum, weeks };
}
