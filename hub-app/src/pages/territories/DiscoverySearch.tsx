/**
 * DiscoverySearch — search for discoverable congregations.
 * Uses name, location (lat/lng + radius), circuit, and region filters.
 */
import { useState } from "react";

interface DiscoveryResult {
  id: string;
  name: string;
  subdomain: string;
  centroidLat: number | null;
  centroidLng: number | null;
  circuitNumber: string | null;
  region: string | null;
  country: string | null;
  city: string | null;
  distance: number | null;
  partnershipStatus: string | null;
}

const API_BASE = import.meta.env.VITE_API_URL || "";

async function apiFetch(path: string) {
  const token = localStorage.getItem("access_token");
  return fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export default function DiscoverySearch() {
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radius, setRadius] = useState("50");
  const [circuit, setCircuit] = useState("");
  const [region, setRegion] = useState("");
  const [results, setResults] = useState<DiscoveryResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSearched(true);

    const params = new URLSearchParams();
    if (name) params.set("name", name);
    if (lat && lng) {
      params.set("lat", lat);
      params.set("lng", lng);
      if (radius) params.set("radius", radius);
    }
    if (circuit) params.set("circuit", circuit);
    if (region) params.set("region", region);

    try {
      const res = await apiFetch(`/sharing/discover?${params.toString()}`);
      if (res.ok) {
        setResults(await res.json());
      }
    } finally {
      setLoading(false);
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
      },
      () => {
        // Silently fail — user can enter manually
      },
    );
  };

  const statusBadge = (status: string | null) => {
    if (!status) return null;
    const colors: Record<string, string> = {
      APPROVED: "bg-green-100 text-green-800",
      PENDING: "bg-yellow-100 text-yellow-800",
      REJECTED: "bg-red-100 text-red-800",
      REVOKED: "bg-gray-100 text-gray-800",
    };
    return (
      <span className={`text-xs px-2 py-0.5 rounded ${colors[status] || "bg-gray-100"}`}>
        {status.toLowerCase()}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Discover Congregations</h2>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="bg-white border rounded-lg p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Search by congregation name"
              className="border rounded px-3 py-1.5"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Circuit</span>
            <input
              type="text"
              value={circuit}
              onChange={(e) => setCircuit(e.target.value)}
              placeholder="e.g. BY-15"
              className="border rounded px-3 py-1.5"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Region</span>
            <input
              type="text"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="e.g. Bavaria"
              className="border rounded px-3 py-1.5"
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Location</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="Lat"
                className="border rounded px-2 py-1.5 w-24"
              />
              <input
                type="text"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="Lng"
                className="border rounded px-2 py-1.5 w-24"
              />
              <input
                type="number"
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
                placeholder="km"
                className="border rounded px-2 py-1.5 w-16"
              />
              <button
                type="button"
                onClick={useMyLocation}
                className="text-blue-600 text-sm hover:text-blue-800 whitespace-nowrap"
              >
                Use my location
              </button>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || (!name && !lat && !circuit && !region)}
          className="bg-blue-600 text-white px-6 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </form>

      {/* Results */}
      {searched && (
        <div>
          {results.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No congregations found matching your criteria.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-gray-500">{results.length} result(s)</p>
              {results.map((r) => (
                <div
                  key={r.id}
                  className="bg-white border rounded-lg p-4 flex justify-between items-start"
                >
                  <div>
                    <h3 className="font-semibold">{r.name}</h3>
                    <p className="text-sm text-gray-500">
                      {[r.city, r.region, r.country].filter(Boolean).join(", ")}
                    </p>
                    {r.circuitNumber && (
                      <p className="text-xs text-gray-400">Circuit: {r.circuitNumber}</p>
                    )}
                    {r.distance != null && (
                      <p className="text-xs text-gray-400">{r.distance.toFixed(1)} km away</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {statusBadge(r.partnershipStatus)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
