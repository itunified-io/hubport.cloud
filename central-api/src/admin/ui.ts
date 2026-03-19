/**
 * Admin portal UI components — polished dark/amber design system.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Custom modal JS + CSS injected into the shell */
function modalSystem(): string {
  return `
  <style>
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); z-index: 100; display: none; align-items: center; justify-content: center; }
    .modal-overlay.active { display: flex; }
    .modal { background: #0c0c12; border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; max-width: 480px; width: 90%; padding: 0; box-shadow: 0 25px 50px rgba(0,0,0,0.5); animation: modalIn 0.15s ease-out; }
    @keyframes modalIn { from { opacity: 0; transform: scale(0.95) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
    .modal-header { padding: 20px 24px 0; display: flex; align-items: center; gap: 12px; }
    .modal-icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .modal-icon.danger { background: rgba(239,68,68,0.15); color: #ef4444; }
    .modal-icon.approve { background: rgba(34,197,94,0.15); color: #22c55e; }
    .modal-icon.reject { background: rgba(217,119,6,0.15); color: #d97706; }
    .modal-body { padding: 16px 24px; }
    .modal-body p { color: #a1a1aa; font-size: 14px; line-height: 1.6; margin: 0 0 8px; }
    .modal-body ul { color: #a1a1aa; font-size: 13px; line-height: 1.6; padding-left: 0; list-style: none; margin: 12px 0; }
    .modal-body ul li { padding: 4px 0; display: flex; align-items: start; gap: 8px; }
    .modal-body ul li::before { content: ''; width: 6px; height: 6px; border-radius: 50%; margin-top: 6px; flex-shrink: 0; }
    .modal-body ul.danger li::before { background: #ef4444; }
    .modal-body ul.approve li::before { background: #22c55e; }
    .modal-footer { padding: 16px 24px 20px; display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid rgba(255,255,255,0.04); margin-top: 8px; }
  </style>
  <script>
    function showModal(id) { document.getElementById(id).classList.add('active'); }
    function hideModal(id) { document.getElementById(id).classList.remove('active'); }
    document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active')); });
  </script>`;
}

