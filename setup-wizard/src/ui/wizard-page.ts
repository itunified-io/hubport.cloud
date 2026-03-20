import type { WizardStep, StepStatus, StepResult, VaultCredentialStop } from '../steps/types.js';

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

export function renderWizard(steps: WizardStep[], statuses: StepStatus[], autoAdvance?: boolean): string {
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
    ${autoAdvance ? '<div class="card p-4 mb-6 border-[#22c55e]/30"><p class="text-[#22c55e] font-medium">Environment check passed — start with Step 2.</p></div>' : ''}
    <div class="space-y-3">${stepsHtml}</div>
  `);
}

export function renderStep(step: WizardStep, num: number, status: StepStatus, totalSteps?: number, result?: StepResult): string {
  // If the result contains a hardStop, render the credential confirmation page instead
  if (result?.hardStop) {
    return renderVaultCredentials(step, num, result.hardStop);
  }

  const encKeyBlock = result?.encryptionKeyDownload ? `
    <div class="card p-4 mb-6 border-[#d97706]/30">
      <h3 class="text-[#d97706] font-bold mb-2">Encryption Key Generated</h3>
      <p class="text-sm text-zinc-400 mb-3">This key encrypts all personal data (names, emails, phone numbers). If lost, encrypted data <strong class="text-red-400">cannot be recovered</strong>.</p>
      <div class="bg-[#0a0a0c] p-3 rounded mb-3">
        <span id="enc-key-hidden" class="text-zinc-500 text-sm">Key hidden for security</span>
        <code id="enc-key-value" class="text-[#f59e0b] text-xs break-all hidden">${escape(result.encryptionKeyDownload.key)}</code>
        <button onclick="document.getElementById('enc-key-hidden').classList.toggle('hidden');document.getElementById('enc-key-value').classList.toggle('hidden')" class="ml-2 text-xs text-[#d97706] underline">Show/Hide</button>
      </div>
      <button onclick="downloadEncKey()" class="bg-[#d97706] hover:bg-[#b45309] text-white text-sm font-semibold px-4 py-2 rounded transition mr-2">Download Encryption Key</button>
      <div class="mt-3">
        <label class="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
          <input type="checkbox" id="enc-confirm" onchange="document.getElementById('enc-continue').disabled = !this.checked" class="rounded">
          I confirm I have securely stored the encryption key
        </label>
      </div>
      <a id="enc-continue" href="/step/${num + 1}" class="inline-block mt-3 bg-zinc-700 text-zinc-300 text-sm font-semibold px-6 py-2 rounded transition pointer-events-none opacity-50">Continue to Step ${num + 1}</a>
      <script>
      function downloadEncKey() {
        const data = JSON.stringify({
          encryptionKey: ${JSON.stringify(result.encryptionKeyDownload.key)},
          generatedAt: ${JSON.stringify(result.encryptionKeyDownload.generatedAt)},
          warning: "This key encrypts personal data. If lost, encrypted data cannot be recovered. Store in a password manager."
        }, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'hubport-encryption-key.json'; a.click();
        URL.revokeObjectURL(url);
      }
      document.getElementById('enc-confirm').addEventListener('change', function() {
        const btn = document.getElementById('enc-continue');
        if (this.checked) { btn.classList.remove('pointer-events-none', 'opacity-50'); btn.classList.add('hover:bg-zinc-600'); }
        else { btn.classList.add('pointer-events-none', 'opacity-50'); btn.classList.remove('hover:bg-zinc-600'); }
      });
      </script>
    </div>` : '';

  const alert = result
    ? `<div class="card p-4 mb-6 ${result.success ? 'border-[#22c55e]/30' : 'border-[#ef4444]/30'}">
        <p class="${result.success ? 'text-[#22c55e]' : 'text-[#ef4444]'} font-medium">${escape(result.message)}</p>
        ${result.credentials ? `<div class="mt-3 space-y-1">${Object.entries(result.credentials).map(([k, v]) => `<div class="flex gap-2 text-sm"><span class="text-zinc-400">${escape(k)}:</span> <code class="amber font-mono">${escape(v)}</code></div>`).join('')}</div>` : ''}
        ${result.warnings ? `<ul class="mt-3 space-y-1 text-sm text-yellow-400">${result.warnings.map((w) => `<li>⚠ ${escape(w)}</li>`).join('')}</ul>` : ''}
      </div>${encKeyBlock}`
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
        ${num < (totalSteps ?? 6) ? `<a href="/step/${num + 1}" class="btn-secondary inline-block text-center">Next &rarr;</a>` : ''}
      </div>
    </form>
  `);
}

/**
 * Renders the hard-stop Vault credential confirmation page.
 * The user must download credentials and confirm storage before continuing.
 */
