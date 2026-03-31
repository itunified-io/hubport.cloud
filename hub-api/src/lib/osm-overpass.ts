/**
 * OpenStreetMap Overpass API client.
 * Used for querying buildings, roads, and water bodies within a bounding box
 * for territory snap context.
 */

const OVERPASS_API = "https://overpass-api.de/api/interpreter";
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

async function overpassFetch(query: string, timeoutMs = 120_000): Promise<any> {
  const MAX_RETRIES = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(5000 * Math.pow(2, attempt - 1), 30000);
      await new Promise((r) => setTimeout(r, delay));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(OVERPASS_API, {
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
        response.status === 429 ||
        response.status === 503
      ) {
        lastError = new Error(
          `Overpass API error: ${response.status} ${response.statusText}`,
        );
        continue;
      }

      if (!response.ok) {
        throw new Error(
          `Overpass API error: ${response.status} ${response.statusText}`,
        );
      }

      return await response.json();
    } catch (err: unknown) {
      clearTimeout(timeout);
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === MAX_RETRIES - 1) throw lastError;
    }
  }

  throw lastError || new Error("Overpass API failed after retries");
}

/**
 * Query buildings within a bounding box.
 */
export async function queryBuildingsInBBox(
  south: number,
  west: number,
  north: number,
  east: number,
): Promise<OverpassBuilding[]> {
  const query = `
    [out:json][timeout:180];
    (
      way["building"](${south},${west},${north},${east});
      relation["building"](${south},${west},${north},${east});
    );
    out center tags;
  `;

  const data = await overpassFetch(query, 200_000);

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

/**
 * Query roads within a bounding box.
 */
export async function queryRoadsInBBox(
  south: number,
  west: number,
  north: number,
  east: number,
): Promise<OverpassRoad[]> {
  const query = `[out:json][timeout:120];
(
  way["highway"~"^(primary|secondary|tertiary|residential|service|track|path|unclassified|living_street)$"](${south},${west},${north},${east});
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
  const query = `[out:json][timeout:180];
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
