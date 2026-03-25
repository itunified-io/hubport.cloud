/**
 * EPUB-based Watchtower Study parser — extracts study article data from JW.org EPUB files.
 *
 * WT Study EPUB files contain XHTML with study articles. Each article file has:
 * - Article title in <h1> or <h2>
 * - Study article number (e.g., "STUDIENARTIKEL 13")
 * - Opening and closing song numbers ("Lied N")
 * - Scripture reference / theme text
 * - Article URL reference
 *
 * This parser extracts structured ImportedStudyEdition data from the EPUB.
 */

import JSZip from "jszip";
import type { ImportedStudyEdition, ImportedStudyWeek } from "./types.js";

/**
 * Parse a Watchtower Study EPUB into a normalized ImportedStudyEdition.
 */
export async function parseWtStudyEpub(
  epubData: ArrayBuffer,
  language: string,
  issueKey: string,
  checksum: string,
): Promise<ImportedStudyEdition> {
  const zip = await JSZip.loadAsync(epubData);

  // 1. Read TOC to discover study article files
  const tocXhtml = await readZipFile(zip, "OEBPS/toc.xhtml");
  const articleFiles = parseStudyToc(tocXhtml);

  // 2. Parse each study article file
  const weeks: ImportedStudyWeek[] = [];
  let sortOrder = 0;

  for (const entry of articleFiles) {
    const filePath = `OEBPS/${entry.file}`;
    const xhtml = await readZipFile(zip, filePath);
    if (!xhtml) continue;

    const article = parseStudyArticleXhtml(xhtml, issueKey, sortOrder);
    if (article) {
      weeks.push(article);
      sortOrder++;
    }
  }

  return { language, issueKey, checksum, weeks };
}

/* ---- TOC Parsing ---- */

interface StudyTocEntry {
  file: string;
  label: string;
}

/**
 * Parse the EPUB TOC to find study article XHTML files.
 *
 * Study articles are identified by their TOC labels containing article titles
 * (not cover pages, indexes, or navigation files).
 */
function parseStudyToc(tocXhtml: string): StudyTocEntry[] {
  const entries: StudyTocEntry[] = [];
  const linkRegex = /<a\s+href="(\d+\.xhtml)">([^<]+)<\/a>/g;
  let match;

  while ((match = linkRegex.exec(tocXhtml)) !== null) {
    const file = match[1];
    const label = cleanText(match[2]);

    // Study articles have descriptive titles — skip cover, navigation, index entries
    if (isStudyArticleTocEntry(label)) {
      entries.push({ file, label });
    }
  }

  return entries;
}

/**
 * Determine if a TOC entry label represents a study article.
 *
 * Study articles have descriptive titles like:
 * - "Jehova ist der Gott der Gerechtigkeit"
 * - "Vertraue auf Jehova und lebe!"
 *
 * Exclude:
 * - Cover/index pages (short labels, numeric)
 * - Date range entries (these are week headers in workbooks, not study articles)
 * - Song lists, references
 */
function isStudyArticleTocEntry(label: string): boolean {
  // Too short = likely navigation/cover
  if (label.length < 10) return false;
  // Pure numbers = page references
  if (/^\d+$/.test(label)) return false;
  // Date ranges (workbook pattern) — study articles don't have these
  if (/\d+[\.\-]\s*\d*\s*[\.\-]/.test(label) && /[A-Za-zÄÖÜäöü]/.test(label)) return false;
  // Skip common non-article entries
  if (/^(Cover|Inhaltsverzeichnis|Table of Contents|Index)/i.test(label)) return false;

  return true;
}

/* ---- Study Article XHTML Parsing ---- */

/**
 * Parse a single study article XHTML file.
 */
function parseStudyArticleXhtml(
  xhtml: string,
  issueKey: string,
  sortOrder: number,
): ImportedStudyWeek | null {
  // Extract article title from <h1> or first prominent heading
  const articleTitle = extractArticleTitle(xhtml);
  if (!articleTitle) return null;

  // Extract study article number (e.g., "STUDIENARTIKEL 13" or "STUDY ARTICLE 13")
  const studyNumber = extractStudyNumber(xhtml);

  // Extract article URL from JW.org link
  const articleUrl = extractArticleUrl(xhtml);

  // Extract source reference (scripture theme text)
  const sourceRef = extractSourceRef(xhtml);

  // Calculate the Sunday date for this study week
  const weekOf = calculateStudySunday(issueKey, sortOrder);

  return {
    weekOf,
    articleTitle,
    articleUrl,
    studyNumber,
    sourceRef,
    sortOrder,
  };
}

/* ---- Title Extraction ---- */

/**
 * Extract the study article title from the XHTML.
 *
 * The title is typically in an <h1> or <h2> element, and is the main
 * descriptive heading of the article.
 */
