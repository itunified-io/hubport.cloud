/**
 * Import routes — KML and CSV import for territories and addresses.
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";

// ─── Schemas ────────────────────────────────────────────────────────

const CsvPreviewBody = Type.Object({
  csv: Type.String({ minLength: 1 }),
  delimiter: Type.Optional(Type.String({ maxLength: 1 })),
});
type CsvPreviewBodyType = Static<typeof CsvPreviewBody>;

const CsvConfirmBody = Type.Object({
  territoryId: Type.String({ format: "uuid" }),
  rows: Type.Array(
    Type.Object({
      lat: Type.Number({ minimum: -90, maximum: 90 }),
      lng: Type.Number({ minimum: -180, maximum: 180 }),
      street: Type.Optional(Type.String()),
      houseNumber: Type.Optional(Type.String()),
      city: Type.Optional(Type.String()),
      postcode: Type.Optional(Type.String()),
      buildingType: Type.Optional(Type.String()),
      notes: Type.Optional(Type.String()),
    }),
    { maxItems: 5000 },
  ),
});
type CsvConfirmBodyType = Static<typeof CsvConfirmBody>;

const KmlBody = Type.Object({
  kml: Type.String({ minLength: 1 }),
  name: Type.Optional(Type.String()),
});
type KmlBodyType = Static<typeof KmlBody>;

// ─── KML Parser ─────────────────────────────────────────────────────

interface ParsedPolygon {
  name: string | null;
  coordinates: number[][][]; // [ring[point[lng, lat, alt?]]]
}

/**
 * Minimal KML XML parser — extracts Placemark polygons.
 * Does not require a full XML parser dependency.
 */
function parseKmlPolygons(kml: string): ParsedPolygon[] {
  const results: ParsedPolygon[] = [];

  // Extract all Placemarks
  const placemarkRegex = /<Placemark[^>]*>([\s\S]*?)<\/Placemark>/gi;
  let placemarkMatch: RegExpExecArray | null;

  while ((placemarkMatch = placemarkRegex.exec(kml)) !== null) {
    const content = placemarkMatch[1]!;

    // Extract name
    const nameMatch = content.match(/<name>([^<]*)<\/name>/i);
    const name = nameMatch ? nameMatch[1]!.trim() : null;

    // Extract coordinates from Polygon elements
    const coordsRegex = /<coordinates>\s*([\s\S]*?)\s*<\/coordinates>/gi;
    let coordsMatch: RegExpExecArray | null;
    const rings: number[][][] = [];

    while ((coordsMatch = coordsRegex.exec(content)) !== null) {
      const coordStr = coordsMatch[1]!.trim();
      const points = coordStr
        .split(/\s+/)
        .filter((s) => s.length > 0)
        .map((s) => {
          const parts = s.split(",").map(Number);
          return parts.length >= 2 ? parts : null;
        })
        .filter((p): p is number[] => p !== null && !p.some(isNaN));

      if (points.length >= 3) {
        // Auto-close ring if needed
        const first = points[0]!;
        const last = points[points.length - 1]!;
        if (first[0] !== last[0] || first[1] !== last[1]) {
          points.push([...first]);
        }
        rings.push(points);
      }
    }

    if (rings.length > 0) {
      results.push({ name, coordinates: rings });
    }
  }

  return results;
}

// ─── CSV Parser ─────────────────────────────────────────────────────

function detectDelimiter(csv: string): string {
  const firstLine = csv.split("\n")[0] ?? "";
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    const count = (firstLine.match(new RegExp(`\\${d}`, "g")) ?? []).length;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

function parseCsvRows(csv: string, delimiter: string): Record<string, string>[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0]!.split(delimiter).map((h) => h.trim().replace(/^"(.*)"$/, "$1"));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i]!.split(delimiter).map((v) => v.trim().replace(/^"(.*)"$/, "$1"));
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = values[j] ?? "";
    }
    rows.push(row);
  }

  return rows;
}

/** Auto-detect column mappings from CSV headers. */
function detectColumnMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const patterns: Record<string, string[]> = {
    lat: ["lat", "latitude", "breitengrad", "y"],
    lng: ["lng", "lon", "longitude", "laengengrad", "x"],
    street: ["street", "strasse", "str", "road"],
    houseNumber: ["housenumber", "house_number", "hausnummer", "nr", "number", "hnr"],
    city: ["city", "stadt", "ort", "town", "village"],
    postcode: ["postcode", "zip", "plz", "postal", "zipcode"],
    buildingType: ["buildingtype", "building_type", "type"],
    notes: ["notes", "notizen", "comment", "kommentar", "bemerkung"],
  };

  for (const header of headers) {
    const lower = header.toLowerCase().trim();
    for (const [field, aliases] of Object.entries(patterns)) {
      if (aliases.includes(lower) && !mapping[field]) {
        mapping[field] = header;
        break;
      }
    }
  }

  return mapping;
}

