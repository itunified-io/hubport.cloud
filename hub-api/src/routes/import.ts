/**
 * Import routes — KML and CSV import for territories and addresses.
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { parseKmlPolygons, type ParsedPolygon } from "../lib/kml-parser.js";
import { runAutoFixPipeline } from "../lib/postgis-helpers.js";

// ─── Schemas ────────────────────────────────────────────────────

const CsvPreviewBody = Type.Object({
  csv: Type.String({ minLength: 1 }),
  delimiter: Type.Optional(Type.String({ maxLength: 1 })),
});
type CsvPreviewBodyType = Static<typeof CsvPreviewBody>;

const CsvConfirmBody = Type.Object({
  csv: Type.String({ minLength: 1 }),
  columns: Type.Record(Type.String(), Type.String()),
  delimiter: Type.Optional(Type.String({ maxLength: 1 })),
});
type CsvConfirmBodyType = Static<typeof CsvConfirmBody>;

const KmlBody = Type.Object({
  kml: Type.String({ minLength: 1 }),
  name: Type.Optional(Type.String()),
});
type KmlBodyType = Static<typeof KmlBody>;

// ─── CSV Parser ─────────────────────────────────────────────────

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

  // Handle quoted fields properly (Boundary column contains commas)
  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  };

  const headers = parseRow(lines[0]!);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]!);
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
    // Territory fields
    territory_number: ["number", "nr", "territorynumber", "territory_number", "gebietnr", "gebiet_nr"],
    territory_name: ["area", "name", "territory_name", "territoryname", "gebietname", "gebiet"],
    boundary: ["boundary", "boundaries", "polygon", "wkt", "geom", "geometry"],
    // Address fields
    lat: ["lat", "latitude", "breitengrad", "y"],
    lng: ["lng", "lon", "longitude", "laengengrad", "x"],
    street: ["street", "strasse", "str", "road", "streetaddress"],
    houseNumber: ["housenumber", "house_number", "hausnummer", "hnr"],
    city: ["city", "stadt", "ort", "town", "village"],
    postcode: ["postcode", "zip", "plz", "postal", "zipcode"],
    buildingType: ["buildingtype", "building_type"],
    notes: ["notes", "notizen", "comment", "kommentar", "bemerkung", "customnotes1"],
    type: ["type", "typ", "category"],
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

/**
 * Parse branch-tool boundary format: "[lng,lat],[lng,lat],..."
 * Returns GeoJSON-compatible coordinate ring [[lng,lat], ...]
 */