function extractArticleTitle(xhtml: string): string | null {
  // Try <h1> first
  const h1Match = xhtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  if (h1Match) {
    const title = cleanText(h1Match[1]);
    if (title.length > 5) return title;
  }

  // Try <h2> — some EPUBs use h2 for the main title
  const h2Match = xhtml.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
  if (h2Match) {
    const title = cleanText(h2Match[1]);
    if (title.length > 5) return title;
  }

  return null;
}

/* ---- Study Number Extraction ---- */

/**
 * Extract the study article number.
 *
 * Patterns (multilingual):
 * - "STUDIENARTIKEL 13" (German)
 * - "STUDY ARTICLE 13" (English)
 * - "ARTICLE D'ETUDE 13" (French)
 * - "ARTICULO DE ESTUDIO 13" (Spanish)
 */
function extractStudyNumber(xhtml: string): number | null {
  const pattern =
    /(?:STUDIENARTIKEL|STUDY\s*ARTICLE|ARTICLE\s*D[''\u2019](?:E|É)TUDE|ART[IÍ]CULO\s*DE\s*ESTUDIO)\s*(\d+)/i;

  const match = xhtml.match(pattern);
  if (match) {
    return parseInt(match[1], 10);
  }

  return null;
}

/* ---- Song Extraction ---- */

/**
 * Extract song numbers from the XHTML.
 * Songs appear as "Lied N" (German), "Song N" (English), etc.
 * Returns [opening, closing] in order of appearance.
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

/* ---- Article URL Extraction ---- */

/**
 * Extract JW.org article URL from the XHTML.
 */
function extractArticleUrl(xhtml: string): string | null {
  // Look for JW.org finder links
  const finderMatch = xhtml.match(/href="(https:\/\/www\.jw\.org\/finder\?[^"]+)"/);
  if (finderMatch) return finderMatch[1].replace(/&amp;/g, "&");

  // Look for direct JW.org links
  const directMatch = xhtml.match(/href="(https:\/\/www\.jw\.org\/[^"]+)"/);
  if (directMatch) return directMatch[1].replace(/&amp;/g, "&");

  return null;
}

/* ---- Source Reference Extraction ---- */

/**
 * Extract the theme scripture/reference from the article.
 *
 * Study articles often have a theme text, e.g.:
 * "Gerechtigkeit und Recht sind deines Thrones Grundfeste" (Ps. 89:14)
 */
function extractSourceRef(xhtml: string): string | null {
  // Look for theme/scripture text — often in a <p> with theme-related CSS class
  const themeMatch = xhtml.match(
    /<p[^>]*class="[^"]*(?:theme|themeScrp|p[a-z]*Theme)[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
  );
  if (themeMatch) {
    const text = cleanText(themeMatch[1]);
    if (text.length > 5) return text;
  }

  // Try extracting from <em> blocks near the top of the article
  const emMatch = xhtml.match(/<em[^>]*>([\s\S]*?)<\/em>/);
  if (emMatch) {
    const text = cleanText(emMatch[1]);
    // Scripture references are short-to-medium length
    if (text.length > 5 && text.length < 200) return text;
  }

  return null;
}

/* ---- Date Calculation ---- */

/**
 * Calculate the Sunday date for a study week based on issueKey and sortOrder.
 *
 * issueKey format: "YYYYMM" (e.g., "202603" for March 2026)
 *
 * WT Study editions typically contain articles for 2 months.
 * For example, issue 202603 covers March-April 2026.
 * Each article corresponds to a Sunday in sequence.
 */
function calculateStudySunday(issueKey: string, sortOrder: number): string {
  const match = issueKey.match(/(\d{4})(\d{2})/);
  if (!match) {
    // Fallback: generate from current date + offset
    const now = new Date();
    now.setDate(now.getDate() + sortOrder * 7);
    return snapToSunday(now);
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10); // 1-based

  // Find the first Sunday of the issue month
  const firstDay = new Date(year, month - 1, 1);
  const daysUntilSunday = (7 - firstDay.getDay()) % 7;
  const firstSunday = new Date(year, month - 1, 1 + daysUntilSunday);

  // Offset by sortOrder weeks
  const targetSunday = new Date(firstSunday);
  targetSunday.setDate(firstSunday.getDate() + sortOrder * 7);

  return targetSunday.toISOString().split("T")[0];
}

/**
 * Snap a date to the nearest Sunday (same week or current day if already Sunday).
 */
function snapToSunday(date: Date): string {
  const dayOfWeek = date.getDay();
  const sundayOffset = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  date.setDate(date.getDate() + sundayOffset);
  return date.toISOString().split("T")[0];
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

// Re-export extractSongs for use in the importer (song data for meetings)
export { extractSongs };
