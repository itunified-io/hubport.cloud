export function portalShell(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - hubport.cloud</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>tailwind.config = { theme: { extend: { colors: { amber: { 500: '#d97706', 600: '#b45309', 700: '#92400e' } } } } }</script>
</head>
<body class="bg-[#050507] text-zinc-200 min-h-screen">
  <nav class="border-b border-zinc-800 px-6 py-4">
    <div class="max-w-4xl mx-auto flex items-center justify-between">
      <a href="/portal/dashboard" class="text-xl font-bold text-amber-500">hubport.cloud</a>
      <span class="text-sm text-zinc-500">Tenant Portal</span>
    </div>
  </nav>
  <main class="max-w-4xl mx-auto px-6 py-8">
    ${content}
  </main>
  <footer class="border-t border-zinc-800 px-6 py-4 mt-12">
    <div class="max-w-4xl mx-auto text-center text-xs text-zinc-600">
      hubport.cloud - Self-hosted congregation management (MIT + Commons Clause)
    </div>
  </footer>
</body>
</html>`;
}

export function loginPage(error?: string): string {
  return `
    <div class="max-w-md mx-auto">
      <h2 class="text-2xl text-amber-500 mb-6 text-center">Log In</h2>
      ${error ? `<div class="bg-red-900/20 border border-red-700/30 rounded-lg p-3 mb-4 text-sm text-red-400">${error}</div>` : ''}
      <form method="POST" action="/portal/login" class="space-y-4">
        <div>
          <label class="block text-sm text-zinc-400 mb-1">Email</label>
          <input type="email" name="email" class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-zinc-200 focus:border-amber-500 focus:outline-none" required autofocus>
        </div>
        <div>
          <label class="block text-sm text-zinc-400 mb-1">Password</label>
          <input type="password" name="password" class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-zinc-200 focus:border-amber-500 focus:outline-none" required>
        </div>
        <button type="submit" class="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold py-3 rounded-lg transition">Log In</button>
      </form>
    </div>
  `;
}

export function setupPage(tenantName: string, token: string): string {
  return `
    <div class="max-w-md mx-auto">
      <h2 class="text-2xl text-amber-500 mb-2 text-center">Set Up Your Account</h2>
      <p class="text-zinc-400 text-center mb-6">Welcome, <strong class="text-zinc-200">${tenantName}</strong>. Create a password to access your tenant portal.</p>
      <form method="POST" action="/portal/setup" class="space-y-4">
        <input type="hidden" name="token" value="${token}">
        <div>
          <label class="block text-sm text-zinc-400 mb-1">Password (min 12 characters)</label>
          <input type="password" name="password" minlength="12" class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-zinc-200 focus:border-amber-500 focus:outline-none" required autofocus>
        </div>
        <div>
          <label class="block text-sm text-zinc-400 mb-1">Confirm Password</label>
          <input type="password" name="confirmPassword" minlength="12" class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-zinc-200 focus:border-amber-500 focus:outline-none" required>
        </div>
        <button type="submit" class="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold py-3 rounded-lg transition">Create Account</button>
      </form>
    </div>
  `;
}

export function dashboardPage(tenant: { id: string; name: string; subdomain: string; status: string; tunnelId: string | null; activatedAt: Date | null; createdAt: Date; auth?: { totpEnabled: boolean } | null }): string {
  const statusColor = tenant.status === 'ACTIVE' ? 'text-green-400' : tenant.status === 'APPROVED' ? 'text-amber-400' : 'text-zinc-400';
  return `
    <h2 class="text-2xl text-amber-500 mb-6">Dashboard</h2>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
      <div class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
        <h3 class="text-sm text-zinc-500 uppercase tracking-wider mb-3">Congregation</h3>
        <p class="text-xl text-zinc-200 font-semibold">${tenant.name}</p>
        <p class="text-sm text-zinc-400 mt-1">${tenant.subdomain}.hubport.cloud</p>
      </div>
      <div class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
        <h3 class="text-sm text-zinc-500 uppercase tracking-wider mb-3">Status</h3>
        <p class="text-xl font-semibold ${statusColor}">${tenant.status}</p>
        <p class="text-sm text-zinc-400 mt-1">Since ${tenant.createdAt.toISOString().split('T')[0]}</p>
      </div>
    </div>

    <div class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
      <h3 class="text-sm text-zinc-500 uppercase tracking-wider mb-3">Your Credentials</h3>
      <table class="w-full text-sm">
        <tr class="border-b border-zinc-800">
          <td class="py-3 text-zinc-400">Tenant ID</td>
          <td class="py-3 font-mono text-amber-400">${tenant.id}</td>
        </tr>
        <tr class="border-b border-zinc-800">
          <td class="py-3 text-zinc-400">Tunnel Token</td>
          <td class="py-3">
            <span id="token-hidden" class="text-zinc-600">Hidden for security</span>
            <span id="token-value" class="font-mono text-amber-400 text-xs break-all hidden"></span>
            <button id="reveal-btn" onclick="revealToken()" class="ml-2 text-xs bg-amber-600/20 border border-amber-600/40 text-amber-400 px-3 py-1 rounded hover:bg-amber-600/30 transition">Reveal</button>
          </td>
        </tr>
      </table>
    </div>

    <div class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
      <h3 class="text-sm text-zinc-500 uppercase tracking-wider mb-3">Quick Start</h3>
      <ol class="text-sm text-zinc-300 space-y-2 list-decimal list-inside">
        <li>Install <a href="https://docs.docker.com/get-docker/" class="text-amber-500 underline">Docker</a></li>
        <li>Create a <code class="bg-zinc-800 px-1 rounded">docker-compose.yml</code> with your credentials</li>
        <li>Run <code class="bg-zinc-800 px-1 rounded text-amber-400">docker compose up -d</code></li>
        <li>Open <code class="bg-zinc-800 px-1 rounded text-amber-400">http://localhost:8080</code> for the setup wizard</li>
      </ol>
    </div>

    <div class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm text-zinc-500 uppercase tracking-wider">docker-compose.yml</h3>
        <div class="flex gap-2">
          <!-- PG password managed by setup wizard via Vault -->
          <button onclick="copyYaml()" id="copy-btn" class="text-xs bg-amber-600/20 border border-amber-600/40 text-amber-400 px-3 py-1 rounded hover:bg-amber-600/30 transition">Copy</button>
        </div>
      </div>
      <div id="pg-password-warning" class="bg-red-900/20 border border-red-700/30 rounded-lg p-3 mb-3 hidden">
        <p class="text-xs text-red-400"><strong>Important:</strong> Save this password in a secure place now. It will not be stored or shown again. If you lose it, you will need to reset your database.</p>
      </div>
      <pre id="compose-yaml" class="bg-[#0a0a0c] p-4 rounded-lg text-xs text-zinc-300 overflow-x-auto select-all">services:
  hubport:
    image: ghcr.io/itunified-io/hubport.cloud:latest
    ports:
      - "3000:3000"
      - "8080:8080"
    environment:
      - HUBPORT_TENANT_ID=${tenant.id}
      - CF_TUNNEL_TOKEN=<span id="yaml-token" class="text-zinc-600">&lt;reveal credentials above&gt;</span>
    volumes:
      - hubport-data:/data
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=hubport
      - POSTGRES_USER=hubport
      - POSTGRES_PASSWORD=<span id="yaml-pgpass" class="text-zinc-500">managed-by-setup-wizard</span>
    volumes:
      - pg-data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  hubport-data:
  pg-data:</pre>
    </div>

    <div class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
      <h3 class="text-sm text-zinc-500 uppercase tracking-wider mb-3">Security</h3>
      <div class="flex items-center justify-between">
        <div>
          <p class="text-zinc-200 font-semibold">Two-Factor Authentication</p>
          <p class="text-sm text-zinc-400">${tenant.auth?.totpEnabled ? 'Enabled — your account is protected' : 'Not enabled — add an extra layer of security'}</p>
        </div>
        ${tenant.auth?.totpEnabled
          ? '<button type="button" onclick="disable2fa()" class="text-sm bg-red-600/20 border border-red-600/40 text-red-400 px-4 py-2 rounded-lg hover:bg-red-600/30 transition">Disable</button>'
          : '<a href="/portal/totp/enroll" class="text-sm bg-amber-600/20 border border-amber-600/40 text-amber-400 px-4 py-2 rounded-lg hover:bg-amber-600/30 transition">Enable 2FA</a>'
        }
      </div>
    </div>

    <!-- Disable 2FA modal -->
    <div id="disable-2fa-modal" class="fixed inset-0 bg-black/70 hidden items-center justify-center z-50">
      <div class="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-sm w-full mx-4">
        <h3 class="text-lg text-amber-500 mb-4">Disable Two-Factor Authentication</h3>
        <p class="text-sm text-zinc-400 mb-4">Enter your password to confirm disabling 2FA.</p>
        <input type="password" id="disable-2fa-password" class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-zinc-200 focus:border-amber-500 focus:outline-none mb-4" placeholder="Password">
        <div id="disable-2fa-error" class="text-sm text-red-400 mb-3 hidden"></div>
        <div class="flex gap-3">
          <button onclick="closeDisable2faModal()" class="flex-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 py-2 rounded-lg transition">Cancel</button>
          <button onclick="submitDisable2fa()" class="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg transition">Disable 2FA</button>
        </div>
      </div>
    </div>

    <script>
    function disable2fa() {
      document.getElementById('disable-2fa-modal').classList.remove('hidden');
      document.getElementById('disable-2fa-modal').classList.add('flex');
      document.getElementById('disable-2fa-password').focus();
    }
    function closeDisable2faModal() {
      document.getElementById('disable-2fa-modal').classList.add('hidden');
      document.getElementById('disable-2fa-modal').classList.remove('flex');
      document.getElementById('disable-2fa-password').value = '';
      document.getElementById('disable-2fa-error').classList.add('hidden');
    }
    async function submitDisable2fa() {
      const password = document.getElementById('disable-2fa-password').value;
      if (!password) return;
      try {
        const res = await fetch('/portal/totp/disable', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        if (!res.ok) {
          document.getElementById('disable-2fa-error').textContent = 'Invalid password';
          document.getElementById('disable-2fa-error').classList.remove('hidden');
          return;
        }
        window.location.href = '/portal/dashboard';
      } catch {
        document.getElementById('disable-2fa-error').textContent = 'Request failed';
        document.getElementById('disable-2fa-error').classList.remove('hidden');
      }
    }
    </script>

    <div class="mt-8 text-center">
      <form method="POST" action="/portal/logout">
        <button type="submit" class="text-sm text-zinc-500 hover:text-zinc-300 transition">Log Out</button>
      </form>
    </div>

    <!-- Reveal token modal -->
    <div id="reveal-modal" class="fixed inset-0 bg-black/70 hidden items-center justify-center z-50">
      <div class="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-sm w-full mx-4">
        <h3 class="text-lg text-amber-500 mb-4">Confirm Identity</h3>
        <p class="text-sm text-zinc-400 mb-4">Enter your password to reveal the tunnel token.</p>
        <input type="password" id="reveal-password" class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-zinc-200 focus:border-amber-500 focus:outline-none mb-4" placeholder="Password">
        <div id="reveal-error" class="text-sm text-red-400 mb-3 hidden"></div>
        <div class="flex gap-3">
          <button onclick="closeRevealModal()" class="flex-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 py-2 rounded-lg transition">Cancel</button>
          <button onclick="submitReveal()" class="flex-1 bg-amber-600 hover:bg-amber-700 text-white py-2 rounded-lg transition">Reveal</button>
        </div>
      </div>
    </div>

    <script>
    function revealToken() {
      document.getElementById('reveal-modal').classList.remove('hidden');
      document.getElementById('reveal-modal').classList.add('flex');
      document.getElementById('reveal-password').focus();
    }
    function closeRevealModal() {
      document.getElementById('reveal-modal').classList.add('hidden');
      document.getElementById('reveal-modal').classList.remove('flex');
      document.getElementById('reveal-password').value = '';
      document.getElementById('reveal-error').classList.add('hidden');
    }
    async function submitReveal() {
      const password = document.getElementById('reveal-password').value;
      if (!password) return;
      try {
        const res = await fetch('/portal/reveal-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        if (!res.ok) {
          document.getElementById('reveal-error').textContent = 'Invalid password';
          document.getElementById('reveal-error').classList.remove('hidden');
          return;
        }
        const data = await res.json();
        document.getElementById('token-hidden').classList.add('hidden');
        document.getElementById('token-value').textContent = data.tunnelToken;
        document.getElementById('token-value').classList.remove('hidden');
        document.getElementById('reveal-btn').classList.add('hidden');
        // Update docker-compose YAML with revealed token
        document.getElementById('yaml-token').textContent = data.tunnelToken;
        document.getElementById('yaml-token').classList.remove('text-zinc-600');
        document.getElementById('yaml-token').classList.add('text-amber-400');
        closeRevealModal();
      } catch {
        document.getElementById('reveal-error').textContent = 'Request failed';
        document.getElementById('reveal-error').classList.remove('hidden');
      }
    }
    // PG password managed by setup wizard via Vault — no manual generation needed
    function copyYaml() {
      const yaml = document.getElementById('compose-yaml').textContent;
      navigator.clipboard.writeText(yaml).then(() => {
        const btn = document.getElementById('copy-btn');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      });
    }
    </script>
  `;
}
