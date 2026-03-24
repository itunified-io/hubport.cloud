/**
 * EPUB-based workbook parser — extracts structured meeting data from JW.org EPUB files.
 *
 * EPUB files from JW CDN contain well-structured XHTML with consistent CSS classes:
 * - dc-icon--gem   + teal-600  = SCHÄTZE AUS GOTTES WORT (treasures)
 * - dc-icon--wheat + gold-600  = UNS IM DIENST VERBESSERN (ministry)
 * - dc-icon--sheep + red-600   = UNSER LEBEN ALS CHRIST (living)
 * - dc-icon--music             = Song markers (Lied N)
 *
 * This parser replaces the fragile HTML scraper with reliable EPUB extraction.
 */

import JSZip from "jszip";
import type { ImportedEdition, ImportedWeek, ImportedPart } from "./types.js";

/**
 * Parse a workbook EPUB into a normalized ImportedEdition.
 */
export async function parseWorkbookEpub(
  epubData: ArrayBuffer,
  language: string,
  yearMonth: string,
  sourceUrl: string,
  checksum: string,
): Promise<ImportedEdition> {
  const zip = await JSZip.loadAsync(epubData);

  // 1. Read TOC to discover week files and their date ranges
  const tocXhtml = await readZipFile(zip, "OEBPS/toc.xhtml");
  const weekFiles = parseToc(tocXhtml);

  // 2. Parse each week file
  const weeks: ImportedWeek[] = [];
  for (let i = 0; i < weekFiles.length; i++) {
    const filePath = `OEBPS/${weekFiles[i].file}`;
    const xhtml = await readZipFile(zip, filePath);
    if (!xhtml) continue;

    const week = parseWeekXhtml(xhtml, yearMonth, i);
    if (week) weeks.push(week);
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

/* ---- TOC Parsing ---- */

interface TocEntry {
  file: string;
  label: string;
}

function parseToc(tocXhtml: string): TocEntry[] {
  const entries: TocEntry[] = [];
  // Match <a href="NNNNNN.xhtml">date range</a> entries — skip cover/pagenav
  const linkRegex = /<a\s+href="(\d+\.xhtml)">([^<]+)<\/a>/g;
  let match;

  while ((match = linkRegex.exec(tocXhtml)) !== null) {
    const file = match[1];
    const label = cleanText(match[2]);

    // Week entries contain date ranges like "6.-12. Juli" or "27. Juli–2. August"
    if (/\d+[\.\-]/.test(label) && /[A-Za-zÄÖÜäöü]/.test(label)) {
      entries.push({ file, label });
    }
  }

  return entries;
}

/* ---- Week XHTML Parsing ---- */

function parseWeekXhtml(xhtml: string, yearMonth: string, sortOrder: number): ImportedWeek | null {
  // Extract date range from <h1>
  const h1Match = xhtml.match(/<h1[^>]*>([^]*?)<\/h1>/);
  const dateRangeRaw = h1Match ? cleanText(h1Match[1]) : "";

  // Extract bible reading from <h2> (scripture reference)
  const h2Match = xhtml.match(/<h2[^>]*>([^]*?)<\/h2>/);
  const bibleReading = h2Match ? cleanText(h2Match[1]) : "";

  // Calculate weekOf (Monday) from yearMonth and sortOrder
  const weekOf = calculateWeekOf(yearMonth, sortOrder, dateRangeRaw);
  if (!weekOf) return null;

  // Extract all song numbers (Lied N pattern)
  const songNumbers = extractSongs(xhtml);

  // Extract theme from first sub-heading or scripture context
  const theme = extractTheme(xhtml);

  // Parse parts by section using CSS class markers
  const parts = parsePartsBySections(xhtml);

  return {
    weekOf,
    dateRange: dateRangeRaw,
    theme,
    bibleReading,
    songNumbers,
    sortOrder,
    parts,
  };
}

/* ---- Section & Part Parsing ---- */

type Section = "treasures" | "ministry" | "living";

/**
 * Parse all program parts by splitting on section markers (gem/wheat/sheep icons).
 *
 * The EPUB uses div elements with dc-icon--gem, dc-icon--wheat, dc-icon--sheep
 * to delimit the three meeting sections.
 */
function parsePartsBySections(xhtml: string): ImportedPart[] {
  const parts: ImportedPart[] = [];
  let globalSortOrder = 0;

  // Split by section markers
  const sectionMarkers = [
    { section: "treasures" as Section, pattern: /dc-icon--gem/ },
    { section: "ministry" as Section, pattern: /dc-icon--wheat/ },
    { section: "living" as Section, pattern: /dc-icon--sheep/ },
  ];

  // Find section boundaries by scanning for icon markers
  const sections: { section: Section; start: number; end: number }[] = [];

  for (const marker of sectionMarkers) {
    const idx = xhtml.search(marker.pattern);
    if (idx >= 0) {
      sections.push({ section: marker.section, start: idx, end: xhtml.length });
    }
  }

  // Sort by position and set end boundaries
  sections.sort((a, b) => a.start - b.start);
  for (let i = 0; i < sections.length - 1; i++) {
    sections[i].end = sections[i + 1].start;
  }

  // Parse parts within each section
  for (const sec of sections) {
    const sectionHtml = xhtml.slice(sec.start, sec.end);
    const sectionParts = extractPartsFromSection(sectionHtml, sec.section);

    for (const part of sectionParts) {
      parts.push({ ...part, sortOrder: globalSortOrder++ });
    }
  }

  return parts;
}

/**
 * Extract numbered parts from a section's HTML.
 *
 * Parts are identified by <h3> elements containing numbered titles like:
 *   "1. Jehova verdient unseren Gehorsam"
 * followed by <p> with duration like:
 *   "(10 Min.)"
 */
function extractPartsFromSection(html: string, section: Section): Omit<ImportedPart, "sortOrder">[] {
  const parts: Omit<ImportedPart, "sortOrder">[] = [];

  // Match numbered h3 parts: "N. Title"
  const h3Regex = /<h3[^>]*>([^]*?)<\/h3>/g;
  let match;

  while ((match = h3Regex.exec(html)) !== null) {
    const h3Text = cleanText(match[1]);
    const h3End = match.index + match[0].length;

    // Skip song entries (they have dc-icon--music)
    if (match[0].includes("dc-icon--music")) continue;
    // Skip "Schlussworte" — it's the chairman's closing, not a part
    if (/Schlussworte|Concluding/i.test(h3Text)) continue;

    // Extract part number and title: "N. Title" or just "Title"
    const numberedMatch = h3Text.match(/^(\d+)\.\s*(.+)/);
    const title = numberedMatch ? numberedMatch[2].trim() : h3Text.trim();
    if (!title) continue;

    // Look ahead for duration in next <p> element
    const afterH3 = html.slice(h3End, h3End + 500);
    const durationMatch = afterH3.match(/\((\d+)\s*Min\.?\)/);
    const duration = durationMatch ? parseInt(durationMatch[1], 10) : null;

    // Extract source reference (scripture or publication ref)
    const sourceRef = extractSourceRef(afterH3);

    // Infer part type from title and section
    const partType = inferPartTypeFromEpub(title, section, afterH3);
    if (!partType) continue;

    // Determine if part requires an assistant (student demos in ministry section)
    const requiresAssistant = isStudentDemo(partType, section);

    parts.push({
      section,
      partType,
      title,
      durationMinutes: duration,
      sourceRef,
      sourceUrl: null,
      requiresAssistant,
    });
  }

  return parts;
}

/**
 * Infer the internal part type from the German title and section context.
 *
 * Mapping:
 * - Treasures: talk_treasures (first numbered), gems ("Schätzen graben"), bible_reading
 * - Ministry: initial_call ("Gespräche beginnen"), return_visit ("Interesse fördern"),
 *             bible_study ("Jüngern machen"), talk ("Vortrag")
 * - Living: talk (default), cbs_conductor ("Versammlungsbibelstudium"/"VBS")
 */
function inferPartTypeFromEpub(
  title: string,
  section: Section,
  context: string,
): string | null {
  const lower = title.toLowerCase();
  const ctxLower = context.toLowerCase();

  // Treasures section
  if (section === "treasures") {
    if (/bibellesung|bible reading|lectura/i.test(lower)) return "bible_reading";
    if (/schätzen?\s*graben|gems|joyaux/i.test(lower)) return "gems";
    // First numbered part in treasures = main talk
    return "talk_treasures";
  }

  // Ministry section
  if (section === "ministry") {
    if (/gespräch.?\s*beginnen|starting\s*conversations?|initial\s*call|primera/i.test(lower)) return "initial_call";
    if (/interesse\s*fördern|making\s*return|return\s*visit|revisita/i.test(lower)) return "return_visit";
    if (/jünger.?\s*machen|making\s*disciples?|bible\s*study|estudio/i.test(lower)) return "bible_study";
    if (/vortrag|talk|discurso/i.test(lower)) return "talk";
    // Generic ministry part — check context for clues
    if (/haus\s*zu\s*haus|informell|öffentlich/i.test(ctxLower)) return "initial_call";
    return "talk"; // fallback for ministry parts
  }

  // Living section
  if (section === "living") {
    if (/versammlungs.?bibelstudium|vbs|congregation\s*bible\s*study/i.test(lower)) return "cbs_conductor";
    return "talk";
  }

  return null;
}

/**
 * Check if a ministry part is a student demonstration (requires assistant).
 * Student demos: initial_call, return_visit, bible_study.
 * Talks ("Vortrag") in ministry DO NOT require an assistant.
 */
function isStudentDemo(partType: string, section: Section): boolean {
  if (section !== "ministry") return false;
  return ["initial_call", "return_visit", "bible_study"].includes(partType);
}

/* ---- Song Extraction ---- */

/**
 * Extract all song numbers from the XHTML.
 * Songs appear as "Lied N" (German), "Song N" (English), "Canción N" (Spanish).
 * Returns [opening, middle, closing] in order of appearance.
 */
function extractSongs(xhtml: string): number[] {
  const songRegex = /(?:Lied|Song|Canción|Cantique)\s+(\d+)/gi;
  const songs: number[] = [];
  let match;

  while ((match = songRegex.exec(xhtml)) !== null) {
    const num = parseInt(match[1], 10);
    if (num > 0 && num < 200 && !songs.includes(num)) {
      songs.push(num);
    }
  }

  return songs;
}

/* ---- Theme Extraction ---- */

/**
 * Extract the weekly theme from the XHTML content.
 * The theme is in a <p> after the treasures section header image area.
 */
function extractTheme(xhtml: string): string {
  // Look for theme text after the gem icon section header
  const gemIdx = xhtml.indexOf("dc-icon--gem");
  if (gemIdx >= 0) {
    const afterGem = xhtml.slice(gemIdx);
    // Find first plain <p> with theme-like content (not a duration or numbered point)
    const pMatches = afterGem.matchAll(/<p[^>]*class="p\d+"[^>]*>([^<]+)<\/p>/g);
    for (const pMatch of pMatches) {
      const text = cleanText(pMatch[1]);
      // Theme is a descriptive phrase — not a duration, not too short, not too long
      if (text && !/^\(\d+/.test(text) && text.length > 5 && text.length < 200) {
        return text;
      }
    }
  }

  return "";
}

/* ---- Source Reference Extraction ---- */

function extractSourceRef(html: string): string | null {
  // Extract scripture reference from noteref links
  const noterefMatch = html.match(
    /<a\s+epub:type="noteref"[^>]*>([^<]+)<\/a>/,
  );
  if (noterefMatch) return cleanText(noterefMatch[1]);

  // Extract publication reference from italic text
  const pubMatch = html.match(/<em>([^<]+)<\/em>/);
  if (pubMatch) return cleanText(pubMatch[1]);

  return null;
}

/* ---- Date Calculation ---- */

/**
 * Calculate the Monday (weekOf) date from yearMonth and sort order.
 * The TOC provides date ranges like "6.-12. Juli" or "27. Juli–2. August".
 */
function calculateWeekOf(yearMonth: string, sortOrder: number, dateRange: string): string | null {
  const [year, month] = yearMonth.split("-").map(Number);

  // Try to extract start day from date range
  const dayMatch = dateRange.match(/^(\d+)/);
  if (dayMatch) {
    const day = parseInt(dayMatch[1], 10);
    // For bimonthly editions: determine which month based on sortOrder and day
    let m = month;
    if (sortOrder >= 4 || (sortOrder >= 3 && day < 10)) {
      m = month + 1;
    }
    let y = year;
    if (m > 12) { m -= 12; y++; }

    const date = new Date(y, m - 1, day);
    // Snap to Monday
    const dayOfWeek = date.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    date.setDate(date.getDate() + mondayOffset);
    return date.toISOString().split("T")[0];
  }

  // Fallback: generate from sortOrder
  const firstDay = new Date(year, month - 1, 1);
  const daysUntilMonday = (8 - firstDay.getDay()) % 7;
  const monday = new Date(year, month - 1, firstDay.getDate() + daysUntilMonday + sortOrder * 7);
  return monday.toISOString().split("T")[0];
}

/* ---- Utilities ---- */

function cleanText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\u00AD/g, "") // Remove soft hyphens
    .replace(/\s+/g, " ")
    .trim();
}

async function readZipFile(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`File not found in EPUB: ${path}`);
  return await file.async("text");
}
