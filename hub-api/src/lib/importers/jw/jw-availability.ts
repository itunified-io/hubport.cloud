/**
 * Check which workbook editions are available on JW.org.
 *
 * Workbooks are BIMONTHLY: Jan/Feb, Mar/Apr, May/Jun, Jul/Aug, Sep/Oct, Nov/Dec.
 * Issue codes use the first month: mwb26.01 = Jan–Feb 2026.
 *
 * Uses the JW.org publication media API (b.jw-cdn.org) to check availability
 * and retrieve thumbnail images.
 */

import { getWtLocale } from "./jw-client.js";

const JW_PUB_MEDIA_API = "https://b.jw-cdn.org/apis/pub-media/GETPUBMEDIALINKS";

export interface EditionAvailability {
  yearMonth: string;
  label: string;
  available: boolean;
  publicationCode: string;
  url: string | null;
  thumbnailUrl: string | null;
  issueCode: string;
}

/** Bimonthly start months for workbooks */
const BIMONTHLY_STARTS = [1, 3, 5, 7, 9, 11];

/**
 * Check availability of workbook editions for a language.
 * Scans bimonthly editions from ~6 months ago to ~8 months ahead.
 */
export async function checkWorkbookAvailability(
  language: string,
): Promise<EditionAvailability[]> {
  const wtLocale = getWtLocale(language);
  const now = new Date();
  const results: EditionAvailability[] = [];

  // Determine range: current + future only
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Find current bimonthly period
  const currentBiStart = BIMONTHLY_STARTS.filter((m) => m <= currentMonth).pop() ?? 1;
  const currentBiIdx = BIMONTHLY_STARTS.indexOf(currentBiStart);

  // Generate list: current + 4 forward = 5 editions
  for (let offset = 0; offset <= 4; offset++) {
    let biIdx = currentBiIdx + offset;
    let year = currentYear;

    while (biIdx < 0) { biIdx += 6; year--; }
    while (biIdx >= 6) { biIdx -= 6; year++; }

    const month = BIMONTHLY_STARTS[biIdx];
    const endMonth = month + 1;
    const issueCode = `${year}${String(month).padStart(2, "0")}`;
    const yearMonth = `${year}-${String(month).padStart(2, "0")}`;

    // Month names for label
    const startLabel = new Date(year, month - 1, 1).toLocaleDateString(language === "de" ? "de-DE" : "en-US", { month: "long" });
    const endLabel = new Date(year, endMonth - 1, 1).toLocaleDateString(language === "de" ? "de-DE" : "en-US", { month: "long" });
    const label = `${startLabel}/${endLabel} ${year}`;

    try {
      const apiUrl = `${JW_PUB_MEDIA_API}?output=json&pub=mwb&fileformat=JWPUB&alllangs=0&langwritten=${wtLocale}&issue=${issueCode}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(apiUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "hubport.cloud/1.0 (meeting-planner)",
          Accept: "application/json",
        },
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json() as Record<string, unknown>;
        const files = data.files as Record<string, unknown[]> | undefined;
        const hasFiles = files && Object.keys(files).length > 0;

        // Extract thumbnail from the first available format
        let thumbnailUrl: string | null = null;
        if (hasFiles) {
          for (const lang of Object.values(files)) {
            if (Array.isArray(lang)) {
              for (const item of lang) {
                const file = item as Record<string, unknown>;
                if (file.label === "JWPUB" || file.mimetype === "application/x-jwpub") {
                  // Check for sqr thumbnail
                  const markers = file.markers as Record<string, unknown> | undefined;
                  if (markers?.markers) {
                    // markers format varies
                  }
                }
              }
            }
          }
        }

        // Cover thumbnail from JW CDN — pattern: /img/p/mwb/{YYYYMM}/{LOCALE}/pt/mwb_{LOCALE}_{YYYYMM}_lg.jpg
        if (hasFiles && !thumbnailUrl) {
          thumbnailUrl = `https://cms-imgp.jw-cdn.org/img/p/mwb/${issueCode}/${wtLocale}/pt/mwb_${wtLocale}_${issueCode}_lg.jpg`;
        }

        results.push({
          yearMonth,
          label,
          available: !!hasFiles,
          publicationCode: "mwb",
          issueCode,
          url: hasFiles
            ? `https://www.jw.org/finder?wtlocale=${wtLocale}&pub=mwb&issue=${issueCode}`
            : null,
          thumbnailUrl: hasFiles ? thumbnailUrl : null,
        });
      } else {
        results.push({
          yearMonth, label, available: false, publicationCode: "mwb",
          issueCode, url: null, thumbnailUrl: null,
        });
      }
    } catch {
      results.push({
        yearMonth, label, available: false, publicationCode: "mwb",
        issueCode, url: null, thumbnailUrl: null,
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
): Promise<EditionAvailability[]> {
  const wtLocale = getWtLocale(language);
  const now = new Date();
  const results: EditionAvailability[] = [];

  for (let offset = -2; offset <= 4; offset++) {
    let biIdx = BIMONTHLY_STARTS.indexOf(
      BIMONTHLY_STARTS.filter((m) => m <= now.getMonth() + 1).pop() ?? 1,
    ) + offset;
    let year = now.getFullYear();
    while (biIdx < 0) { biIdx += 6; year--; }
    while (biIdx >= 6) { biIdx -= 6; year++; }

    const month = BIMONTHLY_STARTS[biIdx];
    const endMonth = month + 1;
    const issueCode = `${year}${String(month).padStart(2, "0")}`;
    const yearMonth = `${year}-${String(month).padStart(2, "0")}`;
    const startLabel = new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long" });
    const endLabel = new Date(year, endMonth - 1, 1).toLocaleDateString("en-US", { month: "long" });
    const label = `${startLabel}/${endLabel} ${year}`;

    try {
      const url = `${JW_PUB_MEDIA_API}?output=json&pub=w&fileformat=JWPUB&alllangs=0&langwritten=${wtLocale}&issue=${issueCode}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json() as Record<string, unknown>;
        const hasFiles = data.files && Object.keys(data.files as object).length > 0;
        results.push({
          yearMonth, label, available: !!hasFiles, publicationCode: "w",
          issueCode,
          url: hasFiles ? `https://www.jw.org/finder?wtlocale=${wtLocale}&pub=w&issue=${issueCode}` : null,
          thumbnailUrl: hasFiles ? `https://cms-imgp.jw-cdn.org/img/p/w/${issueCode}/${wtLocale}/pt/w_${wtLocale}_${issueCode}_lg.jpg` : null,
        });
      } else {
        results.push({ yearMonth, label, available: false, publicationCode: "w", issueCode, url: null, thumbnailUrl: null });
      }
    } catch {
      results.push({ yearMonth, label, available: false, publicationCode: "w", issueCode, url: null, thumbnailUrl: null });
    }
  }

  return results;
}