export async function importRoutes(app: FastifyInstance): Promise<void> {
  // ─── KML import ──────────────────────────────────────────────────
  app.post<{ Body: KmlBodyType }>(
    "/territories/import/kml",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_IMPORT),
      schema: { body: KmlBody },
    },
    async (request, reply) => {
      const polygons = parseKmlPolygons(request.body.kml);

      if (polygons.length === 0) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "No valid polygons found in KML",
        });
      }

      // Duplicate detection — check by name
      const existingTerritories = await prisma.territory.findMany({
        select: { number: true, name: true },
      });
      const existingNames = new Set(existingTerritories.map((t) => t.name.toLowerCase()));

      const imported: { name: string; status: string; territoryId?: string }[] = [];

      for (let i = 0; i < polygons.length; i++) {
        const poly = polygons[i]!;
        const name = poly.name ?? request.body.name ?? `Imported ${i + 1}`;

        if (existingNames.has(name.toLowerCase())) {
          imported.push({ name, status: "skipped_duplicate" });
          continue;
        }

        // Convert coordinates to GeoJSON (KML uses lng,lat,alt)
        const geojsonCoords = poly.coordinates.map((ring) =>
          ring.map((pt) => [pt[0]!, pt[1]!]),
        );

        const boundaries =
          poly.coordinates.length === 1
            ? { type: "Polygon" as const, coordinates: geojsonCoords }
            : { type: "MultiPolygon" as const, coordinates: geojsonCoords.map((ring) => [ring]) };

        // Generate unique number
        const maxNumber = await prisma.territory.aggregate({
          _max: { number: true },
        });

        const nextNum = maxNumber._max.number
          ? String(parseInt(maxNumber._max.number, 10) + 1 + i).padStart(3, "0")
          : String(1 + i).padStart(3, "0");

        const territory = await prisma.territory.create({
          data: {
            number: nextNum,
            name,
            boundaries,
          },
        });

        imported.push({ name, status: "created", territoryId: territory.id });
      }

      return reply.code(201).send({
        totalPolygons: polygons.length,
        results: imported,
      });
    },
  );

  // ─── CSV preview ─────────────────────────────────────────────────
  app.post<{ Body: CsvPreviewBodyType }>(
    "/territories/import/csv/preview",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_IMPORT),
      schema: { body: CsvPreviewBody },
    },
    async (request) => {
      const delimiter = request.body.delimiter ?? detectDelimiter(request.body.csv);
      const lines = request.body.csv.split(/\r?\n/).filter((l) => l.trim().length > 0);

      if (lines.length < 2) {
        return {
          error: "CSV must have at least a header row and one data row",
          headers: [],
          mapping: {},
          previewRows: [],
          totalRows: 0,
        };
      }

      const headers = lines[0]!
        .split(delimiter)
        .map((h) => h.trim().replace(/^"(.*)"$/, "$1"));

      const mapping = detectColumnMapping(headers);
      const rows = parseCsvRows(request.body.csv, delimiter);

      return {
        headers,
        detectedDelimiter: delimiter,
        mapping,
        previewRows: rows.slice(0, 10),
        totalRows: rows.length,
      };
    },
  );

  // ─── CSV confirm (bulk create) ───────────────────────────────────
  app.post<{ Body: CsvConfirmBodyType }>(
    "/territories/import/csv/confirm",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_IMPORT),
      schema: { body: CsvConfirmBody },
    },
    async (request, reply) => {
      if (request.body.rows.length > 5000) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "Maximum 5000 rows per import",
        });
      }

      const territory = await prisma.territory.findUnique({
        where: { id: request.body.territoryId },
      });
      if (!territory) {
        return reply.code(404).send({ error: "Territory not found" });
      }

      const result = await prisma.address.createMany({
        data: request.body.rows.map((row) => ({
          territoryId: request.body.territoryId,
          lat: row.lat,
          lng: row.lng,
          street: row.street,
          houseNumber: row.houseNumber,
          city: row.city,
          postcode: row.postcode,
          buildingType: row.buildingType,
          notes: row.notes,
          source: "csv_import" as const,
        })),
      });

      return reply.code(201).send({
        created: result.count,
        territoryId: request.body.territoryId,
      });
    },
  );
}
