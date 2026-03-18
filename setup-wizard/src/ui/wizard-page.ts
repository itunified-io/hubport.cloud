import type { WizardStep, StepStatus, StepResult } from '../steps/types.js';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function shell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(title)} — Hubport Setup</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background: #050507; color: #e4e4e7; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 10px; }
    .amber { color: #d97706; }
    .btn { background: linear-gradient(135deg, #d97706, #b45309); color: #fff; padding: 8px 20px; border-radius: 7px; font-weight: 600; border: none; cursor: pointer; }
    .btn:hover { opacity: 0.9; }
    .btn-secondary { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: #e4e4e7; padding: 8px 20px; border-radius: 7px; cursor: pointer; }
    .input { background: #0a0a0f; border: 1px solid rgba(255,255,255,0.08); border-radius: 7px; padding: 8px 12px; color: #e4e4e7; width: 100%; }
    .input:focus { outline: none; border-color: #d97706; }
    .badge-done { background: rgba(34,197,94,0.1); color: #22c55e; border: 1px solid rgba(34,197,94,0.2); }
    .badge-pending { background: rgba(217,119,6,0.1); color: #d97706; border: 1px solid rgba(217,119,6,0.2); }
    .badge-optional { background: rgba(59,130,246,0.1); color: #3b82f6; border: 1px solid rgba(59,130,246,0.2); }
  </style>
</head>
<body class="min-h-screen">
  <nav class="border-b border-white/[.04] px-6 py-4">
    <a href="/" class="text-lg font-bold amber">Hubport Setup Wizard</a>
  </nav>
  <main class="max-w-3xl mx-auto px-6 py-12">${body}</main>
</body>
</html>`;
}

export function renderWizard(steps: WizardStep[], statuses: StepStatus[]): string {
  const stepsHtml = steps.map((step, i) => {
    const status = statuses[i]!;
    const badge = step.optional
      ? '<span class="badge-optional text-xs px-2 py-0.5 rounded">optional</span>'
      : status.completed
        ? '<span class="badge-done text-xs px-2 py-0.5 rounded">done</span>'
        : '<span class="badge-pending text-xs px-2 py-0.5 rounded">pending</span>';

    return `
      <a href="/step/${step.number}" class="card p-5 block hover:border-[#d97706]/30 transition-colors">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <span class="text-2xl font-bold amber opacity-40">${step.number}</span>
            <div>
              <h3 class="font-semibold">${escape(step.title)}</h3>
              <p class="text-sm text-zinc-400">${escape(step.description).slice(0, 80)}...</p>
            </div>
          </div>
          ${badge}
        </div>
      </a>`;
  }).join('\n');

  const completed = statuses.filter((s) => s.completed).length;

  return shell('Overview', `
    <h1 class="text-3xl font-bold mb-2">Setup Wizard</h1>
    <p class="text-zinc-400 mb-8">Complete each step to get your congregation platform running. Progress: ${completed}/${steps.length}</p>
    <div class="space-y-3">${stepsHtml}</div>
  `);
}

export function renderStep(step: WizardStep, num: number, status: StepStatus, result?: StepResult): string {
  const alert = result
    ? `<div class="card p-4 mb-6 ${result.success ? 'border-[#22c55e]/30' : 'border-[#ef4444]/30'}">
        <p class="${result.success ? 'text-[#22c55e]' : 'text-[#ef4444]'} font-medium">${escape(result.message)}</p>
        ${result.credentials ? `<div class="mt-3 space-y-1">${Object.entries(result.credentials).map(([k, v]) => `<div class="flex gap-2 text-sm"><span class="text-zinc-400">${escape(k)}:</span> <code class="amber font-mono">${escape(v)}</code></div>`).join('')}</div>` : ''}
        ${result.warnings ? `<ul class="mt-3 space-y-1 text-sm text-yellow-400">${result.warnings.map((w) => `<li>⚠ ${escape(w)}</li>`).join('')}</ul>` : ''}
      </div>`
    : '';

  const statusBadge = status.completed
    ? '<span class="badge-done text-xs px-2 py-0.5 rounded">completed</span>'
    : '<span class="badge-pending text-xs px-2 py-0.5 rounded">pending</span>';

  return shell(step.title, `
    <a href="/" class="text-sm text-zinc-400 hover:text-zinc-200 mb-4 inline-block">&larr; Back to overview</a>
    <div class="flex items-center gap-3 mb-2">
      <h1 class="text-3xl font-bold">Step ${num}: ${escape(step.title)}</h1>
      ${statusBadge}
    </div>
    <p class="text-zinc-400 mb-6">${escape(step.description)}</p>
    ${alert}
    <form method="POST" action="/step/${num}">
      ${step.id === 'tenant-register' ? '<div class="mb-4"><label class="block text-sm font-medium mb-1">Tenant ID</label><input name="tenantId" class="input" placeholder="from signup email"></div>' : ''}
      ${step.id === 'admin-user' ? `
        <div class="space-y-4 mb-6">
          <div><label class="block text-sm font-medium mb-1">Username</label><input name="username" class="input" required></div>
          <div><label class="block text-sm font-medium mb-1">Email</label><input name="email" type="email" class="input" required></div>
          <div><label class="block text-sm font-medium mb-1">First Name</label><input name="firstName" class="input"></div>
          <div><label class="block text-sm font-medium mb-1">Last Name</label><input name="lastName" class="input"></div>
          <div><label class="block text-sm font-medium mb-1">Password</label><input name="password" type="password" class="input" required></div>
        </div>` : ''}
      ${step.optional ? '<div class="mb-4"><label class="flex items-center gap-2"><input type="checkbox" name="skip" value="true"> Skip this step</label></div>' : ''}
      <div class="flex gap-3">
        <button type="submit" class="btn">${status.completed ? 'Re-run' : 'Execute'} Step ${num}</button>
        ${num < 7 ? `<a href="/step/${num + 1}" class="btn-secondary inline-block text-center">Next &rarr;</a>` : ''}
      </div>
    </form>
  `);
}
