/**
 * ShareRedeemPage — public page to view a shared territory via share code.
 * Route: /shared/t/:code
 *
 * Renders territory boundary on a map. Prompts for PIN if required.
 */
import { useState, useEffect } from "react";
import { useParams } from "react-router";

interface SharedTerritory {
  number: string;
  name: string;
  boundaries?: unknown;
  addresses?: Array<{
    id: string;
    lat: number;
    lng: number;
    street?: string;
    houseNumber?: string;
    city?: string;
    postcode?: string;
    status?: string;
    lastVisitAt?: string;
    notes?: string;
  }>;
}

interface ShareResponse {
  scope: string;
  territory: SharedTerritory;
}

const API_BASE = import.meta.env.VITE_API_URL || "";

export default function ShareRedeemPage(): React.JSX.Element | null {
  const { code } = useParams();
  const [data, setData] = useState<ShareResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requiresPin, setRequiresPin] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);

  const fetchShare = async (pinValue?: string) => {
    if (!code) return;
    setLoading(true);
    setError(null);
    setPinError(null);

    try {
      const url = new URL(`${API_BASE}/territories/shared/${code}`);
      if (pinValue) url.searchParams.set("pin", pinValue);

      const res = await fetch(url.toString());

      if (res.status === 403) {
        const body = await res.json();
        if (body.requiresPin) {
          setRequiresPin(true);
          setLoading(false);
          return;
        }
        setPinError(body.error || "Invalid PIN");
        setLoading(false);
        return;
      }

      if (res.status === 404) {
        setError("This share link is not found or has expired.");
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setError("Something went wrong. Please try again later.");
        setLoading(false);
        return;
      }

      const result = await res.json();
      setData(result);
      setRequiresPin(false);
    } catch {
      setError("Unable to load. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchShare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length >= 4) {
      fetchShare(pin);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading shared territory...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-2">
          <p className="text-gray-600 text-lg">{error}</p>
          <p className="text-gray-400 text-sm">
            The link may have expired or been revoked.
          </p>
        </div>
      </div>
    );
  }

  if (requiresPin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <form onSubmit={handlePinSubmit} className="bg-white p-6 rounded-lg shadow space-y-4 w-80">
          <h2 className="text-lg font-semibold text-center">PIN Required</h2>
          <p className="text-sm text-gray-500 text-center">
            This territory share is protected by a PIN.
          </p>
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Enter PIN"
            maxLength={8}
            className="w-full border rounded px-3 py-2 text-center text-lg tracking-widest"
            autoFocus
          />
          {pinError && (
            <p className="text-red-600 text-sm text-center">{pinError}</p>
          )}
          <button
            type="submit"
            disabled={pin.length < 4}
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Unlock
          </button>
        </form>
      </div>
    );
  }

  if (!data) return null;

  const { territory, scope } = data;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Header */}
        <div className="bg-white rounded-lg shadow p-4">
          <h1 className="text-xl font-bold">
            Territory {territory.number} {"\u2014"} {territory.name}
          </h1>
          <p className="text-sm text-gray-500">
            Shared view ({scope})
          </p>
        </div>

        {/* Map placeholder — boundary rendering */}
        {!!territory.boundaries && (
          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="font-semibold mb-2">Boundary</h2>
            <div className="bg-gray-100 rounded h-64 flex items-center justify-center text-gray-400">
              Map view (integrate with mapping library)
            </div>
          </div>
        )}

        {/* Address list (addresses or full scope) */}
        {territory.addresses && territory.addresses.length > 0 && (
          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="font-semibold mb-2">
              Addresses ({territory.addresses.length})
            </h2>
            <div className="space-y-2">
              {territory.addresses.map((addr) => (
                <div key={addr.id} className="flex justify-between items-start border-b pb-2">
                  <div>
                    <p className="font-medium">
                      {addr.street} {addr.houseNumber}
                    </p>
                    <p className="text-sm text-gray-500">
                      {addr.postcode} {addr.city}
                    </p>
                  </div>
                  {scope === "full" && addr.status && (
                    <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                      {addr.status}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-gray-400">
          Powered by hubport.cloud
        </p>
      </div>
    </div>
  );
}
