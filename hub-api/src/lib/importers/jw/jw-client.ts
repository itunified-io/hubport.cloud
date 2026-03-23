/**
 * JW.org HTTP client — fetches official content server-side.
 *
 * All network calls are centralized here for audit, caching, and retry.
 * Uses the official JW.org publication API endpoints.
 */

import { createHash } from "node:crypto";

const JW_BASE_URL = "https://www.jw.org";
const JW_PUB_API = "https://b.jw-cdn.org/apis/pub-media/GETPUBMEDIALINKS";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;

export interface JwFetchResult {
  html: string;
  url: string;
  checksum: string;
  fetchedAt: Date;
}

/**
 * Fetch a workbook edition page from JW.org.
 * Uses the meeting workbook publication listing.
 */
export async function fetchWorkbookEdition(
  language: string,
  yearMonth: string,
): Promise<JwFetchResult> {
  // JW.org uses specific language codes and publication codes
  // mwb = Meeting Workbook
  const [year, month] = yearMonth.split("-");
  const issueDate = `${year}${month.padStart(2, "0")}`;

  // Try the HTML content endpoint first
  const url = `${JW_BASE_URL}/${language}/библиотека/программа-встреч/mwb-${year}/${issueDate}/`;
  const fallbackUrl = `${JW_BASE_URL}/${language}/library/jw-meeting-workbook/mwb-${year}/${issueDate}/`;

  // Try language-appropriate URL patterns
  const urls = [
    `${JW_BASE_URL}/finder?wtlocale=${getWtLocale(language)}&pub=mwb&issue=${issueDate}`,
    fallbackUrl,
  ];

  let lastError: Error | null = null;

  for (const tryUrl of urls) {
    try {
      const html = await fetchWithRetry(tryUrl);
      const checksum = createHash("sha256").update(html).digest("hex");
      return { html, url: tryUrl, checksum, fetchedAt: new Date() };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw new Error(
    `Failed to fetch workbook edition ${yearMonth} for language ${language}: ${lastError?.message}`,
  );
}

/**
 * Fetch a Watchtower Study edition from JW.org.
 */
export async function fetchStudyEdition(
  language: string,
  issueKey: string,
): Promise<JwFetchResult> {
  // w = Watchtower (Study Edition)
  const wtLocale = getWtLocale(language);
  const url = `${JW_BASE_URL}/finder?wtlocale=${wtLocale}&pub=w&issue=${issueKey}`;

  const html = await fetchWithRetry(url);
  const checksum = createHash("sha256").update(html).digest("hex");
  return { html, url, checksum, fetchedAt: new Date() };
}

/**
 * Map ISO 639-1 language codes to JW.org wtlocale codes.
 */
function getWtLocale(language: string): string {
  const localeMap: Record<string, string> = {
    de: "X",      // German
    en: "E",      // English
    es: "S",      // Spanish
    fr: "F",      // French
    it: "I",      // Italian
    pt: "T",      // Portuguese
    ru: "U",      // Russian
    ja: "J",      // Japanese
    ko: "KO",     // Korean
    zh: "CHS",    // Chinese (Simplified)
    nl: "O",      // Dutch
    pl: "P",      // Polish
    ro: "M",      // Romanian
    sv: "Z",      // Swedish
    tr: "TK",     // Turkish
  };
  return localeMap[language] ?? language.toUpperCase();
}

/**
 * Fetch URL with retry and timeout.
 */
async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "hubport.cloud/1.0 (meeting-planner)",
          Accept: "text/html,application/xhtml+xml",
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.text();
    } catch (err) {
      if (attempt === retries) throw err;
      // Brief backoff before retry
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error("Unreachable");
}

export { getWtLocale };
