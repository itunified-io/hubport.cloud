/**
 * OpenStreetMap Nominatim geocoding client.
 * Rate-limited to 1 request/second per Nominatim usage policy.
 */

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const USER_AGENT = "HubportCloud/1.0 (territory-management)";

let lastRequestTime = 0;

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 1000 - elapsed));
  }
  lastRequestTime = Date.now();
  return fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
}

export interface NominatimResult {
  lat: number;
  lng: number;
  displayName: string;
  osmId: string;
  osmType: string;
  address?: {
    road?: string;
    houseNumber?: string;
    city?: string;
    postcode?: string;
    country?: string;
  };
}

/** Forward geocode: address string -> coordinates. */
export async function geocode(query: string): Promise<NominatimResult[]> {
  const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=5`;
  const response = await rateLimitedFetch(url);
  if (!response.ok)
    throw new Error(`Nominatim geocode failed: ${response.status}`);

  const data = (await response.json()) as any[];
  return data.map((item) => ({
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
    displayName: item.display_name,
    osmId: String(item.osm_id),
    osmType: item.osm_type,
    address: item.address
      ? {
          road: item.address.road,
          houseNumber: item.address.house_number,
          city:
            item.address.city || item.address.town || item.address.village,
          postcode: item.address.postcode,
          country: item.address.country,
        }
      : undefined,
  }));
}

/** Reverse geocode: coordinates -> address. */
export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<NominatimResult | null> {
  const url = `${NOMINATIM_BASE}/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
  const response = await rateLimitedFetch(url);
  if (!response.ok) return null;

  const item = (await response.json()) as any;
  if (!item || item.error) return null;

  return {
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
    displayName: item.display_name,
    osmId: String(item.osm_id),
    osmType: item.osm_type,
    address: item.address
      ? {
          road: item.address.road,
          houseNumber: item.address.house_number,
          city:
            item.address.city || item.address.town || item.address.village,
          postcode: item.address.postcode,
          country: item.address.country,
        }
      : undefined,
  };
}