function parseBranchBoundary(boundary: string): number[][] | null {
  if (!boundary || boundary.trim().length === 0) return null;

  // Remove surrounding quotes if present
  const clean = boundary.replace(/^["']|["']$/g, "").trim();

  // Match all [lng,lat] pairs
  const pairRegex = /\[([^[\]]+)\]/g;
  let match: RegExpExecArray | null;
  const points: number[][] = [];

  while ((match = pairRegex.exec(clean)) !== null) {
    const parts = match[1]!.split(",").map((s) => parseFloat(s.trim()));
    if (parts.length >= 2 && !parts.some(isNaN)) {
      points.push([parts[0]!, parts[1]!]);
    }
  }

  if (points.length < 3) return null;

  // Auto-close ring if needed
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) {
    points.push([...first]);
  }

  return points;
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

      let created = 0;
      let skipped = 0;
      const skippedDetails: { name: string; reason: string }[] = [];
      const warnings: { placemark: string; reason: string }[] = [];

      // Get max existing number for auto-numbering
      const maxNumber = await prisma.territory.aggregate({ _max: { number: true } });
      let nextNum = maxNumber._max.number ? parseInt(maxNumber._max.number, 10) + 1 : 1;

      for (const poly of polygons) {
        const name = poly.name ?? request.body.name ?? `Imported ${nextNum}`;

        if (existingNames.has(name.toLowerCase())) {
          skippedDetails.push({ name, reason: "duplicate_name" });
          skipped++;
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

        await prisma.territory.create({
          data: {
            number: String(nextNum).padStart(3, "0"),
            name,
            type: "congregation_boundary",
            boundaries,
          },
        });

        created++;
        nextNum++;
      }

      return reply.code(201).send({
        created,
        skipped,
        skippedDetails,
        warnings,
        errors: [],
      });
    },
  );

  // ─── Branch KML import ──────────────────────────────────────────
  app.post<{ Body: KmlBodyType }>(
    "/territories/import/kml/branch",
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

      let updated = 0;
      let created = 0;
      let skipped = 0;
      const warnings: string[] = [];

      // Extract territory number from Placemark name
      const numberRegex = /^T?-?(\d+)/i;

      for (const poly of polygons) {
        if (poly.coordinates.length === 0) {
          skipped++;
          warnings.push(`Skipped placemark "${poly.name ?? "(unnamed)"}": no polygon geometry`);
          continue;
        }

        // Extract territory number
        const nameStr = poly.name ?? "";
        const numMatch = nameStr.match(numberRegex);
        if (!numMatch) {
          skipped++;
          warnings.push(`Skipped placemark "${nameStr}": no territory number found`);
          continue;
        }
        const territoryNumber = numMatch[1]!;

        // Convert to GeoJSON
        const geojsonCoords = poly.coordinates.map((ring) =>
          ring.map((pt) => [pt[0]!, pt[1]!]),
        );
        const boundaries =
          poly.coordinates.length === 1
            ? { type: "Polygon" as const, coordinates: geojsonCoords }
            : { type: "MultiPolygon" as const, coordinates: geojsonCoords.map((ring) => [ring]) };

        // Find existing territory by number
        const existing = await prisma.territory.findFirst({
          where: { number: territoryNumber },
        });

        if (existing) {
          // Update existing territory boundary
          try {
            // Save previous boundary in version history
            if (existing.boundaries) {
              const lastVersion = await prisma.territoryBoundaryVersion.findFirst({
                where: { territoryId: existing.id },
                orderBy: { version: "desc" },
                select: { version: true },
              });
              const nextVersion = (lastVersion?.version ?? 0) + 1;
              await prisma.territoryBoundaryVersion.create({
                data: {
                  territoryId: existing.id,
                  version: nextVersion,
                  boundaries: existing.boundaries as any,
                  changeType: "branch_import",
                  changeSummary: `Previous boundary before branch KML import`,
                },
              });
            }

            // Run auto-fix pipeline on new boundary
            let finalBoundaries: object = boundaries;
            try {
              const autoFix = await runAutoFixPipeline(prisma, boundaries, existing.id);
              finalBoundaries = autoFix.clipped;
            } catch {
              // PostGIS not available, use as-is
            }

            await prisma.territory.update({
              where: { id: existing.id },
              data: { boundaries: finalBoundaries } as any,
            });
            updated++;
          } catch (err) {
            warnings.push(`Failed to update territory #${territoryNumber}: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else {
          // Create new territory
          try {
            await prisma.territory.create({
              data: {
                number: territoryNumber,
                name: nameStr.replace(numberRegex, "").trim() || `Territory ${territoryNumber}`,
                type: "territory",
                boundaries,
              },
            });
            created++;
          } catch (err) {
            warnings.push(`Failed to create territory #${territoryNumber}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      return reply.code(200).send({ updated, created, skipped, warnings });
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
      const rows = parseCsvRows(request.body.csv, delimiter);

      if (rows.length === 0) {
        return {
          columns: {},
          preview: [],
          duplicateCount: 0,
          totalRows: 0,
        };
      }

      const headers = Object.keys(rows[0] ?? {});
      const mapping = detectColumnMapping(headers);

      // Build column mapping: CSV header → detected field
      const columns: Record<string, string> = {};
      for (const header of headers) {
        // Find if this header was mapped to a field
        const mappedField = Object.entries(mapping).find(([, csvCol]) => csvCol === header);
        columns[header] = mappedField ? mappedField[0] : "";
      }

      // Duplicate detection for territory mode
      let duplicateCount = 0;
      if (mapping["boundary"]) {
        const existingTerritories = await prisma.territory.findMany({
          select: { number: true },
        });
        const existingNumbers = new Set(existingTerritories.map((t) => t.number));
        const numberCol = mapping["territory_number"];

        if (numberCol) {
          for (const row of rows) {
            const num = (row[numberCol] ?? "").padStart(3, "0");
            if (num && existingNumbers.has(num)) {
              duplicateCount++;
            }
          }
        }
      }

      // Preview: first 10 rows, truncate long values
      const preview = rows.slice(0, 10).map((row) => {
        const previewRow: Record<string, string> = {};
        for (const header of headers) {
          const val = row[header] ?? "";
          previewRow[header] = val.length > 100 ? val.substring(0, 100) + "…" : val;
        }
        return previewRow;
      });

      return {
        columns,
        preview,
        duplicateCount,
        totalRows: rows.length,
      };
    },
  );

  // ─── CSV confirm (create territories or addresses) ──────────────
  app.post<{ Body: CsvConfirmBodyType }>(
    "/territories/import/csv/confirm",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_IMPORT),
      schema: { body: CsvConfirmBody },
    },
    async (request, reply) => {
      const delimiter = request.body.delimiter ?? detectDelimiter(request.body.csv);
      const rows = parseCsvRows(request.body.csv, delimiter);
      const columns = request.body.columns;

      if (rows.length === 0) {
        return reply.code(400).send({ error: "No data rows found" });
      }

      if (rows.length > 5000) {
        return reply.code(400).send({ error: "Maximum 5000 rows per import" });
      }

      // Invert column mapping: field → CSV header
      const fieldToHeader: Record<string, string> = {};
      for (const [csvHeader, field] of Object.entries(columns)) {
        if (field) {
          fieldToHeader[field] = csvHeader;
        }
      }

      // Detect mode
      if (fieldToHeader["boundary"]) {
        return await importTerritoriesFromCsv(rows, fieldToHeader, reply);
      } else if (fieldToHeader["lat"] && fieldToHeader["lng"]) {
        return await importAddressesFromCsv(rows, fieldToHeader, reply);
      } else {
        return reply.code(400).send({
          error: "Cannot determine import mode. Map either 'boundary' (territory) or 'lat'+'lng' (address) columns.",
        });
      }
    },
  );
}

// ─── Territory CSV import ────────────────────────────────────────

async function importTerritoriesFromCsv(
  rows: Record<string, string>[],
  fieldToHeader: Record<string, string>,
  reply: import("fastify").FastifyReply,
) {
  const boundaryCol = fieldToHeader["boundary"]!;
  const numberCol = fieldToHeader["territory_number"];
  const nameCol = fieldToHeader["territory_name"];

  // Duplicate detection
  const existingTerritories = await prisma.territory.findMany({
    select: { number: true },
  });
  const existingNumbers = new Set(existingTerritories.map((t) => t.number));

  // Get max number for auto-numbering when no number column
  const maxNumber = await prisma.territory.aggregate({ _max: { number: true } });
  let nextNum = maxNumber._max.number ? parseInt(maxNumber._max.number, 10) + 1 : 1;

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const boundaryStr = row[boundaryCol] ?? "";

    // Parse boundary coordinates
    const ring = parseBranchBoundary(boundaryStr);
    if (!ring) {
      errors.push(`Row ${i + 1}: invalid boundary data`);
      continue;
    }

    // Territory number
    const rawNumber = numberCol ? (row[numberCol] ?? "") : "";
    const number = rawNumber ? rawNumber.padStart(3, "0") : String(nextNum).padStart(3, "0");

    // Skip duplicates
    if (existingNumbers.has(number)) {
      skipped++;
      continue;
    }

    // Territory name
    const name = (nameCol ? (row[nameCol] ?? "") : "") || `Territory ${number}`;

    const boundaries = { type: "Polygon" as const, coordinates: [ring] };

    await prisma.territory.create({
      data: {
        number,
        name,
        boundaries,
      },
    });

    created++;
    existingNumbers.add(number);
    if (!rawNumber) nextNum++;
  }

  return reply.code(201).send({ created, skipped, errors });
}

