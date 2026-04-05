/**
 * OpenStreetMap Overpass API client.
 * Used for querying buildings, roads, and water bodies within a bounding box
 * for territory snap context.
 */

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const USER_AGENT = "HubportCloud/1.0 (territory-management)";

export interface OverpassBuilding {
  osmId: string;
  osmType: string;
  lat: number;
  lng: number;
  tags: Record<string, string>;
  street?: string;
  houseNumber?: string;
  streetAddress?: string;
  buildingType?: string;
  hasAddress: boolean;
}

export interface OverpassRoad {
  osmId: string;
  highway: string;
  name: string | null;
  geometry: { type: "LineString"; coordinates: [number, number][] };
}

interface WaterPolygon {
  type: "Polygon";
  coordinates: [number, number][][];
}

interface WaterMultiPolygon {
  type: "MultiPolygon";
  coordinates: [number, number][][][];
}

export interface OverpassWaterBody {
  osmId: string;
  waterType: string;
  geometry: WaterPolygon | WaterMultiPolygon;
  name?: string;
}

async function overpassFetch(query: string, timeoutMs = 100_000): Promise<any> {
  let lastError: Error | null = null;

  // Try each endpoint with retries
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 5000));
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (
          response.status === 504 ||
          response.status === 502 ||
          response.status === 429 ||
          response.status === 503
        ) {
          lastError = new Error(
            `Overpass API error (${endpoint}): ${response.status} ${response.statusText}`,
          );
          continue;
        }

        if (!response.ok) {
          throw new Error(
            `Overpass API error (${endpoint}): ${response.status} ${response.statusText}`,
          );
        }

        return await response.json();
      } catch (err: unknown) {
        clearTimeout(timeout);
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  throw lastError || new Error("Overpass API failed after retries on all endpoints");
}

/**
 * Query buildings within a single tile bounding box (internal).
 */
async function queryBuildingsTile(
  south: number,
  west: number,
  north: number,
  east: number,
): Promise<OverpassBuilding[]> {
  const query = `
    [out:json][timeout:90];
    (
      way["building"](${south},${west},${north},${east});
      relation["building"](${south},${west},${north},${east});
    );
    out center tags;
  `;

  const data = await overpassFetch(query, 100_000);

  return (data.elements ?? [])
    .filter((el: any) => el.lat || el.center?.lat)
    .map((el: any) => {
      const tags = el.tags || {};
      const houseNumber = tags["addr:housenumber"] || undefined;
      const street = tags["addr:street"] || undefined;
      const hasAddress = !!(houseNumber && street);
      const streetAddress = hasAddress ? `${street} ${houseNumber}` : undefined;

      return {
        osmId: `${el.type}/${el.id}`,
        osmType: el.type,
        lat: el.lat || el.center?.lat,
        lng: el.lon || el.center?.lon,
        tags,
        street,
        houseNumber,
        streetAddress,
        buildingType: tags.building || undefined,
        hasAddress,
      };
    });
}

/** Max tile size in degrees (~2.5km). Areas larger than this are split into tiles. */
const MAX_TILE_DEG = 0.025;

/**
 * Query buildings within a bounding box.
 * Automatically splits large areas into smaller tiles to avoid Overpass timeouts.
 * Deduplicates buildings that appear in overlapping tile edges.
 */
