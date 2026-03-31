/**
 * Sharing depth filter — controls what territory data is exposed
 * based on the sharing depth (boundary, addresses, full).
 */

export type SharingDepth = "boundary" | "addresses" | "full";

interface TerritoryAddress {
  id: string;
  lat: number;
  lng: number;
  street?: string | null;
  houseNumber?: string | null;
  city?: string | null;
  postcode?: string | null;
  status?: string | null;
  lastVisitAt?: Date | string | null;
  notes?: string | null;
  [key: string]: unknown;
}

interface TerritoryData {
  id?: string;
  number: string;
  name: string;
  boundaries?: unknown;
  addresses?: TerritoryAddress[];
  [key: string]: unknown;
}

interface FilteredTerritory {
  number: string;
  name: string;
  boundaries?: unknown;
  addresses?: Partial<TerritoryAddress>[];
}

/**
 * Filter territory data based on sharing depth.
 *
 * - boundary: geometry only (number, name, boundaries)
 * - addresses: geometry + address list (no visit data)
 * - full: everything including visit data
 */
export function filterByDepth(
  territories: TerritoryData[],
  depth: SharingDepth,
): FilteredTerritory[] {
  return territories.map((t) => {
    const base: FilteredTerritory = {
      number: t.number,
      name: t.name,
      boundaries: t.boundaries,
    };

    if (depth === "boundary") {
      return base;
    }

    if (depth === "addresses") {
      base.addresses = (t.addresses || []).map((a) => ({
        id: a.id,
        lat: a.lat,
        lng: a.lng,
        street: a.street,
        houseNumber: a.houseNumber,
        city: a.city,
        postcode: a.postcode,
      }));
      return base;
    }

    // full — include everything
    base.addresses = (t.addresses || []).map((a) => ({
      id: a.id,
      lat: a.lat,
      lng: a.lng,
      street: a.street,
      houseNumber: a.houseNumber,
      city: a.city,
      postcode: a.postcode,
      status: a.status,
      lastVisitAt: a.lastVisitAt,
      notes: a.notes,
    }));
    return base;
  });
}
