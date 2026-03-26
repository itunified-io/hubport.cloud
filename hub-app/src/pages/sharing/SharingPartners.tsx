import { useState, useEffect, useCallback } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  Plus, Handshake, Trash2, ExternalLink, CheckCircle, Clock, X,
  XCircle, Users, Map, Mic, MessageSquare, Shield, Settings2, Inbox,
} from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { usePermissions } from "../../auth/PermissionProvider";
import { getApiUrl } from "../../lib/config";

// ─── Types ────────────────────────────────────────────────────────────

interface Partner {
  approvalId: string;
  tenantId: string;
  name: string;
  subdomain: string;
  role: string;
  status: string;
  offeredCategories: string[];
  acceptedCategories: string[] | null;
}

interface IncomingRequest {
  id: string;
  status: string;
  offeredCategories: string[];
  requesterContactName: string | null;
  requesterContactEmail: string | null;
  message: string | null;
  createdAt: string;
  requester: { id: string; name: string; subdomain: string };
}

type SharingCategory = "speakers" | "territories" | "talks";

const ALL_CATEGORIES: SharingCategory[] = ["speakers", "territories", "talks"];

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  speakers: Users,
  territories: Map,
  talks: Mic,
};

// ─── Main Component ───────────────────────────────────────────────────

export function SharingPartners() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const intl = useIntl();
  const apiUrl = getApiUrl();
  const headers = { Authorization: `Bearer ${user?.access_token}` };

  const [tab, setTab] = useState<"partners" | "incoming">("partners");
  const [partners, setPartners] = useState<Partner[]>([]);
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [success, setSuccess] = useState("");

  const canEdit = can("app:sharing.edit");
  const canConfigure = can("app:sharing.configure");

  const loadData = useCallback(async () => {
    try {
      const [pRes, iRes] = await Promise.all([
        fetch(`${apiUrl}/sharing/partners`, { headers }),
        fetch(`${apiUrl}/sharing/incoming`, { headers }),
      ]);
      if (pRes.ok) setPartners(await pRes.json());
      if (iRes.ok) setIncoming(await iRes.json());
    } finally {
      setLoading(false);
    }
  }, [apiUrl, user?.access_token]);

  useEffect(() => { loadData(); }, [loadData]);

  const pendingCount = incoming.length;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--text)]">
          <FormattedMessage id="sharing.title" />
        </h1>
        {canEdit && (
          <button
            onClick={() => { setShowAdd(true); setSuccess(""); }}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--amber)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer"
          >
            <Plus size={16} />
            <FormattedMessage id="sharing.add" />
          </button>
        )}
      </div>

      {/* Success message */}
      {success && (
        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--green)]/10 border border-[var(--green)]/20 rounded-[var(--radius-sm)] text-sm text-[var(--green)]">
          <CheckCircle size={14} />
          {success}
          <button onClick={() => setSuccess("")} className="ml-auto cursor-pointer"><X size={14} /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--border)]">
        <button
          onClick={() => setTab("partners")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer border-b-2 -mb-px ${
            tab === "partners"
              ? "border-[var(--amber)] text-[var(--amber)]"
              : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          <Handshake size={15} />
          <FormattedMessage id="sharing.tabs.partners" />
        </button>
        <button
          onClick={() => setTab("incoming")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer border-b-2 -mb-px ${
            tab === "incoming"
              ? "border-[var(--amber)] text-[var(--amber)]"
              : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          <Inbox size={15} />
          <FormattedMessage id="sharing.tabs.incoming" />
          {pendingCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-[var(--amber)] text-black">
              {pendingCount}
            </span>
          )}
        </button>
      </div>

      {/* Add partner dialog */}
      {showAdd && (
        <RequestPartnerDialog
          apiUrl={apiUrl}
          headers={headers}
          intl={intl}
          onSuccess={(name) => {
            setSuccess(intl.formatMessage({ id: "sharing.success" }, { name }));
            setShowAdd(false);
            loadData();
          }}
          onClose={() => setShowAdd(false)}
        />
      )}

      {/* Tab content */}
      {loading ? (
        <div className="text-center py-8 text-sm text-[var(--text-muted)]">
          <FormattedMessage id="common.loading" />
        </div>
      ) : tab === "partners" ? (
        <PartnerList
          partners={partners}
          apiUrl={apiUrl}
          headers={headers}
          intl={intl}
          canEdit={canEdit}
          canConfigure={canConfigure}
          onUpdate={loadData}
        />
      ) : (
        <IncomingRequests
          requests={incoming}
          apiUrl={apiUrl}
          headers={headers}
          intl={intl}
          canEdit={canEdit}
          onUpdate={loadData}
        />
      )}
    </div>
  );
}

// ─── Category Badge ───────────────────────────────────────────────────

function CategoryBadge({ category }: { category: string }) {
  const Icon = CATEGORY_ICONS[category] || Mic;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-[var(--glass)] text-[var(--text-muted)]">
      <Icon size={10} />
      <FormattedMessage id={`sharing.category.${category}`} />
    </span>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────

function StatusBadge({ status, role }: { status: string; role: string }) {
  // Outgoing pending = "Awaiting Response"
  const isOutgoingPending = status === "PENDING" && role === "requested";
  const isActive = status === "APPROVED";
  const isRejected = status === "REJECTED";

  const style = isActive
    ? "bg-[var(--green)]/10 text-[var(--green)]"
    : isRejected
      ? "bg-[var(--red)]/10 text-[var(--red)]"
      : "bg-[var(--amber)]/10 text-[var(--amber)]";

  const icon = isActive ? <CheckCircle size={10} /> : isRejected ? <XCircle size={10} /> : <Clock size={10} />;
  const labelId = isActive
    ? "sharing.status.active"
    : isRejected
      ? "sharing.status.rejected"
      : isOutgoingPending
        ? "sharing.status.pending_out"
        : "sharing.status.pending";

  return (
    <span className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full ${style}`}>
      {icon}
      <FormattedMessage id={labelId} />
    </span>
  );
}

// ─── Partner List ─────────────────────────────────────────────────────

function PartnerList({
  partners, apiUrl, headers, intl, canEdit, canConfigure, onUpdate,
}: {
  partners: Partner[];
  apiUrl: string;
  headers: Record<string, string>;
  intl: ReturnType<typeof useIntl>;
  canEdit: boolean;
  canConfigure: boolean;
  onUpdate: () => void;
}) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [showVisibility, setShowVisibility] = useState<string | null>(null);

  const handleRemove = async (partner: Partner) => {
    if (!confirm(intl.formatMessage({ id: "sharing.remove.confirm" }, { name: partner.name }))) return;
    setRemoving(partner.tenantId);
    await fetch(`${apiUrl}/sharing/partners/${partner.tenantId}`, { method: "DELETE", headers });
    setRemoving(null);
    onUpdate();
  };

  if (partners.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
        <Handshake size={40} className="text-[var(--text-muted)] mb-3" strokeWidth={1.2} />
        <p className="text-sm text-[var(--text-muted)]"><FormattedMessage id="sharing.empty" /></p>
        <p className="text-xs text-[var(--text-muted)] mt-1"><FormattedMessage id="sharing.empty.hint" /></p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {partners.map((p) => (
        <div key={p.tenantId}>
          <div className="flex items-center gap-3 px-4 py-3 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] hover:bg-[var(--bg-2)] transition-colors">
            <Handshake size={18} className="text-[var(--amber)] shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-[var(--text)] truncate">{p.name}</div>
              <div className="text-xs text-[var(--text-muted)]">{p.subdomain}.hubport.cloud</div>
              {/* Category badges */}
              {p.acceptedCategories && (
                <div className="flex gap-1 mt-1.5">
                  {p.acceptedCategories.map((c) => <CategoryBadge key={c} category={c} />)}
                </div>
              )}
            </div>
            <StatusBadge status={p.status} role={p.role} />
            <a
              href={`https://${p.subdomain}.hubport.cloud`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              <ExternalLink size={14} />
            </a>
            {canConfigure && p.status === "APPROVED" && (
              <button
                onClick={() => setShowVisibility(showVisibility === p.tenantId ? null : p.tenantId)}
                className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
                title={intl.formatMessage({ id: "sharing.visibility.title" })}
              >
                <Settings2 size={14} />
              </button>
            )}
            {canEdit && (
              <button
                onClick={() => handleRemove(p)}
                disabled={removing === p.tenantId}
                className="text-[var(--text-muted)] hover:text-[var(--red)] transition-colors cursor-pointer disabled:opacity-50"
                title={intl.formatMessage({ id: "sharing.remove" })}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          {showVisibility === p.tenantId && (
            <VisibilitySettings
              partnerId={p.tenantId}
              acceptedCategories={p.acceptedCategories || []}
              apiUrl={apiUrl}
              headers={headers}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Request Partner Dialog ───────────────────────────────────────────

function RequestPartnerDialog({
  apiUrl, headers, intl, onSuccess, onClose,
}: {
  apiUrl: string;
  headers: Record<string, string>;
  intl: ReturnType<typeof useIntl>;
  onSuccess: (name: string) => void;
  onClose: () => void;
}) {
  const [subdomain, setSubdomain] = useState("");
  const [categories, setCategories] = useState<SharingCategory[]>([...ALL_CATEGORIES]);
  const [message, setMessage] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const toggleCategory = (cat: SharingCategory) => {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  const handleSubmit = async () => {
    if (!subdomain.trim() || categories.length === 0) return;
    setAdding(true);
    setError("");
    try {
      const res = await fetch(`${apiUrl}/sharing/partners`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          subdomain: subdomain.trim().toLowerCase(),
          offeredCategories: categories,
          message: message.trim() || undefined,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        onSuccess(result.partner?.name || subdomain);
      } else {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        setError(err.error || "Failed to send request");
      }
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="border border-[var(--border-2)] rounded-[var(--radius)] bg-[var(--bg-1)] p-4 space-y-4">
      <h3 className="text-sm font-semibold text-[var(--text)]">
        <FormattedMessage id="sharing.request.title" />
      </h3>

      {/* Subdomain input */}
      <div>
        <p className="text-xs text-[var(--text-muted)] mb-2">
          <FormattedMessage id="sharing.search.hint" />
        </p>
        <div className="relative">
          <input
            type="text"
            value={subdomain}
            onChange={(e) => setSubdomain(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder={intl.formatMessage({ id: "sharing.search.placeholder" })}
            className="w-full px-3 py-2 bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
            autoFocus
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)]">.hubport.cloud</span>
        </div>
      </div>

      {/* Category toggles */}
      <div>
        <p className="text-xs text-[var(--text-muted)] mb-2">
          <FormattedMessage id="sharing.request.categories" />
        </p>
        <div className="flex gap-2">
          {ALL_CATEGORIES.map((cat) => {
            const Icon = CATEGORY_ICONS[cat] || Mic;
            const active = categories.includes(cat);
            return (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors cursor-pointer ${
                  active
                    ? "border-[var(--amber)] bg-[var(--amber)]/10 text-[var(--amber)]"
                    : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-muted)]"
                }`}
              >
                <Icon size={12} />
                <FormattedMessage id={`sharing.category.${cat}`} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Optional message */}
      <div>
        <p className="text-xs text-[var(--text-muted)] mb-2">
          <FormattedMessage id="sharing.request.message" />
        </p>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={intl.formatMessage({ id: "sharing.request.message.placeholder" })}
          rows={2}
          className="w-full px-3 py-2 bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)] resize-none"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={adding || !subdomain.trim() || categories.length === 0}
          className="px-4 py-2 bg-[var(--amber)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] disabled:opacity-50 cursor-pointer"
        >
          {adding ? "..." : <FormattedMessage id="sharing.request.send" />}
        </button>
        <button
          onClick={onClose}
          className="px-3 py-2 border border-[var(--border)] text-sm text-[var(--text-muted)] rounded-[var(--radius-sm)] hover:bg-[var(--bg-2)] cursor-pointer"
        >
          <FormattedMessage id="sharing.cancel" />
        </button>
      </div>

      {error && <p className="text-sm text-[var(--red)]">{error}</p>}
    </div>
  );
}

// ─── Incoming Requests ────────────────────────────────────────────────

function IncomingRequests({
  requests, apiUrl, headers, intl, canEdit, onUpdate,
}: {
  requests: IncomingRequest[];
  apiUrl: string;
  headers: Record<string, string>;
  intl: ReturnType<typeof useIntl>;
  canEdit: boolean;
  onUpdate: () => void;
}) {
  const [approving, setApproving] = useState<string | null>(null);

  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
        <Inbox size={40} className="text-[var(--text-muted)] mb-3" strokeWidth={1.2} />
        <p className="text-sm text-[var(--text-muted)]"><FormattedMessage id="sharing.incoming.empty" /></p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((req) => (
        <div key={req.id}>
          <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-4 space-y-3">
            {/* Requester info */}
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-semibold text-[var(--text)]">{req.requester.name}</div>
                <div className="text-xs text-[var(--text-muted)]">{req.requester.subdomain}.hubport.cloud</div>
              </div>
              <span className="text-[10px] text-[var(--text-muted)]">
                {new Date(req.createdAt).toLocaleDateString()}
              </span>
            </div>

            {/* Contact person */}
            {req.requesterContactName && (
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <Users size={12} />
                <FormattedMessage id="sharing.incoming.contact" values={{ name: req.requesterContactName }} />
              </div>
            )}

            {/* Message */}
            {req.message && (
              <div className="flex items-start gap-1.5 text-xs text-[var(--text-muted)] bg-[var(--glass)] rounded-[var(--radius-sm)] px-3 py-2">
                <MessageSquare size={12} className="shrink-0 mt-0.5" />
                <span>{req.message}</span>
              </div>
            )}

            {/* Offered categories */}
            <div>
              <p className="text-[10px] text-[var(--text-muted)] mb-1 uppercase tracking-wide">
                <FormattedMessage id="sharing.incoming.offered" />
              </p>
              <div className="flex gap-1">
                {req.offeredCategories.map((c) => <CategoryBadge key={c} category={c} />)}
              </div>
            </div>

            {/* Actions */}
            {canEdit && (
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setApproving(approving === req.id ? null : req.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--green)]/10 text-[var(--green)] text-xs font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--green)]/20 transition-colors cursor-pointer"
                >
                  <Shield size={12} />
                  <FormattedMessage id="sharing.approve.title" />
                </button>
                <RejectButton
                  approvalId={req.id}
                  name={req.requester.name}
                  apiUrl={apiUrl}
                  headers={headers}
                  intl={intl}
                  onDone={onUpdate}
                />
              </div>
            )}
          </div>

          {/* Approve dialog */}
          {approving === req.id && (
            <ApproveRequestDialog
              request={req}
              apiUrl={apiUrl}
              headers={headers}
              onDone={() => { setApproving(null); onUpdate(); }}
              onCancel={() => setApproving(null)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Reject Button ────────────────────────────────────────────────────

function RejectButton({
  approvalId, name, apiUrl, headers, intl, onDone,
}: {
  approvalId: string;
  name: string;
  apiUrl: string;
  headers: Record<string, string>;
  intl: ReturnType<typeof useIntl>;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const handleReject = async () => {
    if (!confirm(intl.formatMessage({ id: "sharing.reject.confirm" }, { name }))) return;
    setBusy(true);
    await fetch(`${apiUrl}/sharing/incoming/${approvalId}/reject`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setBusy(false);
    onDone();
  };

  return (
    <button
      onClick={handleReject}
      disabled={busy}
      className="flex items-center gap-1.5 px-3 py-1.5 text-[var(--text-muted)] text-xs font-medium rounded-[var(--radius-sm)] border border-[var(--border)] hover:text-[var(--red)] hover:border-[var(--red)]/30 transition-colors cursor-pointer disabled:opacity-50"
    >
      <XCircle size={12} />
      <FormattedMessage id="sharing.reject.button" />
    </button>
  );
}

// ─── Approve Request Dialog ───────────────────────────────────────────

function ApproveRequestDialog({
  request, apiUrl, headers, onDone, onCancel,
}: {
  request: IncomingRequest;
  apiUrl: string;
  headers: Record<string, string>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [acceptedCategories, setAcceptedCategories] = useState<string[]>([...request.offeredCategories]);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const toggleCategory = (cat: string) => {
    setAcceptedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  const handleApprove = async () => {
    if (!termsAccepted || acceptedCategories.length === 0) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`${apiUrl}/sharing/incoming/${request.id}/approve`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ acceptedCategories, termsVersion: "1.0" }),
      });
      if (res.ok) {
        onDone();
      } else {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        setError(err.error || "Failed to approve");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-2 border border-[var(--green)]/20 rounded-[var(--radius)] bg-[var(--bg-1)] p-4 space-y-4">
      {/* Categories to accept */}
      <div>
        <p className="text-xs font-semibold text-[var(--text)] mb-2">
          <FormattedMessage id="sharing.approve.categories" />
        </p>
        <div className="flex gap-2">
          {request.offeredCategories.map((cat) => {
            const Icon = CATEGORY_ICONS[cat] || Mic;
            const active = acceptedCategories.includes(cat);
            return (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors cursor-pointer ${
                  active
                    ? "border-[var(--green)] bg-[var(--green)]/10 text-[var(--green)]"
                    : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-muted)]"
                }`}
              >
                <Icon size={12} />
                <FormattedMessage id={`sharing.category.${cat}`} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Sharing terms */}
      <div className="border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--bg-2)] p-3">
        <p className="text-xs font-semibold text-[var(--text)] mb-2">
          <FormattedMessage id="sharing.approve.terms" />
        </p>
        <div className="text-xs text-[var(--text-muted)] max-h-24 overflow-y-auto leading-relaxed">
          <FormattedMessage id="sharing.approve.terms.text" />
        </div>
      </div>

      {/* Terms toggle */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={termsAccepted}
          onChange={(e) => setTermsAccepted(e.target.checked)}
          className="w-4 h-4 rounded border-[var(--border)] accent-[var(--green)]"
        />
        <span className="text-xs font-medium text-[var(--text)]">
          <FormattedMessage id="sharing.approve.terms.accept" />
        </span>
      </label>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleApprove}
          disabled={submitting || !termsAccepted || acceptedCategories.length === 0}
          className="px-4 py-2 bg-[var(--green)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:opacity-90 disabled:opacity-50 cursor-pointer"
        >
          {submitting ? "..." : <FormattedMessage id="sharing.approve.button" />}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-2 border border-[var(--border)] text-sm text-[var(--text-muted)] rounded-[var(--radius-sm)] hover:bg-[var(--bg-2)] cursor-pointer"
        >
          <FormattedMessage id="sharing.cancel" />
        </button>
      </div>

      {error && <p className="text-sm text-[var(--red)]">{error}</p>}
    </div>
  );
}

// ─── Visibility Settings ──────────────────────────────────────────────

/** Category → which permissions/roles see this data */
const CATEGORY_ROLES: Record<string, { labelId: string }> = {
  speakers: { labelId: "sharing.visibility.who.speakers" },
  territories: { labelId: "sharing.visibility.who.territories" },
  talks: { labelId: "sharing.visibility.who.talks" },
};

function VisibilitySettings({
  partnerId, acceptedCategories, apiUrl, headers,
}: {
  partnerId: string;
  acceptedCategories: string[];
  apiUrl: string;
  headers: Record<string, string>;
}) {
  const [visibility, setVisibility] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch(`${apiUrl}/sharing/partners/${partnerId}/visibility`, { headers });
      if (res.ok) setVisibility(await res.json());
      setLoaded(true);
    })();
  }, [partnerId]);

  const toggleCategory = async (cat: string) => {
    const current = visibility[cat] || "enabled";
    const next = current === "disabled" ? "enabled" : "disabled";
    const updated = { ...visibility, [cat]: next };
    setVisibility(updated);
    setSaving(true);
    await fetch(`${apiUrl}/sharing/partners/${partnerId}/visibility`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    setSaving(false);
  };

  if (!loaded) return null;

  return (
    <div className="mt-1 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-4 space-y-3">
      <p className="text-xs font-semibold text-[var(--text)]">
        <FormattedMessage id="sharing.visibility.title" />
      </p>
      <p className="text-[10px] text-[var(--text-muted)]">
        <FormattedMessage id="sharing.visibility.hint" />
      </p>
      {acceptedCategories.map((cat) => {
        const Icon = CATEGORY_ICONS[cat] || Mic;
        const enabled = (visibility[cat] || "enabled") !== "disabled";
        const roleInfo = CATEGORY_ROLES[cat];
        return (
          <div key={cat} className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-xs text-[var(--text)]">
                <Icon size={12} />
                <FormattedMessage id={`sharing.category.${cat}`} />
              </div>
              {roleInfo && (
                <p className="text-[10px] text-[var(--text-muted)] mt-0.5 ml-[18px]">
                  <FormattedMessage id={roleInfo.labelId} />
                </p>
              )}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              disabled={saving}
              onClick={() => toggleCategory(cat)}
              className={`relative shrink-0 w-9 h-5 rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                enabled ? "bg-[var(--amber)]" : "bg-[var(--glass-2)]"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  enabled ? "translate-x-4" : ""
                }`}
              />
            </button>
          </div>
        );
      })}
    </div>
  );
}
