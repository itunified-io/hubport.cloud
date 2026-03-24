/**
 * Seed the public talk catalog from bundled JSON data.
 * Source: sws2apps/organized-app i18n translation files (MIT licensed).
 * Upserted on startup — safe to call multiple times.
 */

import catalog from "../data/public-talks-catalog.json" with { type: "json" };
import prisma from "./prisma.js";

interface CatalogEntry {
  talkNumber: number;
  title_de: string;
  title_en: string;
}

const typedCatalog = catalog as CatalogEntry[];

export async function seedPublicTalks(
  language: string = "de",
): Promise<{ created: number; updated: number; discontinued: number }> {
  const titleKey = `title_${language}` as keyof CatalogEntry;

  let created = 0;
  let updated = 0;

  for (const entry of typedCatalog) {
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
  const catalogNumbers = typedCatalog.map((e) => e.talkNumber);
  const { count: discontinued } = await prisma.publicTalk.updateMany({
    where: {
      talkNumber: { notIn: catalogNumbers },
      discontinued: false,
    },
    data: { discontinued: true },
  });

  console.log(
    `[seed-public-talks] created=${created} updated=${updated} discontinued=${discontinued} total=${typedCatalog.length}`,
  );

  return { created, updated, discontinued };
}
