import { useState, useEffect, useCallback } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Plus, Handshake, Trash2, Loader2, X } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";

interface Partner {
  id: string;
  name: string;
  subdomain: string;
}

interface Approval {
  id: string;
  requesterId: string;
  approverId: string;
  approved: boolean;
  requester: Partner;
  approver: Partner;
}

export function SharingPartners() {
  const { user } = useAuth();
  const intl = useIntl();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [subdomain, setSubdomain] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = getApiUrl();
  const headers = { Authorization: `Bearer ${user?.access_token}` };

  const fetchPartners = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/sharing/partners`, { headers });
      if (res.ok) {
        const data = (await res.json()) as { tenantId: string; approvals: Approval[] };
        setTenantId(data.tenantId);
        setApprovals(data.approvals);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [apiUrl, user?.access_token]);

  useEffect(() => {
    fetchPartners();
  }, [fetchPartners]);

  const handleConnect = async () => {
    if (!subdomain.trim()) return;
    setConnecting(true);
    setError(null);

    try {
      const res = await fetch(`${apiUrl}/sharing/connect`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ partnerSubdomain: subdomain.trim().toLowerCase() }),
      });

      if (res.ok) {
        setShowForm(false);
        setSubdomain("");
        await fetchPartners();
      } else {
        const body = (await res.json().catch(() => ({}))) as Record<string, string>;
        setError(body.error || intl.formatMessage({ id: "sharing.error.connect" }));
      }
    } catch {
      setError(intl.formatMessage({ id: "sharing.error.connect" }));
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (partnerId: string) => {
    try {
      await fetch(`${apiUrl}/sharing/partners/${partnerId}`, {
        method: "DELETE",
        headers,
      });
      await fetchPartners();
    } catch {
      // silently fail
    }
  };

  const getPartner = (approval: Approval): Partner => {
    return approval.requesterId === tenantId ? approval.approver : approval.requester;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--text)]">
          <FormattedMessage id="sharing.title" />
        </h1>
        <button
          onClick={() => { setShowForm(true); setError(null); }}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--amber)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer"
        >
          <Plus size={16} />
          <FormattedMessage id="sharing.add" />
        </button>
      </div>

      {/* Add partner form */}
      {showForm && (
        <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-4 space-y-3">
          <h2 className="text-sm font-semibold text-[var(--text)]">
            <FormattedMessage id="sharing.add" />
          </h2>
          <p className="text-xs text-[var(--text-muted)]">
            <FormattedMessage id="sharing.add.hint" />
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={subdomain}
              onChange={(e) => { setSubdomain(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleConnect(); }}
              placeholder={intl.formatMessage({ id: "sharing.add.placeholder" })}
              className="flex-1 px-3 py-2 bg-[var(--bg-0)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--amber)]"
              autoFocus
            />
            <span className="text-sm text-[var(--text-muted)]">.hubport.cloud</span>
            <button
              onClick={handleConnect}
              disabled={connecting || !subdomain.trim()}
              className="px-4 py-2 bg-[var(--amber)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {connecting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <FormattedMessage id="sharing.connect" />
              )}
            </button>
            <button
              onClick={() => { setShowForm(false); setSubdomain(""); setError(null); }}
              className="px-3 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
            >
              <FormattedMessage id="sharing.cancel" />
            </button>
          </div>
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400">
              <X size={14} />
              {error}
            </div>
          )}
        </div>
      )}

      {/* Partner list */}
      {approvals.length > 0 ? (
        <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] divide-y divide-[var(--border)]">
          {approvals.map((approval) => {
            const partner = getPartner(approval);
            return (
              <div
                key={approval.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <Handshake size={18} className="text-[var(--amber)]" />
                  <div>
                    <p className="text-sm font-medium text-[var(--text)]">
                      {partner.name}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {partner.subdomain}.hubport.cloud
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleDisconnect(partner.id)}
                  className="p-2 text-[var(--text-muted)] hover:text-red-400 transition-colors cursor-pointer"
                  title={intl.formatMessage({ id: "sharing.disconnect" })}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        !showForm && (
          <div className="flex flex-col items-center justify-center py-16 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
            <Handshake size={40} className="text-[var(--text-muted)] mb-3" strokeWidth={1.2} />
            <p className="text-sm text-[var(--text-muted)]">
              <FormattedMessage id="sharing.empty" />
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              <FormattedMessage id="sharing.empty.hint" />
            </p>
          </div>
        )
      )}
    </div>
  );
}