function renderVaultCredentials(step: WizardStep, num: number, creds: VaultCredentialStop): string {
  const downloadPayload = JSON.stringify({
    unsealKey: creds.unsealKey,
    rootToken: creds.rootToken,
    generatedAt: creds.generatedAt,
    warning: 'Store securely. Unseal key is required to unlock Vault after restart. Root token grants full Vault access.',
  });

  return shell(step.title, `
    <a href="/" class="text-sm text-zinc-400 hover:text-zinc-200 mb-4 inline-block">&larr; Back to overview</a>
    <div class="flex items-center gap-3 mb-2">
      <h1 class="text-3xl font-bold">Step ${num}: ${escape(step.title)}</h1>
      <span class="badge-pending text-xs px-2 py-0.5 rounded">action required</span>
    </div>

    <!-- Warnings -->
    <div class="card p-5 mb-6 border-[#ef4444]/40" style="background: rgba(239,68,68,0.05);">
      <div class="space-y-3">
        <p class="text-[#ef4444] font-bold text-lg">CRITICAL: Save Your Vault Credentials</p>
        <ul class="space-y-2 text-[#ef4444]">
          <li class="flex items-start gap-2">
            <span class="mt-0.5 shrink-0">&#x26D4;</span>
            <span class="font-semibold">These credentials are shown ONCE and cannot be recovered.</span>
          </li>
          <li class="flex items-start gap-2">
            <span class="mt-0.5 shrink-0">&#x26D4;</span>
            <span class="font-semibold">If you lose the unseal key, your encrypted data is PERMANENTLY LOST after a Vault restart.</span>
          </li>
          <li class="flex items-start gap-2">
            <span class="mt-0.5 shrink-0">&#x1F512;</span>
            <span>Store these in a password manager (1Password, Bitwarden, KeePass).</span>
          </li>
        </ul>
      </div>
    </div>

    <!-- Credentials -->
    <div class="card p-5 mb-6">
      <h3 class="font-semibold mb-4 amber">Vault Credentials</h3>

      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-zinc-400 mb-1">Unseal Key</label>
          <div class="flex items-center gap-2">
            <code id="unseal-display" class="input font-mono text-sm flex-1 select-all" style="user-select: all;">
              ${'*'.repeat(40)}
            </code>
            <button type="button" onclick="toggleUnseal()" class="btn-secondary text-sm px-3 py-2" id="unseal-toggle">Show</button>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-zinc-400 mb-1">Root Token</label>
          <div class="flex items-center gap-2">
            <code id="token-display" class="input font-mono text-sm flex-1 select-all" style="user-select: all;">
              ${'*'.repeat(40)}
            </code>
            <button type="button" onclick="toggleToken()" class="btn-secondary text-sm px-3 py-2" id="token-toggle">Show</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Download -->
    <div class="mb-6">
      <button type="button" onclick="downloadCredentials()" class="btn flex items-center gap-2">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
        Download Credentials
      </button>
      <p class="text-xs text-zinc-500 mt-1">Saves a JSON file with both keys — store it in your password manager.</p>
    </div>

    <!-- Confirmation form -->
    <form method="POST" action="/step/${num}/confirm">
      <input type="hidden" name="unsealKey" value="${escape(creds.unsealKey)}">
      <input type="hidden" name="rootToken" value="${escape(creds.rootToken)}">

      <div class="card p-4 mb-6">
        <label class="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" id="confirm-checkbox" onchange="toggleContinue()" class="w-5 h-5 accent-amber-600">
          <span class="font-medium">I confirm I have downloaded and securely stored these credentials</span>
        </label>
      </div>

      <div class="flex gap-3">
        <button type="submit" id="continue-btn" class="btn opacity-40 cursor-not-allowed" disabled>
          Continue &rarr;
        </button>
      </div>
    </form>

    <script>
      const unsealKey = ${JSON.stringify(creds.unsealKey)};
      const rootToken = ${JSON.stringify(creds.rootToken)};
      let unsealVisible = false;
      let tokenVisible = false;

      function toggleUnseal() {
        unsealVisible = !unsealVisible;
        document.getElementById('unseal-display').textContent = unsealVisible ? unsealKey : '${'*'.repeat(40)}';
        document.getElementById('unseal-toggle').textContent = unsealVisible ? 'Hide' : 'Show';
      }

      function toggleToken() {
        tokenVisible = !tokenVisible;
        document.getElementById('token-display').textContent = tokenVisible ? rootToken : '${'*'.repeat(40)}';
        document.getElementById('token-toggle').textContent = tokenVisible ? 'Hide' : 'Show';
      }

      function downloadCredentials() {
        const payload = ${downloadPayload};
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'vault-credentials.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      function toggleContinue() {
        const checked = document.getElementById('confirm-checkbox').checked;
        const btn = document.getElementById('continue-btn');
        if (checked) {
          btn.disabled = false;
          btn.classList.remove('opacity-40', 'cursor-not-allowed');
        } else {
          btn.disabled = true;
          btn.classList.add('opacity-40', 'cursor-not-allowed');
        }
      }
    </script>
  `);
}