// ─── Address CSV import ──────────────────────────────────────────

async function importAddressesFromCsv(
  rows: Record<string, string>[],
  fieldToHeader: Record<string, string>,
  reply: import("fastify").FastifyReply,
) {
  const latCol = fieldToHeader["lat"]!;
  const lngCol = fieldToHeader["lng"]!;
  const streetCol = fieldToHeader["street"];
  const houseNumberCol = fieldToHeader["houseNumber"];
  const cityCol = fieldToHeader["city"];
  const postcodeCol = fieldToHeader["postcode"];
  const notesCol = fieldToHeader["notes"];

  // Address import requires a territory — pick the first one or fail
  const firstTerritory = await prisma.territory.findFirst({ select: { id: true } });
  if (!firstTerritory) {
    return reply.code(400).send({ error: "No territories exist. Import territories first." });
  }

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const lat = parseFloat(row[latCol] ?? "");
    const lng = parseFloat(row[lngCol] ?? "");

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      errors.push(`Row ${i + 1}: invalid lat/lng`);
      skipped++;
      continue;
    }

    await prisma.address.create({
      data: {
        territoryId: firstTerritory.id,
        lat,
        lng,
        street: streetCol ? (row[streetCol] ?? null) : null,
        houseNumber: houseNumberCol ? (row[houseNumberCol] ?? null) : null,
        city: cityCol ? (row[cityCol] ?? null) : null,
        postcode: postcodeCol ? (row[postcodeCol] ?? null) : null,
        notes: notesCol ? (row[notesCol] ?? null) : null,
        source: "csv_import",
      },
    });

    created++;
  }

  return reply.code(201).send({ created, skipped, errors });
}
