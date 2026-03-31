/**
 * ShareLinkManager — share tab in territory detail view.
 * Create, list, and revoke territory share links.
 */
import { useState, useEffect, useCallback } from "react";

interface ShareLink {
  id: string;
  scope: string;
  hasPIN: boolean;
  expiresAt: string;
  isActive: boolean;
  revokedAt: string | null;
  createdAt: string;
  accessCount: number;
}

interface CreatedShare extends ShareLink {
  code: string;
}

interface ShareLinkManagerProps {
  territoryId: string;
  shareExcluded?: boolean;
}

const API_BASE = import.meta.env.VITE_API_URL || "";

async function apiFetch(path: string, opts?: RequestInit) {
  const token = localStorage.getItem("access_token");
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts?.headers,
    },
  });
  return res;
}

export default function ShareLinkManager({ territoryId, shareExcluded }: ShareLinkManagerProps) {
  const [shares, setShares] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newShare, setNewShare] = useState<CreatedShare | null>(null);
  const [scope, setScope] = useState<"boundary" | "addresses" | "full">("boundary");
  const [pin, setPin] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [error, setError] = useState<string | null>(null);

  const loadShares = useCallback(async () => {
    try {
      const res = await apiFetch(`/territories/${territoryId}/shares`);
      if (res.ok) {
        setShares(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, [territoryId]);

  useEffect(() => {
    loadShares();
  }, [loadShares]);

  const handleCreate = async () => {
    setError(null);
    setCreating(true);
    try {
      const body: Record<string, unknown> = { scope, expiresInDays };
      if (pin) body.pin = pin;

      const res = await apiFetch(`/territories/${territoryId}/share`, {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        setError(err.message || err.error || "Failed to create share link");
        return;
      }

      const created = await res.json();
      setNewShare(created);
      setPin("");
      await loadShares();
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (shareId: string) => {
    await apiFetch(`/territories/${territoryId}/share/${shareId}`, {
      method: "DELETE",
    });
    await loadShares();
  };

  const copyLink = (code: string) => {
    const url = `${window.location.origin}/shared/t/${code}`;
    navigator.clipboard.writeText(url);
  };

  if (shareExcluded) {
    return (
      <div className="p-4 text-center text-gray-500">
        This territory is excluded from sharing.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Create Share */}
      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="font-semibold text-lg">Create Share Link</h3>

        <div className="flex gap-4 items-end flex-wrap">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Scope</span>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as typeof scope)}
              className="border rounded px-2 py-1"
            >
              <option value="boundary">Boundary only</option>
              <option value="addresses">Addresses</option>
              <option value="full">Full (incl. visit data)</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Expires in (days)</span>
            <input
              type="number"
              min={1}
              max={365}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(Number(e.target.value))}
              className="border rounded px-2 py-1 w-20"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">PIN (optional)</span>
            <input
              type="text"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="4-8 digits"
              maxLength={8}
              className="border rounded px-2 py-1 w-28"
            />
          </label>

          <button
            onClick={handleCreate}
            disabled={creating}
            className="bg-blue-600 text-white px-4 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create"}
          </button>
        </div>

        {error && (
          <p className="text-red-600 text-sm">{error}</p>
        )}

        {newShare && (
          <div className="bg-green-50 border border-green-200 rounded p-3 space-y-2">
            <p className="font-medium text-green-800">Share link created!</p>
            <div className="flex items-center gap-2">
              <code className="bg-white px-2 py-1 rounded text-sm flex-1 overflow-hidden text-ellipsis">
                {window.location.origin}/shared/t/{newShare.code}
              </code>
              <button
                onClick={() => copyLink(newShare.code)}
                className="text-blue-600 hover:text-blue-800 text-sm whitespace-nowrap"
              >
                Copy
              </button>
            </div>
            <p className="text-xs text-gray-500">
              This code is shown only once. Copy it now.
            </p>
          </div>
        )}
      </div>

      {/* Existing Shares */}
      <div>
        <h3 className="font-semibold text-lg mb-2">Existing Shares</h3>
        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : shares.length === 0 ? (
          <p className="text-gray-500">No share links yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Scope</th>
                <th>PIN</th>
                <th>Expires</th>
                <th>Views</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shares.map((s) => (
                <tr key={s.id} className="border-b">
                  <td className="py-2">{s.scope}</td>
                  <td>{s.hasPIN ? "Yes" : "No"}</td>
                  <td>{new Date(s.expiresAt).toLocaleDateString()}</td>
                  <td>{s.accessCount}</td>
                  <td>
                    {s.isActive && !s.revokedAt ? (
                      <span className="text-green-600">Active</span>
                    ) : (
                      <span className="text-gray-400">Revoked</span>
                    )}
                  </td>
                  <td>
                    {s.isActive && !s.revokedAt && (
                      <button
                        onClick={() => handleRevoke(s.id)}
                        className="text-red-600 hover:text-red-800 text-xs"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