export function shell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} — Hubport Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-0: #050507; --bg-1: #08080c; --bg-2: #0c0c12; --bg-3: #101018;
      --glass: rgba(255,255,255,.02); --glass-2: rgba(255,255,255,.035);
      --border: rgba(255,255,255,.04); --border-h: rgba(255,255,255,.08);
      --amber: #d97706; --amber-l: #f59e0b; --green: #22c55e; --red: #ef4444; --blue: #3b82f6;
    }
    body { font-family: 'Inter', system-ui, sans-serif; background: var(--bg-0); color: #e4e4e7; }
    .card { background: var(--glass); border: 1px solid var(--border); border-radius: 12px; transition: border-color 0.15s; }
    .card:hover { border-color: var(--border-h); }
    .btn { background: linear-gradient(135deg, #d97706, #b45309); color: #fff; padding: 8px 20px; border-radius: 8px; font-weight: 600; border: none; cursor: pointer; font-size: 14px; transition: all 0.15s; display: inline-flex; align-items: center; gap: 6px; }
    .btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(217,119,6,0.3); }
    .btn-danger { background: linear-gradient(135deg, #ef4444, #dc2626); }
    .btn-danger:hover { box-shadow: 0 4px 12px rgba(239,68,68,0.3); }
    .btn-secondary { background: var(--glass-2); border: 1px solid var(--border-h); color: #e4e4e7; padding: 8px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500; }
    .btn-secondary:hover { background: rgba(255,255,255,0.06); }
    .input { background: var(--bg-1); border: 1px solid var(--border-h); border-radius: 8px; padding: 8px 14px; color: #e4e4e7; width: 100%; font-size: 14px; outline: none; transition: border-color 0.15s; }
    .input:focus { border-color: var(--amber); }
    .badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .badge-pending { background: rgba(217,119,6,0.12); color: #f59e0b; border: 1px solid rgba(217,119,6,0.25); }
    .badge-approved { background: rgba(59,130,246,0.12); color: #60a5fa; border: 1px solid rgba(59,130,246,0.25); }
    .badge-active { background: rgba(34,197,94,0.12); color: #4ade80; border: 1px solid rgba(34,197,94,0.25); }
    .badge-rejected { background: rgba(239,68,68,0.12); color: #f87171; border: 1px solid rgba(239,68,68,0.25); }
    .badge-decommissioned { background: rgba(113,113,122,0.12); color: #a1a1aa; border: 1px solid rgba(113,113,122,0.25); }
    .stat-icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px; }
    ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: #18181b; border-radius: 2px; }
  </style>
</head>
<body class="min-h-screen">
  ${modalSystem()}
  <nav class="bg-[var(--bg-1)]/80 backdrop-blur-lg border-b border-white/[.04] sticky top-0 z-50">
    <div class="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-[#d97706] to-[#b45309] flex items-center justify-center text-white font-bold text-sm">H</div>
        <a href="/admin" class="text-lg font-bold text-white tracking-tight">hubport.cloud</a>
        <span class="badge badge-pending text-[10px]">ADMIN</span>
      </div>
      <div class="flex items-center gap-4">
        <a href="/health" class="text-xs text-zinc-500 hover:text-zinc-300">API Health</a>
        <span class="text-xs text-zinc-600">|</span>
        <span class="text-xs text-zinc-500">Platform Administration</span>
        <span class="text-xs text-zinc-600">|</span>
        <a href="/cdn-cgi/access/logout" class="text-xs text-zinc-500 hover:text-[#ef4444] transition-colors">Logout</a>
      </div>
    </div>
  </nav>
  <main class="max-w-6xl mx-auto px-6 py-8">${body}</main>
  <footer class="max-w-6xl mx-auto px-6 py-6 border-t border-white/[.04] mt-12">
    <div class="flex items-center justify-between text-xs text-zinc-600">
      <span>hubport.cloud — ITUnified UG</span>
      <span>Admin Portal v2026.03.19</span>
    </div>
  </footer>
</body>
</html>`;
}

export function statsCard(label: string, count: number, color: string): string {
  const icons: Record<string, string> = {
    Pending: '\u23F3', Approved: '\u2705', Active: '\u26A1', Rejected: '\u274C', Total: '\u{1F4CA}',
  };
  const icon = icons[label] || '\u{1F4CB}';
  return `
    <div class="card p-5">
      <div class="flex items-center gap-3">
        <div class="stat-icon" style="background: ${color}15; color: ${color}">${icon}</div>
        <div>
          <div class="text-3xl font-bold tracking-tight" style="color: ${color}">${count}</div>
          <div class="text-xs text-zinc-500 font-medium uppercase tracking-wider mt-0.5">${esc(label)}</div>
        </div>
      </div>
    </div>`;
}

interface TenantLike {
  id: string;
  name: string;
  email: string;
  subdomain: string;
  status: string;
  createdAt: Date;
  rejectReason?: string | null;
}

function isDecommissioned(tenant: TenantLike): boolean {
  return tenant.status === 'REJECTED' && tenant.rejectReason === 'Decommissioned';
}

function displayStatus(tenant: TenantLike): string {
  if (isDecommissioned(tenant)) return 'DECOMMISSIONED';
  return tenant.status;
}

function statusBadge(tenant: TenantLike): string {
  const status = displayStatus(tenant);
  const dot = status === 'ACTIVE' ? '\u25CF ' : '';
  const cls = status === 'PENDING' ? 'badge-pending'
    : status === 'APPROVED' ? 'badge-approved'
    : status === 'ACTIVE' ? 'badge-active'
    : status === 'DECOMMISSIONED' ? 'badge-decommissioned'
    : 'badge-rejected';
  return `<span class="badge ${cls}">${dot}${esc(status)}</span>`;
}

function timeAgo(date: Date): string {
  const d = date instanceof Date ? date : new Date(date);
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toISOString().slice(0, 10);
}

export function tenantRow(tenant: TenantLike, showActions: boolean): string {
  const modalId = `approve-${tenant.id.slice(0, 8)}`;
  const rejectId = `reject-${tenant.id.slice(0, 8)}`;

  return `
    <div class="card p-4 flex items-center justify-between gap-4">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2.5 mb-1.5">
          <a href="/admin/tenant/${esc(tenant.id)}" class="font-semibold text-white hover:text-[#f59e0b] transition-colors truncate">${esc(tenant.name)}</a>
          ${statusBadge(tenant)}
        </div>
        <div class="text-sm text-zinc-500 truncate flex items-center gap-1.5">
          <span class="text-[#f59e0b]/60 font-mono text-xs">${esc(tenant.subdomain)}.hubport.cloud</span>
          <span class="text-zinc-700">\u00B7</span>
          <span>${esc(tenant.email)}</span>
          <span class="text-zinc-700">\u00B7</span>
          <span>${timeAgo(tenant.createdAt)}</span>
        </div>
      </div>
      ${showActions ? `
        <div class="flex gap-2 shrink-0">
          <button type="button" class="btn text-sm" onclick="showModal('${modalId}')">Approve</button>
          <button type="button" class="btn btn-danger text-sm" onclick="showModal('${rejectId}')">Reject</button>
        </div>

        <!-- Approve Modal -->
        <div id="${modalId}" class="modal-overlay" onclick="if(event.target===this)hideModal('${modalId}')">
          <div class="modal">
            <div class="modal-header">
              <div class="modal-icon approve">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>
              </div>
              <h3 class="text-lg font-semibold text-white">Approve ${esc(tenant.name)}</h3>
            </div>
            <div class="modal-body">
              <p>This will provision infrastructure for <strong class="text-white">${esc(tenant.subdomain)}.hubport.cloud</strong>:</p>
              <ul class="approve">
                <li>Create CF Tunnel <span class="font-mono text-xs text-zinc-500">(hubport-tenant-${esc(tenant.subdomain)})</span></li>
                <li>Create DNS CNAME record (proxied)</li>
                <li>Send onboarding email with credentials</li>
                <li>Notify #hubport-cloud on Slack</li>
              </ul>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn-secondary" onclick="hideModal('${modalId}')">Cancel</button>
              <form method="POST" action="/admin/tenant/${esc(tenant.id)}/approve" style="display:inline">
                <button type="submit" class="btn">Approve &amp; Provision</button>
              </form>
            </div>
          </div>
        </div>

        <!-- Reject Modal -->
        <div id="${rejectId}" class="modal-overlay" onclick="if(event.target===this)hideModal('${rejectId}')">
          <div class="modal">
            <div class="modal-header">
              <div class="modal-icon reject">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </div>
              <h3 class="text-lg font-semibold text-white">Reject ${esc(tenant.name)}</h3>
            </div>
            <form method="POST" action="/admin/tenant/${esc(tenant.id)}/reject">
              <div class="modal-body">
                <p>The tenant will be notified via email.</p>
                <label class="block text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 mt-4">Reason (optional)</label>
                <input name="reason" class="input" placeholder="e.g., Duplicate request, invalid congregation name">
              </div>
              <div class="modal-footer">
                <button type="button" class="btn-secondary" onclick="hideModal('${rejectId}')">Cancel</button>
                <button type="submit" class="btn btn-danger">Reject</button>
              </div>
            </form>
          </div>
        </div>
      ` : ''}
    </div>`;
}

export function tenantDetail(tenant: TenantLike & { tunnelId?: string | null; tunnelToken?: string | null; activatedAt?: Date | null }): string {
  const decommissionId = `decommission-${tenant.id.slice(0, 8)}`;
  const approveId = `approve-detail-${tenant.id.slice(0, 8)}`;
  const rejectId = `reject-detail-${tenant.id.slice(0, 8)}`;
  const decomm = isDecommissioned(tenant);

  return `
    <a href="/admin" class="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors mb-6">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      Back to Dashboard
    </a>

    <div class="flex items-center gap-4 mb-8">
      <div class="w-12 h-12 rounded-xl ${decomm ? 'bg-zinc-800' : 'bg-gradient-to-br from-[#d97706] to-[#b45309]'} flex items-center justify-center text-white text-xl font-bold ${decomm ? 'opacity-50' : ''}">${esc(tenant.name.charAt(0).toUpperCase())}</div>
      <div>
        <h1 class="text-2xl font-bold text-white ${decomm ? 'line-through opacity-60' : ''}">${esc(tenant.name)}</h1>
        <span class="text-sm text-zinc-500 font-mono">${esc(tenant.subdomain)}.hubport.cloud</span>
      </div>
      <div class="ml-auto">${statusBadge(tenant)}</div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
      <div class="card p-5">
        <div class="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2">Subdomain</div>
        <div class="font-mono text-[#f59e0b] text-lg ${decomm ? 'line-through opacity-40' : ''}">${esc(tenant.subdomain)}.hubport.cloud</div>
      </div>
      <div class="card p-5">
        <div class="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2">Contact Email</div>
        <div class="text-white">${esc(tenant.email)}</div>
      </div>
      <div class="card p-5">
        <div class="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2">Tenant ID</div>
        <div class="font-mono text-xs text-zinc-400 select-all">${esc(tenant.id)}</div>
      </div>
      <div class="card p-5">
        <div class="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2">Created</div>
        <div class="text-white">${new Date(tenant.createdAt).toISOString().slice(0, 16).replace('T', ' ')} <span class="text-zinc-500 text-sm">(${timeAgo(tenant.createdAt)})</span></div>
      </div>
      ${tenant.tunnelId ? `
        <div class="card p-5">
          <div class="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2">CF Tunnel</div>
          <div class="font-mono text-xs text-zinc-400 select-all">${esc(tenant.tunnelId)}</div>
        </div>
      ` : ''}
      ${tenant.activatedAt ? `
        <div class="card p-5">
          <div class="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2">Activated</div>
          <div class="text-[#4ade80]">${new Date(tenant.activatedAt).toISOString().slice(0, 16).replace('T', ' ')}</div>
        </div>
      ` : ''}
      ${decomm ? `
        <div class="card p-5 md:col-span-2 border-zinc-700/30">
          <div class="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2">Status</div>
          <div class="flex items-center gap-2 text-zinc-400">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M10 11v6M14 11v6"/></svg>
            Decommissioned — CF Tunnel and DNS record have been permanently deleted.
          </div>
        </div>
      ` : tenant.rejectReason ? `
        <div class="card p-5 md:col-span-2 border-[#ef4444]/20">
          <div class="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2">Rejection Reason</div>
          <div class="text-[#f87171]">${esc(tenant.rejectReason)}</div>
        </div>
      ` : ''}
    </div>

    ${tenant.status === 'PENDING' ? `
      <div class="card p-6 border-[#d97706]/20">
        <h3 class="text-sm font-semibold text-white mb-4">Actions</h3>
        <div class="flex flex-wrap gap-3">
          <button type="button" class="btn" onclick="showModal('${approveId}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>
            Approve &amp; Provision
          </button>
          <button type="button" class="btn btn-danger" onclick="showModal('${rejectId}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            Reject
          </button>
        </div>
      </div>

      <!-- Approve Modal -->
      <div id="${approveId}" class="modal-overlay" onclick="if(event.target===this)hideModal('${approveId}')">
        <div class="modal">
          <div class="modal-header">
            <div class="modal-icon approve">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>
            </div>
            <h3 class="text-lg font-semibold text-white">Approve &amp; Provision</h3>
          </div>
          <div class="modal-body">
            <p>Approve <strong class="text-white">${esc(tenant.name)}</strong> and provision infrastructure for <strong class="text-[#f59e0b]">${esc(tenant.subdomain)}.hubport.cloud</strong>:</p>
            <ul class="approve">
              <li>Create CF Tunnel <span class="font-mono text-xs text-zinc-500">(hubport-tenant-${esc(tenant.subdomain)})</span></li>
              <li>Create DNS CNAME record (proxied via Cloudflare)</li>
              <li>Send onboarding email with tunnel token + Docker setup instructions</li>
              <li>Notify #hubport-cloud on Slack</li>
            </ul>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-secondary" onclick="hideModal('${approveId}')">Cancel</button>
            <form method="POST" action="/admin/tenant/${esc(tenant.id)}/approve" style="display:inline">
              <button type="submit" class="btn">Approve &amp; Provision</button>
            </form>
          </div>
        </div>
      </div>

      <!-- Reject Modal -->
      <div id="${rejectId}" class="modal-overlay" onclick="if(event.target===this)hideModal('${rejectId}')">
        <div class="modal">
          <div class="modal-header">
            <div class="modal-icon reject">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </div>
            <h3 class="text-lg font-semibold text-white">Reject Registration</h3>
          </div>
          <form method="POST" action="/admin/tenant/${esc(tenant.id)}/reject">
            <div class="modal-body">
              <p>Reject <strong class="text-white">${esc(tenant.name)}</strong>. A rejection email will be sent to <strong class="text-zinc-300">${esc(tenant.email)}</strong>.</p>
              <label class="block text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 mt-4">Reason (optional)</label>
              <input name="reason" class="input" placeholder="e.g., Duplicate request, invalid congregation name">
            </div>
            <div class="modal-footer">
              <button type="button" class="btn-secondary" onclick="hideModal('${rejectId}')">Cancel</button>
              <button type="submit" class="btn btn-danger">Reject &amp; Notify</button>
            </div>
          </form>
        </div>
      </div>
    ` : ''}

    ${(tenant.status === 'APPROVED' || tenant.status === 'ACTIVE') ? `
      <div class="card p-6 border-[#ef4444]/10 mt-4">
        <h3 class="text-sm font-semibold text-white mb-2">Danger Zone</h3>
        <p class="text-xs text-zinc-500 mb-4">Decommissioning will permanently delete the CF Tunnel, DNS record, and revoke all access.</p>
        <button type="button" class="btn btn-danger" onclick="showModal('${decommissionId}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M10 11v6M14 11v6"/></svg>
          Decommission Tenant
        </button>
      </div>

      <!-- Decommission Modal -->
      <div id="${decommissionId}" class="modal-overlay" onclick="if(event.target===this)hideModal('${decommissionId}')">
        <div class="modal">
          <div class="modal-header">
            <div class="modal-icon danger">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
            </div>
            <h3 class="text-lg font-semibold text-white">Decommission Tenant</h3>
          </div>
          <div class="modal-body">
            <p class="text-[#f87171] font-medium">This action is permanent and cannot be undone.</p>
            <p class="mt-3">Decommissioning <strong class="text-white">${esc(tenant.name)}</strong> will:</p>
            <ul class="danger">
              <li>Delete CF Tunnel <span class="font-mono text-xs text-zinc-500">(hubport-tenant-${esc(tenant.subdomain)})</span></li>
              <li>Delete DNS record <span class="font-mono text-xs text-zinc-500">(${esc(tenant.subdomain)}.hubport.cloud)</span></li>
              <li>Revoke all network access — the tenant will be unreachable</li>
            </ul>
            <p class="text-zinc-500 text-xs mt-3">The tenant's local Docker stack will continue to run but will no longer be connected to hubport.cloud.</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-secondary" onclick="hideModal('${decommissionId}')">Cancel</button>
            <form method="POST" action="/admin/tenant/${esc(tenant.id)}/decommission" style="display:inline">
              <button type="submit" class="btn btn-danger">Decommission Permanently</button>
            </form>
          </div>
        </div>
      </div>
    ` : ''}
  `;
}
