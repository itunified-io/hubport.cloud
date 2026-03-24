/**
 * Seed public talk catalog from JSON.
 * Upserts all talks by talkNumber — safe to call multiple times.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import prisma from "./prisma.js";

interface CatalogEntry {
  talkNumber: number;
  title_de: string;
  title_en: string;
}

/**
 * Load the catalog JSON and upsert every talk into the PublicTalk table.
 * German (`title_de`) is used as the primary `title` field.
 */
export async function seedPublicTalks(): Promise<{
  created: number;
  updated: number;
  total: number;
}> {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const catalogPath = join(currentDir, "..", "data", "public-talks-catalog.json");
  const raw = readFileSync(catalogPath, "utf-8");
  const catalog: CatalogEntry[] = JSON.parse(raw);

  let created = 0;
  let updated = 0;

  for (const entry of catalog) {
    const existing = await prisma.publicTalk.findUnique({
      where: { talkNumber: entry.talkNumber },
    });

    await prisma.publicTalk.upsert({
      where: { talkNumber: entry.talkNumber },
      update: {
        title: entry.title_de,
      },
      create: {
        talkNumber: entry.talkNumber,
        title: entry.title_de,
      },
    });

    if (existing) {
      updated++;
    } else {
      created++;
    }
  }

  return { created, updated, total: catalog.length };
}
