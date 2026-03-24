/**
 * Seed the public talk catalog from bundled JSON data.
 * Source: sws2apps/organized-app i18n translation files (MIT licensed).
 * Upserted on demand via POST /public-talks/seed — NOT on startup.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import prisma from "./prisma.js";

interface CatalogEntry {
  talkNumber: number;
  title_de: string;
  title_en: string;
}

function loadCatalog(): CatalogEntry[] {
  // Use createRequire to resolve JSON relative to compiled output.
  // Falls back to readFileSync with multiple search paths for Docker compat.
  try {
    const require = createRequire(import.meta.url);
    return require("../data/public-talks-catalog.json");
  } catch {
    // Fallback: search common locations (Docker cwd = /app/hub-api)
    const paths = [
      `${process.cwd()}/src/data/public-talks-catalog.json`,
      `${process.cwd()}/data/public-talks-catalog.json`,
      `${process.cwd()}/dist/data/public-talks-catalog.json`,
    ];
    for (const p of paths) {
      try {
        return JSON.parse(readFileSync(p, "utf-8"));
      } catch { /* try next */ }
    }
    throw new Error("public-talks-catalog.json not found in any search path");
  }
}

export async function seedPublicTalks(
  language: string = "de",
): Promise<{ created: number; updated: number; discontinued: number }> {
  const catalog = loadCatalog();
  const titleKey = `title_${language}` as keyof CatalogEntry;

  let created = 0;
  let updated = 0;

  for (const entry of catalog) {
    const title = (entry[titleKey] as string) || entry.title_de;
    const existing = await prisma.publicTalk.findUnique({
      where: { talkNumber: entry.talkNumber },
    });

    if (existing) {
      if (existing.title !== title || existing.discontinued) {
        await prisma.publicTalk.update({
          where: { talkNumber: entry.talkNumber },
          data: { title, discontinued: false },
        });
        updated++;
      }
    } else {
      await prisma.publicTalk.create({
        data: {
          talkNumber: entry.talkNumber,
          title,
          discontinued: false,
        },
      });
      created++;
    }
  }

  // Mark talks NOT in catalog as discontinued
  const catalogNumbers = catalog.map((e) => e.talkNumber);
  const { count: discontinued } = await prisma.publicTalk.updateMany({
    where: {
      talkNumber: { notIn: catalogNumbers },
      discontinued: false,
    },
    data: { discontinued: true },
  });

  console.log(
    `[seed-public-talks] created=${created} updated=${updated} discontinued=${discontinued} total=${catalog.length}`,
  );

  return { created, updated, discontinued };
}