export async function queryBuildingsInBBox(
  south: number,
  west: number,
  north: number,
  east: number,
): Promise<OverpassBuilding[]> {
  const latSpan = north - south;
  const lngSpan = east - west;

  // Small area — single query
  if (latSpan <= MAX_TILE_DEG && lngSpan <= MAX_TILE_DEG) {
    return queryBuildingsTile(south, west, north, east);
  }

  // Split into tiles
  const latSteps = Math.ceil(latSpan / MAX_TILE_DEG);
  const lngSteps = Math.ceil(lngSpan / MAX_TILE_DEG);
  const latStep = latSpan / latSteps;
  const lngStep = lngSpan / lngSteps;
  const totalTiles = latSteps * lngSteps;

  console.log(`[overpass] Splitting ${latSpan.toFixed(3)}° × ${lngSpan.toFixed(3)}° bbox into ${latSteps}×${lngSteps} = ${totalTiles} tiles`);

  const seen = new Set<string>();
  const results: OverpassBuilding[] = [];

  for (let latIdx = 0; latIdx < latSteps; latIdx++) {
    for (let lngIdx = 0; lngIdx < lngSteps; lngIdx++) {
      const tileNum = latIdx * lngSteps + lngIdx + 1;
      const tileSouth = south + latIdx * latStep;
      const tileWest = west + lngIdx * lngStep;
      const tileNorth = Math.min(south + (latIdx + 1) * latStep, north);
      const tileEast = Math.min(west + (lngIdx + 1) * lngStep, east);

      // Brief delay between tiles to avoid Overpass rate-limiting
      if (tileNum > 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }

      try {
        const tileBuildings = await queryBuildingsTile(tileSouth, tileWest, tileNorth, tileEast);
        for (const b of tileBuildings) {
          if (!seen.has(b.osmId)) {
            seen.add(b.osmId);
            results.push(b);
          }
        }
        console.log(`[overpass] Tile ${tileNum}/${totalTiles}: +${tileBuildings.length} buildings (total: ${results.length})`);
      } catch (err) {
        console.error(`[overpass] Tile ${tileNum}/${totalTiles} failed:`, err instanceof Error ? err.message : err);
        throw err;
      }
    }
  }

  return results;
}

/**
 * Query buildings within a GeoJSON polygon using H3 hex tiling.
 * Computes H3 hex coverage at the given resolution, fetches buildings per hex,
 * and deduplicates by osmId. Preferred over queryBuildingsInBBox for large areas.
 */
export async function queryBuildingsInPolygon(
  geojson: { type: string; coordinates: unknown },
  resolution = 7,
): Promise<OverpassBuilding[]> {
  const { polygonToHexes, hexToBBox } = await import("./hex-grid.js");

  const hexes = polygonToHexes(geojson, resolution);

  if (hexes.length === 0) {
    console.warn("[overpass] polygonToHexes returned 0 hexes — falling back to bbox");
    // Fallback: compute bbox from coordinates
    const coords = (geojson as any).coordinates?.[0] as [number, number][] | undefined;
    if (!coords) return [];
    let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
    for (const [lng, lat] of coords) {
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      if (lng < west) west = lng;
      if (lng > east) east = lng;
    }
    return queryBuildingsInBBox(south, west, north, east);
  }

  console.log(`[overpass] H3 res-${resolution}: ${hexes.length} hexes covering polygon`);

  const seen = new Set<string>();
  const results: OverpassBuilding[] = [];

  // Process hexes in batches of CONCURRENCY with staggered starts
  const CONCURRENCY = 3;

  for (let batchStart = 0; batchStart < hexes.length; batchStart += CONCURRENCY) {
    const batch = hexes.slice(batchStart, batchStart + CONCURRENCY);

    // Brief delay between batches to avoid Overpass rate-limiting
    if (batchStart > 0) {
      await new Promise((r) => setTimeout(r, 1500));
    }

    const batchResults = await Promise.allSettled(
      batch.map(async (hex, idx) => {
        const globalIdx = batchStart + idx;
        const bbox = hexToBBox(hex);
        const tileBuildings = await queryBuildingsTile(bbox.south, bbox.west, bbox.north, bbox.east);
        return { globalIdx, tileBuildings };
      }),
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        const { globalIdx, tileBuildings } = result.value;
        for (const b of tileBuildings) {
          if (!seen.has(b.osmId)) {
            seen.add(b.osmId);
            results.push(b);
          }
        }
        console.log(`[overpass] Hex ${globalIdx + 1}/${hexes.length}: +${tileBuildings.length} buildings (total: ${results.length})`);
      } else {
        const globalIdx = batchStart;
        console.error(`[overpass] Hex ${globalIdx + 1}/${hexes.length} failed:`, result.reason instanceof Error ? result.reason.message : result.reason);
        throw result.reason;
      }
    }
  }

  return results;
}

