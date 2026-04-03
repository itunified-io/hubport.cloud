/**
 * Shared KML parser utility — extracts Placemark polygons from KML strings.
 */

export interface ParsedPolygon {
  name: string | null;
  coordinates: number[][][]; // [ring[point[lng, lat, alt?]]]
}

/**
 * Minimal KML XML parser — extracts Placemark polygons.
 * Does not require a full XML parser dependency.
 */
export function parseKmlPolygons(kml: string): ParsedPolygon[] {
  const results: ParsedPolygon[] = [];

  // Extract all Placemarks
  const placemarkRegex = /<Placemark[^>]*>([\s\S]*?)<\/Placemark>/gi;
  let placemarkMatch: RegExpExecArray | null;

  while ((placemarkMatch = placemarkRegex.exec(kml)) !== null) {
    const content = placemarkMatch[1]!;

    // Extract name (handle xmlns="" attributes)
    const nameMatch = content.match(/<name[^>]*>([^<]*)<\/name>/i);
    const name = nameMatch ? nameMatch[1]!.trim() : null;

    // Extract coordinates from Polygon elements (handle xmlns="" attributes)
    const coordsRegex = /<coordinates[^>]*>\s*([\s\S]*?)\s*<\/coordinates>/gi;
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
