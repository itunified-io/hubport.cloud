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

export interface JwEpubResult {
  data: ArrayBuffer;
  url: string;
  checksum: string;
  fetchedAt: Date;
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

/**
 * Fetch the EPUB file for a workbook edition from JW CDN.
 * Uses the pub-media API to discover the download URL, then fetches the binary.
 */
export async function fetchWorkbookEpub(
  language: string,
  yearMonth: string,
): Promise<JwEpubResult> {
  const [year, month] = yearMonth.split("-");
  const issueCode = `${year}${month.padStart(2, "0")}`;
  const wtLocale = getWtLocale(language);

  // 1. Query pub-media API for EPUB download URL
  const apiUrl = `${JW_PUB_API}?output=json&pub=mwb&fileformat=EPUB&alllangs=0&langwritten=${wtLocale}&issue=${issueCode}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const apiRes = await fetch(apiUrl, {
    signal: controller.signal,
    headers: { Accept: "application/json", "User-Agent": "hubport.cloud/1.0 (meeting-planner)" },
  });
  clearTimeout(timeout);

  if (!apiRes.ok) {
    throw new Error(`pub-media API returned ${apiRes.status} for mwb ${issueCode} (${wtLocale})`);
  }

  const apiData = (await apiRes.json()) as {
    files?: Record<string, { EPUB?: { file: { url: string; checksum: string } }[] }>;
  };

  const langFiles = apiData.files?.[wtLocale];
  const epubEntry = langFiles?.EPUB?.[0];
  if (!epubEntry?.file?.url) {
    throw new Error(`No EPUB available for mwb ${issueCode} in language ${wtLocale}`);
  }

  // 2. Download the EPUB binary
  const epubUrl = epubEntry.file.url;
  const epubRes = await fetchBinaryWithRetry(epubUrl);
  const checksum = createHash("sha256").update(Buffer.from(epubRes)).digest("hex");

  return { data: epubRes, url: epubUrl, checksum, fetchedAt: new Date() };
}

/**
 * Fetch a URL as binary (ArrayBuffer) with retry.
 */
async function fetchBinaryWithRetry(url: string, retries = MAX_RETRIES): Promise<ArrayBuffer> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000); // 30s for binary download

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "hubport.cloud/1.0 (meeting-planner)" },
      });
      clearTimeout(timeout);

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return await response.arrayBuffer();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error("Unreachable");
}

export { getWtLocale };
