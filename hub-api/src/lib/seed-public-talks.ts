/**
 * Seed the public talk catalog from bundled JSON data.
 * Source: sws2apps/organized-app i18n translation files (MIT licensed).
 * Upserted on startup — safe to call multiple times.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import prisma from "./prisma.js";

interface CatalogEntry {
  talkNumber: number;
  title_de: string;
  title_en: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadCatalog(): CatalogEntry[] {
  const path = join(__dirname, "..", "data", "public-talks-catalog.json");
  return JSON.parse(readFileSync(path, "utf-8"));
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
