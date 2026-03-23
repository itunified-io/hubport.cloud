/**
 * Check which workbook editions are available on JW.org.
 *
 * Uses the JW.org publication media API to check availability
 * without downloading full content.
 */

import { getWtLocale } from "./jw-client.js";

const JW_PUB_MEDIA_API = "https://b.jw-cdn.org/apis/pub-media/GETPUBMEDIALINKS";

export interface EditionAvailability {
  yearMonth: string;
  label: string;
  available: boolean;
  publicationCode: string;
  url: string | null;
}

/**
 * Check availability of workbook editions for a language.
 * Returns current month ± range of months.
 */
export async function checkWorkbookAvailability(
  language: string,
  rangeMonths = 6,
): Promise<EditionAvailability[]> {
  const wtLocale = getWtLocale(language);
  const now = new Date();
  const results: EditionAvailability[] = [];

  // Check from 2 months ago to rangeMonths ahead
  for (let offset = -2; offset <= rangeMonths; offset++) {
    const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const yearMonth = `${year}-${String(month).padStart(2, "0")}`;
    const issueDate = `${year}${String(month).padStart(2, "0")}`;

    const label = date.toLocaleDateString("en-US", { year: "numeric", month: "long" });

    try {
      const url = `${JW_PUB_MEDIA_API}?output=json&pub=mwb&fileformat=JWPUB&alllangs=0&langwritten=${wtLocale}&issue=${issueDate}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "hubport.cloud/1.0 (meeting-planner)",
          Accept: "application/json",
        },
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json() as Record<string, unknown>;
        // JW API returns files object when publication exists
        const hasFiles = data.files && Object.keys(data.files as object).length > 0;
        results.push({
          yearMonth,
          label,
          available: !!hasFiles,
          publicationCode: "mwb",
          url: hasFiles ? `https://www.jw.org/finder?wtlocale=${wtLocale}&pub=mwb&issue=${issueDate}` : null,
        });
      } else {
        results.push({
          yearMonth,
          label,
          available: false,
          publicationCode: "mwb",
          url: null,
        });
      }
    } catch {
      results.push({
        yearMonth,
        label,
        available: false,
        publicationCode: "mwb",
        url: null,
      });
    }
  }

  return results;
}

/**
 * Check availability of Watchtower Study editions.
 */
export async function checkStudyAvailability(
  language: string,
  rangeMonths = 6,
): Promise<EditionAvailability[]> {
  const wtLocale = getWtLocale(language);
  const now = new Date();
  const results: EditionAvailability[] = [];

  for (let offset = -2; offset <= rangeMonths; offset++) {
    const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const yearMonth = `${year}-${String(month).padStart(2, "0")}`;
    const issueDate = `${year}${String(month).padStart(2, "0")}`;

    const label = date.toLocaleDateString("en-US", { year: "numeric", month: "long" });

    try {
      const url = `${JW_PUB_MEDIA_API}?output=json&pub=w&fileformat=JWPUB&alllangs=0&langwritten=${wtLocale}&issue=${issueDate}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "hubport.cloud/1.0 (meeting-planner)",
          Accept: "application/json",
        },
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json() as Record<string, unknown>;
        const hasFiles = data.files && Object.keys(data.files as object).length > 0;
        results.push({
          yearMonth,
          label,
          available: !!hasFiles,
          publicationCode: "w",
          url: hasFiles ? `https://www.jw.org/finder?wtlocale=${wtLocale}&pub=w&issue=${issueDate}` : null,
        });
      } else {
        results.push({ yearMonth, label, available: false, publicationCode: "w", url: null });
      }
    } catch {
      results.push({ yearMonth, label, available: false, publicationCode: "w", url: null });
    }
  }

  return results;
}
