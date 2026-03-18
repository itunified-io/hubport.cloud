/**
 * Admin portal UI components — server-rendered HTML with dark/amber theme.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function shell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} — Hubport Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background: #050507; color: #e4e4e7; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 10px; }
    .btn { background: linear-gradient(135deg, #d97706, #b45309); color: #fff; padding: 6px 16px; border-radius: 7px; font-weight: 600; border: none; cursor: pointer; font-size: 14px; }
    .btn:hover { opacity: 0.9; }
    .btn-danger { background: linear-gradient(135deg, #ef4444, #dc2626); }
    .btn-secondary { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: #e4e4e7; padding: 6px 16px; border-radius: 7px; cursor: pointer; font-size: 14px; }
    .input { background: #0a0a0f; border: 1px solid rgba(255,255,255,0.08); border-radius: 7px; padding: 6px 12px; color: #e4e4e7; width: 100%; font-size: 14px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 5px; font-size: 12px; font-weight: 600; }
    .badge-pending { background: rgba(217,119,6,0.15); color: #f59e0b; border: 1px solid rgba(217,119,6,0.3); }
    .badge-approved { background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); }
    .badge-active { background: rgba(34,197,94,0.15); color: #4ade80; border: 1px solid rgba(34,197,94,0.3); }
    .badge-rejected { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); }
  </style>
</head>
<body class="min-h-screen">
  <nav class="border-b border-white/[.04] px-6 py-3 flex items-center justify-between">
    <a href="/admin" class="text-lg font-bold text-[#d97706]">Hubport Admin</a>
    <span class="text-sm text-zinc-500">Platform Administration</span>
  </nav>
  <main class="max-w-5xl mx-auto px-6 py-8">${body}</main>
</body>
</html>`;
}

export function statsCard(label: string, count: number, color: string): string {
  return `
    <div class="card p-5 text-center">
      <div class="text-3xl font-bold" style="color: ${color}">${count}</div>
      <div class="text-sm text-zinc-400 mt-1">${esc(label)}</div>
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

function statusBadge(status: string): string {
  const cls = status === 'PENDING' ? 'badge-pending'
    : status === 'APPROVED' ? 'badge-approved'
    : status === 'ACTIVE' ? 'badge-active'
    : 'badge-rejected';
  return `<span class="badge ${cls}">${esc(status)}</span>`;
}

function timeAgo(date: Date): string {
  const d = date instanceof Date ? date : new Date(date);
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function tenantRow(tenant: TenantLike, showActions: boolean): string {
  return `
    <div class="card p-4 flex items-center justify-between gap-4">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1">
          <a href="/admin/tenant/${esc(tenant.id)}" class="font-semibold text-[#d97706] hover:underline truncate">${esc(tenant.name)}</a>
          ${statusBadge(tenant.status)}
        </div>
        <div class="text-sm text-zinc-400 truncate">
          ${esc(tenant.subdomain)}.hubport.cloud · ${esc(tenant.email)} · ${timeAgo(tenant.createdAt)}
        </div>
      </div>
      ${showActions ? `
        <div class="flex gap-2 shrink-0">
          <form method="POST" action="/admin/tenant/${esc(tenant.id)}/approve" style="display:inline">
            <button type="submit" class="btn" onclick="return confirm('Approve ${esc(tenant.name)}?')">Approve</button>
          </form>
          <form method="POST" action="/admin/tenant/${esc(tenant.id)}/reject" style="display:inline">
            <button type="submit" class="btn-danger btn" onclick="return confirm('Reject ${esc(tenant.name)}?')">Reject</button>
          </form>
        </div>
      ` : ''}
    </div>`;
}

export function tenantDetail(tenant: TenantLike & { tunnelId?: string | null; tunnelToken?: string | null; activatedAt?: Date | null }): string {
  return `
    <a href="/admin" class="text-sm text-zinc-400 hover:text-zinc-200 mb-4 inline-block">&larr; Back</a>
    <div class="flex items-center gap-3 mb-6">
      <h1 class="text-2xl font-bold">${esc(tenant.name)}</h1>
      ${statusBadge(tenant.status)}
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      <div class="card p-4">
        <div class="text-sm text-zinc-400 mb-1">Subdomain</div>
        <div class="font-mono text-[#f59e0b]">${esc(tenant.subdomain)}.hubport.cloud</div>
      </div>
      <div class="card p-4">
        <div class="text-sm text-zinc-400 mb-1">Email</div>
        <div>${esc(tenant.email)}</div>
      </div>
      <div class="card p-4">
        <div class="text-sm text-zinc-400 mb-1">Tenant ID</div>
        <div class="font-mono text-xs">${esc(tenant.id)}</div>
      </div>
      <div class="card p-4">
        <div class="text-sm text-zinc-400 mb-1">Created</div>
        <div>${new Date(tenant.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</div>
      </div>
      ${tenant.tunnelId ? `
        <div class="card p-4">
          <div class="text-sm text-zinc-400 mb-1">Tunnel ID</div>
          <div class="font-mono text-xs">${esc(tenant.tunnelId)}</div>
        </div>
      ` : ''}
      ${tenant.activatedAt ? `
        <div class="card p-4">
          <div class="text-sm text-zinc-400 mb-1">Activated</div>
          <div>${new Date(tenant.activatedAt).toISOString().slice(0, 16).replace('T', ' ')}</div>
        </div>
      ` : ''}
      ${tenant.rejectReason ? `
        <div class="card p-4 md:col-span-2">
          <div class="text-sm text-zinc-400 mb-1">Rejection Reason</div>
          <div class="text-[#f87171]">${esc(tenant.rejectReason)}</div>
        </div>
      ` : ''}
    </div>

    ${tenant.status === 'PENDING' ? `
      <div class="flex gap-3">
        <form method="POST" action="/admin/tenant/${esc(tenant.id)}/approve">
          <button type="submit" class="btn" onclick="return confirm('Approve and provision ${esc(tenant.name)}?\\n\\nThis will:\\n1. Create CF Tunnel\\n2. Create DNS record\\n3. Send onboarding email')">Approve &amp; Provision</button>
        </form>
        <form method="POST" action="/admin/tenant/${esc(tenant.id)}/reject" class="flex gap-2">
          <input name="reason" class="input" placeholder="Rejection reason (optional)" style="max-width: 300px">
          <button type="submit" class="btn btn-danger" onclick="return confirm('Reject ${esc(tenant.name)}?')">Reject</button>
        </form>
      </div>
    ` : ''}
  `;
}