/**
 * Query roads within a bounding box.
 */
export async function queryRoadsInBBox(
  south: number,
  west: number,
  north: number,
  east: number,
): Promise<OverpassRoad[]> {
  const query = `[out:json][timeout:25];
(
  way["highway"~"^(primary|secondary|tertiary|residential|unclassified|living_street)$"](${south},${west},${north},${east});
);
out geom tags;`;

  const data = await overpassFetch(query);

  return (data.elements ?? [])
    .filter((el: any) => el.type === "way" && el.geometry?.length >= 2)
    .map((el: any) => ({
      osmId: `way/${el.id}`,
      highway: el.tags?.highway ?? "unknown",
      name: el.tags?.name ?? null,
      geometry: {
        type: "LineString" as const,
        coordinates: el.geometry.map((pt: any) => [pt.lon, pt.lat]),
      },
    }));
}

/**
 * Query water bodies within a bounding box.
 */
export async function queryWaterBodiesInBBox(
  south: number,
  west: number,
  north: number,
  east: number,
): Promise<OverpassWaterBody[]> {
  const query = `[out:json][timeout:90];
(
  way["natural"="water"](${south},${west},${north},${east});
  relation["natural"="water"](${south},${west},${north},${east});
  way["waterway"="riverbank"](${south},${west},${north},${east});
  relation["waterway"="riverbank"](${south},${west},${north},${east});
  way["natural"="wetland"](${south},${west},${north},${east});
  relation["natural"="wetland"](${south},${west},${north},${east});
);
out geom tags;`;

  const data = await overpassFetch(query);
  const results: OverpassWaterBody[] = [];

  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {};
    const waterType =
      tags.natural === "water"
        ? "water"
        : tags.waterway === "riverbank"
          ? "riverbank"
          : tags.natural === "wetland"
            ? "wetland"
            : "water";

    if (el.type === "way") {
      if (!el.geometry || el.geometry.length < 3) continue;
      const coords: [number, number][] = el.geometry.map((pt: any) => [
        pt.lon,
        pt.lat,
      ]);
      const first = coords[0]!;
      const last = coords[coords.length - 1]!;
      if (first[0] !== last[0] || first[1] !== last[1]) {
        coords.push([first[0], first[1]]);
      }
      results.push({
        osmId: `way/${el.id}`,
        waterType,
        geometry: { type: "Polygon", coordinates: [coords] },
        name: tags.name ?? undefined,
      });
    } else if (el.type === "relation") {
      const outers = (el.members ?? []).filter(
        (m: any) => m.role === "outer" && m.geometry?.length >= 3,
      );
      if (outers.length === 0) continue;

      const outerRings: [number, number][][] = outers.map((m: any) => {
        const coords: [number, number][] = m.geometry.map((pt: any) => [
          pt.lon,
          pt.lat,
        ]);
        const first = coords[0]!;
        const last = coords[coords.length - 1]!;
        if (first[0] !== last[0] || first[1] !== last[1]) {
          coords.push([first[0], first[1]]);
        }
        return coords;
      });

      const geometry: WaterPolygon | WaterMultiPolygon =
        outerRings.length === 1
          ? { type: "Polygon", coordinates: [outerRings[0]!] }
          : {
              type: "MultiPolygon",
              coordinates: outerRings.map((ring) => [ring]),
            };

      results.push({
        osmId: `relation/${el.id}`,
        waterType,
        geometry,
        name: tags.name ?? undefined,
      });
    }
  }

  return results;
}
