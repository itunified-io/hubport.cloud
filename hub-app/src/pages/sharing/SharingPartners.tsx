import { useState, useEffect, useCallback } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Plus, Handshake, Trash2, ExternalLink, CheckCircle, Clock, X } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { getApiUrl } from "../../lib/config";

interface Partner {
  approvalId: string;
  tenantId: string;
  name: string;
  subdomain: string;
  role: string;
  approved: boolean;
}

export function SharingPartners() {
  const { user } = useAuth();
  const intl = useIntl();
  const apiUrl = getApiUrl();
  const headers = { Authorization: `Bearer ${user?.access_token}` };

  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [subdomain, setSubdomain] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);

  const loadPartners = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/sharing/partners`, { headers });
      if (res.ok) setPartners(await res.json());
    } finally {
      setLoading(false);
    }
  }, [apiUrl, user?.access_token]);

  useEffect(() => { loadPartners(); }, [loadPartners]);

  const handleAdd = async () => {
    if (!subdomain.trim()) return;
    setAdding(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${apiUrl}/sharing/partners`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ subdomain: subdomain.trim().toLowerCase() }),
      });
      if (res.ok) {
        const result = await res.json();
        setSuccess(intl.formatMessage({ id: "sharing.success" }, { name: result.partner?.name || subdomain }));
        setSubdomain("");
        setShowAdd(false);
        await loadPartners();
      } else {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        setError(err.error || "Failed to add partner");
      }
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (partner: Partner) => {
    if (!confirm(intl.formatMessage({ id: "sharing.remove.confirm" }, { name: partner.name }))) return;
    setRemoving(partner.tenantId);
    await fetch(`${apiUrl}/sharing/partners/${partner.tenantId}`, {
      method: "DELETE",
      headers,
    });
    setRemoving(null);
    await loadPartners();
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--text)]">
          <FormattedMessage id="sharing.title" />
        </h1>
        <button
          onClick={() => { setShowAdd(true); setError(""); setSuccess(""); }}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--amber)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer"
        >
          <Plus size={16} />
          <FormattedMessage id="sharing.add" />
        </button>
      </div>

      {/* Success message */}
      {success && (
        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--green)]/10 border border-[var(--green)]/20 rounded-[var(--radius-sm)] text-sm text-[var(--green)]">
          <CheckCircle size={14} />
          {success}
          <button onClick={() => setSuccess("")} className="ml-auto cursor-pointer"><X size={14} /></button>
        </div>
      )}

      {/* Add partner modal */}
      {showAdd && (
        <div className="border border-[var(--border-2)] rounded-[var(--radius)] bg-[var(--bg-1)] p-4 space-y-3">
          <h3 className="text-sm font-semibold text-[var(--text)]">
            <FormattedMessage id="sharing.add" />
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            <FormattedMessage id="sharing.search.hint" />
          </p>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                placeholder={intl.formatMessage({ id: "sharing.search.placeholder" })}
                className="w-full px-3 py-2 bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
                autoFocus
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)]">.hubport.cloud</span>
            </div>
            <button
              onClick={handleAdd}
              disabled={adding || !subdomain.trim()}
              className="px-4 py-2 bg-[var(--amber)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] disabled:opacity-50 cursor-pointer"
            >
              {adding ? "..." : <FormattedMessage id="sharing.connect" />}
            </button>
            <button
              onClick={() => { setShowAdd(false); setError(""); }}
              className="px-3 py-2 border border-[var(--border)] text-sm text-[var(--text-muted)] rounded-[var(--radius-sm)] hover:bg-[var(--bg-2)] cursor-pointer"
            >
              <FormattedMessage id="sharing.cancel" />
            </button>
          </div>
          {error && (
            <p className="text-sm text-[var(--red)]">{error}</p>
          )}
        </div>
      )}

      {/* Partner list */}
      {loading ? (
        <div className="text-center py-8 text-sm text-[var(--text-muted)]">
          <FormattedMessage id="common.loading" />
        </div>
      ) : partners.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
          <Handshake size={40} className="text-[var(--text-muted)] mb-3" strokeWidth={1.2} />
          <p className="text-sm text-[var(--text-muted)]">
            <FormattedMessage id="sharing.empty" />
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            <FormattedMessage id="sharing.empty.hint" />
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {partners.map((p) => (
            <div
              key={p.tenantId}
              className="flex items-center gap-3 px-4 py-3 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] hover:bg-[var(--bg-2)] transition-colors"
            >
              <Handshake size={18} className="text-[var(--amber)] shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--text)] truncate">{p.name}</div>
                <div className="text-xs text-[var(--text-muted)]">{p.subdomain}.hubport.cloud</div>
              </div>
              {/* Status badge */}
              <span className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                p.approved
                  ? "bg-[var(--green)]/10 text-[var(--green)]"
                  : "bg-[var(--amber)]/10 text-[var(--amber)]"
              }`}>
                {p.approved ? <CheckCircle size={10} /> : <Clock size={10} />}
                <FormattedMessage id={p.approved ? "sharing.status.active" : "sharing.status.pending"} />
              </span>
              {/* Link to partner */}
              <a
                href={`https://${p.subdomain}.hubport.cloud`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                title={p.subdomain}
              >
                <ExternalLink size={14} />
              </a>
              {/* Remove button */}
              <button
                onClick={() => handleRemove(p)}
                disabled={removing === p.tenantId}
                className="text-[var(--text-muted)] hover:text-[var(--red)] transition-colors cursor-pointer disabled:opacity-50"
                title={intl.formatMessage({ id: "sharing.remove" })}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
