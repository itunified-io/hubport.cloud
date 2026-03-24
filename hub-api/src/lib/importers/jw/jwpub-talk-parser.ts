/**
 * JWPUB-based public talk catalog parser.
 *
 * A JWPUB file is a ZIP archive containing:
 * 1. `manifest.json` — publication metadata (symbol, language, timestamp)
 * 2. `contents` — an inner ZIP containing:
 *    - An SQLite database (e.g. `S-34mp_X.db`)
 *    - Image files (JPGs)
 *
 * The SQLite DB has a `Document` table with columns:
 * - DocumentId INTEGER
 * - Title TEXT — format "Nr. 19 Wie kann man erfahren, was in Zukunft geschieht?"
 * - MepsDocumentId INTEGER
 * - Content BLOB (HTML content of the talk outline)
 *
 * Talk numbers are extracted from Title via regex: Nr.\s*(\d+)\s+(.*)
 *
 * Uses sql.js (WASM-based SQLite) — no native compilation needed for Docker.
 */

import JSZip from "jszip";
import initSqlJs from "sql.js";

// ─── Public types ────────────────────────────────────────────────────

export interface ParsedTalk {
  talkNumber: number;
  title: string;
  hasMediaContent: boolean;
}

export interface JwpubTalkResult {
  publicationSymbol: string;
  language: string;
  timestamp: string;
  talks: ParsedTalk[];
}

// ─── Manifest shape ──────────────────────────────────────────────────

interface JwpubManifest {
  name?: string;
  title?: string;
  language?: string;
  hash?: string;
  timestamp?: string;
  publication?: {
    fileName?: string;
    symbol?: string;
    language?: number;
    year?: number;
  };
}

// ─── Talk number regex ───────────────────────────────────────────────

const TALK_NUMBER_RE = /Nr\.\s*(\d+)\s+(.*)/;

// ─── Main parser ─────────────────────────────────────────────────────

/**
 * Parse a JWPUB file buffer and extract the public talk catalog.
 */
export async function parseJwpubTalks(buffer: Buffer): Promise<JwpubTalkResult> {
  // 1. Open outer ZIP (the .jwpub file)
  const outerZip = await JSZip.loadAsync(buffer);

  // 2. Read manifest.json
  const manifestFile = outerZip.file("manifest.json");
  if (!manifestFile) {
    throw new Error("JWPUB file does not contain manifest.json");
  }
  const manifestRaw = await manifestFile.async("string");
  const manifest: JwpubManifest = JSON.parse(manifestRaw);

  const publicationSymbol = manifest.publication?.symbol ?? manifest.name ?? "unknown";
  const language = manifest.publication?.language?.toString() ?? manifest.language ?? "unknown";
  const timestamp = manifest.timestamp ?? new Date().toISOString();

  // 3. Find and extract the `contents` inner ZIP
  const contentsFile = outerZip.file("contents");
  if (!contentsFile) {
    throw new Error("JWPUB file does not contain 'contents' entry");
  }
  const contentsBuffer = await contentsFile.async("uint8array");
  const innerZip = await JSZip.loadAsync(contentsBuffer);

  // 4. Find the .db file inside the inner ZIP
  const dbFileName = Object.keys(innerZip.files).find((name) => name.endsWith(".db"));
  if (!dbFileName) {
    throw new Error("Inner contents ZIP does not contain a .db file");
  }
  const dbBuffer = await innerZip.file(dbFileName)!.async("uint8array");

  // 5. Open SQLite DB using sql.js (WASM)
  const SQL = await initSqlJs();
  let db: initSqlJs.Database | null = null;

  try {
    db = new SQL.Database(dbBuffer);

    // 6. Discover table structure and find talks
    // First, list all tables to handle different JWPUB layouts
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = tables[0]?.values.map((r) => String(r[0])) ?? [];

    // Try Document table first (standard JWPUB layout)
    const talks: ParsedTalk[] = [];

    if (tableNames.includes("Document")) {
      // Sample titles for debugging
      const sample = db.exec("SELECT Title FROM Document LIMIT 5");
      const sampleTitles = sample[0]?.values.map((r) => String(r[0])) ?? [];

      // Try multiple title patterns
      const patterns: [RegExp, string][] = [
        [/Nr\.\s*(\d+)\s+(.*)/, "Nr."],        // German: "Nr. 19 Wie kann man..."
        [/No\.\s*(\d+)\s+(.*)/, "No."],         // English: "No. 19 How can one..."
        [/Núm\.\s*(\d+)\s+(.*)/, "Núm."],       // Spanish: "Núm. 19 ..."
        [/^(\d+)\.\s+(.+)/, "numeric"],          // Numeric: "19. Title"
        [/(\d+)\s*[-–—]\s*(.+)/, "dash"],        // Dash: "19 – Title"
      ];

      const stmt = db.prepare("SELECT DocumentId, Title, Content FROM Document");

      while (stmt.step()) {
        const row = stmt.getAsObject() as { DocumentId: number; Title: string; Content: unknown };
        for (const [pattern] of patterns) {
          const match = pattern.exec(row.Title);
          if (match) {
            const talkNumber = parseInt(match[1], 10);
            const title = match[2].trim();
            if (talkNumber > 0 && talkNumber < 500 && title.length > 3) {
              talks.push({ talkNumber, title, hasMediaContent: row.Content != null && row.Content !== "" });
            }
            break;
          }
        }
      }
      stmt.free();

      // If no talks found, throw with diagnostic info
      if (talks.length === 0) {
        throw new Error(
          `No talks matched in Document table. Tables: [${tableNames.join(", ")}]. ` +
          `Sample titles: ${JSON.stringify(sampleTitles.slice(0, 5))}`,
        );
      }
    } else {
      throw new Error(
        `No 'Document' table found. Available tables: [${tableNames.join(", ")}]`,
      );
    }

    // Sort by talk number
    talks.sort((a, b) => a.talkNumber - b.talkNumber);

    return {
      publicationSymbol,
      language,
      timestamp,
      talks,
    };
  } finally {
    db?.close();
  }
}
