/** Escape HTML special characters to prevent XSS in server-rendered templates. */
export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Derive installer URL from PORTAL_BASE_URL so curl command is env-aware. */
function installerUrl(): string {
  const portalBase = process.env.PORTAL_BASE_URL || '';
  // portal-uat.hubport.cloud → get-uat.hubport.cloud
  const m = portalBase.match(/^https:\/\/portal(-\w+)?\.hubport\.cloud$/);
  if (m) return `https://get${m[1] || ''}.hubport.cloud`;
  return 'https://get.hubport.cloud';
}

/** Derive landing page URL from PORTAL_BASE_URL so links are env-aware. */
function landingUrl(): string {
  const portalBase = process.env.PORTAL_BASE_URL || '';
  // portal-uat.hubport.cloud → uat.hubport.cloud
  const m = portalBase.match(/^https:\/\/portal(-\w+)?\.hubport\.cloud$/);
  if (m && m[1]) return `https://${m[1].slice(1)}.hubport.cloud`;
  return 'https://hubport.cloud';
}

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
      <div class="flex items-center gap-4">
        <a href="/portal/dashboard" class="text-sm text-zinc-400 hover:text-zinc-200 transition">Dashboard</a>
        <a href="/portal/docs" class="text-sm text-zinc-400 hover:text-zinc-200 transition">Docs</a>
      </div>
    </div>
  </nav>
  <main class="max-w-4xl mx-auto px-6 py-8">
    ${content}
  </main>
  <footer class="border-t border-zinc-800 px-6 py-4 mt-12">
    <div class="max-w-4xl mx-auto flex flex-col items-center gap-2 text-xs text-zinc-600">
      <div class="flex items-center gap-3">
        <a href="https://github.com/itunified-io/hubport.cloud/actions/workflows/codeql.yml" target="_blank" rel="noopener"><img src="https://github.com/itunified-io/hubport.cloud/actions/workflows/codeql.yml/badge.svg" alt="CodeQL" height="16"></a>
        <a href="https://snyk.io/test/github/itunified-io/hubport.cloud" target="_blank" rel="noopener"><img src="https://snyk.io/test/github/itunified-io/hubport.cloud/badge.svg" alt="Snyk" height="16"></a>
      </div>
      <span>hubport.cloud - Self-hosted congregation management (MIT + Commons Clause)</span>
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

export function passkeyFirstLoginPage(error?: string): string {
  return `
    <div class="max-w-md mx-auto">
      <h2 class="text-2xl text-amber-500 mb-6 text-center">Sign In</h2>
      ${error ? `<div class="bg-red-900/20 border border-red-700/30 rounded-lg p-3 mb-4 text-sm text-red-400">${escapeHtml(error)}</div>` : ''}
      <div id="passkey-error" class="bg-red-900/20 border border-red-700/30 rounded-lg p-3 mb-4 text-sm text-red-400 hidden"></div>

      <div id="passkey-section" class="mb-6">
        <button id="passkey-btn" onclick="loginWithPasskeyDirect()" class="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold py-3 rounded-lg transition flex items-center justify-center gap-2">
          <span class="text-xl">&#128274;</span> Sign in with Passkey
        </button>
      </div>

      <div class="flex items-center gap-3 mb-6">
        <div class="flex-1 h-px bg-zinc-700"></div>
        <span class="text-xs text-zinc-500 uppercase tracking-wider">or use email &amp; password</span>
        <div class="flex-1 h-px bg-zinc-700"></div>
      </div>

      <form method="POST" action="/portal/login" class="space-y-4">
        <div>
          <label class="block text-sm text-zinc-400 mb-1">Email</label>
          <input type="email" name="email" class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-zinc-200 focus:border-amber-500 focus:outline-none" placeholder="you@example.com" required>
        </div>
        <div>
          <label class="block text-sm text-zinc-400 mb-1">Password</label>
          <input type="password" name="password" class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-zinc-200 focus:border-amber-500 focus:outline-none" required>
        </div>
        <button type="submit" class="w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-white font-semibold py-3 rounded-lg transition">Log In</button>
      </form>

      <p class="text-center mt-4">
        <a href="/portal/setup" class="text-sm text-zinc-500 hover:text-zinc-300">First time? Set up your account</a>
      </p>
    </div>

    <script>
    if (!window.PublicKeyCredential || !navigator.credentials) {
      var ps = document.getElementById('passkey-section');
      if (ps) ps.style.display = 'none';
    }

    async function loginWithPasskeyDirect() {
      var btn = document.getElementById('passkey-btn');
      var errEl = document.getElementById('passkey-error');
      errEl.classList.add('hidden');
      btn.disabled = true;
      btn.textContent = 'Waiting for passkey...';
      try {
        var optRes = await fetch('/portal/passkey/auth-options-discoverable');
        if (!optRes.ok) throw new Error('Passkey not available');
        var options = await optRes.json();
        var sessionId = options.sessionId;
        options.challenge = _b64ToBuf(options.challenge);
        if (options.allowCredentials) {
          options.allowCredentials = options.allowCredentials.map(function(c) {
            return Object.assign({}, c, {id: _b64ToBuf(c.id)});
          });
        }
        var assertion = await navigator.credentials.get({ publicKey: options });
        if (!assertion) throw new Error('No credential returned');
        var verifyRes = await fetch('/portal/passkey/auth-verify-discoverable', {
          method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'same-origin',
          body: JSON.stringify({
            id: assertion.id, rawId: _bufToB64(assertion.rawId), sessionId: sessionId,
            response: {
              clientDataJSON: _bufToB64(assertion.response.clientDataJSON),
              authenticatorData: _bufToB64(assertion.response.authenticatorData),
              signature: _bufToB64(assertion.response.signature),
              userHandle: assertion.response.userHandle ? _bufToB64(assertion.response.userHandle) : null
            },
            type: assertion.type,
            clientExtensionResults: assertion.getClientExtensionResults(),
          }),
        });
        if (verifyRes.ok) {
          var data = await verifyRes.json();
          window.location.href = data.redirect || '/portal/dashboard';
        } else {
          var err = await verifyRes.json();
          throw new Error(err.error || 'Verification failed');
        }
      } catch (e) {
        var msg = e.message === 'Passkey not available'
          ? 'No passkeys registered yet. Use email & password below.'
          : 'Passkey failed: ' + e.message;
        errEl.textContent = msg;
        errEl.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Sign in with Passkey';
      }
    }

    function _b64ToBuf(b) {
      var s = b.replace(/-/g,'+').replace(/_/g,'/');
      var p = s.length % 4 === 0 ? '' : '='.repeat(4 - s.length % 4);
      return Uint8Array.from(atob(s+p), function(c){return c.charCodeAt(0)}).buffer;
    }
    function _bufToB64(buf) {
      var bytes = new Uint8Array(buf); var s = '';
      for (var i=0;i<bytes.length;i++) s += String.fromCharCode(bytes[i]);
      return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
    }
    </script>
  `;
}

export function setupCodeSection(tenantStatus: string): string {
  if (tenantStatus !== 'APPROVED' && tenantStatus !== 'ACTIVE') return '';
  return `
    <div class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
      <h3 class="text-lg text-amber-500 mb-4">Deploy Your Hub</h3>

      <div class="text-sm text-zinc-400 mb-4">
        <p class="mb-2"><strong>Server Requirements:</strong></p>
        <ul class="list-disc list-inside space-y-1 text-zinc-500">
          <li>1 vCPU, 4 GB RAM, 20 GB disk minimum</li>
          <li>Ubuntu 22.04+ / Debian 12+ (any Docker-compatible OS)</li>
          <li>Internet access (for Cloudflare Tunnel)</li>
        </ul>
      </div>

      <div class="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 mb-4">
        <p class="text-sm text-zinc-400 mb-3">Need a server? hubport.cloud runs on any hardware with Docker &mdash; including a Synology NAS, Raspberry Pi, or your own PC.</p>
        <p class="text-sm text-zinc-400 mb-3">If you need a VPS, these Hostinger plans work well:</p>
        <div class="space-y-2">
          <div class="flex items-center justify-between bg-zinc-900/50 rounded-lg p-3 border border-zinc-700">
            <div>
              <span class="text-amber-400 font-semibold">KVM1</span>
              <span class="text-zinc-500 text-sm ml-2">1 vCPU &middot; 4 GB &middot; 50 GB SSD</span>
            </div>
            <a href="https://www.hostinger.com/cart?product=vps%3Avps_kvm_1&period=24&referral_type=cart_link&REFERRALCODE=NSGBUECHEBQR&referral_id=019d04a9-d6f7-725d-a226-c08ca5d70b0b" target="_blank" rel="noopener" class="text-amber-500 text-sm font-semibold hover:underline">~$5/mo &rarr;</a>
          </div>
          <div class="flex items-center justify-between bg-zinc-900/50 rounded-lg p-3 border border-zinc-700">
            <div>
              <span class="text-amber-400 font-semibold">KVM2</span>
              <span class="text-zinc-500 text-sm ml-2">2 vCPU &middot; 8 GB &middot; 100 GB SSD</span>
            </div>
            <a href="https://www.hostinger.com/cart?product=vps%3Avps_kvm_2&period=24&referral_type=cart_link&REFERRALCODE=NSGBUECHEBQR&referral_id=019d04a9-baed-70fa-b7da-b1d81e15c69a" target="_blank" rel="noopener" class="text-amber-500 text-sm font-semibold hover:underline">~$10/mo &rarr;</a>
          </div>
        </div>
        <p class="text-zinc-600 text-[11px] mt-3 italic">* Affiliate links &mdash; using them supports the hubport.cloud project at no extra cost to you.</p>
        <p class="text-zinc-500 text-xs mt-2"><a href="${landingUrl()}/en/faq" target="_blank" rel="noopener" class="text-amber-500 hover:underline">Read our FAQ</a> for setup help and more details.</p>
      </div>

      <div id="setup-code-generate">
        <button onclick="generateSetupCode()" class="bg-amber-600 hover:bg-amber-700 text-white font-semibold py-3 px-6 rounded-lg transition">
          Generate Setup Code
        </button>
      </div>

      <div id="setup-code-display" class="hidden">
        <div class="bg-zinc-800 border border-zinc-700 rounded-lg p-4 mb-4 text-center">
          <p class="text-xs text-zinc-500 mb-2">Your Setup Code</p>
          <p id="setup-code-value" class="text-3xl font-mono text-amber-400 tracking-widest mb-2"></p>
          <p id="setup-code-expiry" class="text-xs text-zinc-500"></p>
        </div>
        <div class="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 mb-4">
          <p class="text-xs text-zinc-500 mb-2">Run on your server:</p>
          <div class="mb-2">
            <span class="text-[10px] text-zinc-600 uppercase tracking-wider">Linux / macOS</span>
            <div class="flex items-center gap-2 mt-1">
              <code id="setup-code-curl" class="flex-1 text-sm text-amber-400 select-all">curl -fsSL ${installerUrl()} | sh</code>
              <button onclick="copyCred(document.getElementById('setup-code-curl').textContent, event)" class="p-1 text-zinc-500 hover:text-amber-400 transition flex-shrink-0" title="Copy"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
            </div>
          </div>
          <div>
            <span class="text-[10px] text-zinc-600 uppercase tracking-wider">Windows (PowerShell)</span>
            <div class="flex items-center gap-2 mt-1">
              <code id="setup-code-ps" class="flex-1 text-sm text-amber-400 select-all">irm ${installerUrl()}/windows | iex</code>
              <button onclick="copyCred(document.getElementById('setup-code-ps').textContent, event)" class="p-1 text-zinc-500 hover:text-amber-400 transition flex-shrink-0" title="Copy"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
            </div>
          </div>
        </div>
        <button onclick="generateSetupCode()" class="text-sm text-zinc-500 hover:text-zinc-300 underline">
          Regenerate Code (invalidates previous)
        </button>
      </div>

      <div id="setup-code-error" class="hidden text-sm text-red-400 mt-2"></div>
    </div>

    <script>
    var _setupCodeInterval;
    async function generateSetupCode() {
      var errEl = document.getElementById('setup-code-error');
      errEl.classList.add('hidden');
      try {
        var res = await fetch('/portal/setup-code/generate', {
          method: 'POST', credentials: 'same-origin'
        });
        if (!res.ok) { var e = await res.json(); throw new Error(e.error || 'Failed'); }
        var data = await res.json();
        document.getElementById('setup-code-value').textContent = data.code;
        document.getElementById('setup-code-curl').textContent = 'curl -fsSL ${installerUrl()} | sh -s -- ' + data.code;
        document.getElementById('setup-code-ps').textContent = 'irm ${installerUrl()}/windows | iex; # then enter: ' + data.code;
        var exp = new Date(data.expiresAt);
        document.getElementById('setup-code-generate').classList.add('hidden');
        document.getElementById('setup-code-display').classList.remove('hidden');
        if (_setupCodeInterval) clearInterval(_setupCodeInterval);
        _setupCodeInterval = setInterval(function() {
          var remaining = Math.max(0, Math.floor((exp - Date.now()) / 1000));
          if (remaining <= 0) {
            clearInterval(_setupCodeInterval);
            document.getElementById('setup-code-expiry').textContent = 'Expired. Click Regenerate.';
            return;
          }
          var min = Math.floor(remaining / 60);
          var sec = remaining % 60;
          document.getElementById('setup-code-expiry').textContent =
            'Expires in ' + min + ':' + (sec < 10 ? '0' : '') + sec;
        }, 1000);
      } catch (e) {
        errEl.textContent = e.message;
        errEl.classList.remove('hidden');
      }
    }
    </script>
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

export function dashboardPage(tenant: { id: string; name: string; subdomain: string; status: string; tunnelId: string | null; activatedAt: Date | null; createdAt: Date; auth?: { totpEnabled: boolean } | null }, apiToken?: string | null): string {
  const statusColor = tenant.status === 'ACTIVE' ? 'text-green-400' : tenant.status === 'APPROVED' ? 'text-amber-400' : 'text-zinc-400';
  return `
    <h2 class="text-2xl text-amber-500 mb-6">Dashboard</h2>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
      <div class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
        <h3 class="text-sm text-zinc-500 uppercase tracking-wider mb-3">Congregation</h3>
        <p class="text-xl text-zinc-200 font-semibold">${escapeHtml(tenant.name)}</p>
        <p class="text-sm text-zinc-400 mt-1">${escapeHtml(tenant.subdomain)}.hubport.cloud</p>
      </div>
      <div class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
        <h3 class="text-sm text-zinc-500 uppercase tracking-wider mb-3">Status</h3>
        <p class="text-xl font-semibold ${statusColor}">${tenant.status}</p>
        <p class="text-sm text-zinc-400 mt-1">Since ${tenant.createdAt.toISOString().split('T')[0]}</p>
      </div>
    </div>

    ${setupCodeSection(tenant.status)}

    <div class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
      <h3 class="text-sm text-zinc-500 uppercase tracking-wider mb-4">Your Credentials</h3>
      <div class="space-y-4">
        <div class="flex items-center justify-between py-3 border-b border-zinc-800/50">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
              <svg class="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </div>
            <div>
              <p class="text-xs text-zinc-500">Tenant ID</p>
              <p class="font-mono text-sm">
                <span id="tid-masked" class="text-zinc-300">${tenant.id.slice(0, 4)}<span class="text-zinc-600">${'•'.repeat(Math.max(0, tenant.id.length - 8))}</span>${tenant.id.slice(-4)}</span>
                <span id="tid-value" class="text-amber-400 break-all hidden">${tenant.id}</span>
              </p>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <button onclick="toggleCred('tid')" class="p-1.5 text-zinc-500 hover:text-amber-400 rounded-md hover:bg-zinc-800 transition" title="Reveal"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg></button>
            <button onclick="copyCred('${tenant.id}', event)" class="p-1.5 text-zinc-500 hover:text-amber-400 rounded-md hover:bg-zinc-800 transition" title="Copy"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
          </div>
        </div>

        <div class="flex items-center justify-between py-3 border-b border-zinc-800/50">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
              <svg class="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            </div>
            <div>
              <p class="text-xs text-zinc-500">Tunnel Token</p>
              <p class="font-mono text-sm">
                <span id="token-masked" class="text-zinc-300">${'•'.repeat(4)}<span class="text-zinc-600">${'•'.repeat(16)}</span>${'•'.repeat(4)}</span>
                <span id="token-value" class="text-amber-400 text-xs break-all hidden"></span>
              </p>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <button onclick="revealToken()" id="token-eye" class="p-1.5 text-zinc-500 hover:text-amber-400 rounded-md hover:bg-zinc-800 transition" title="Reveal (requires password)"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg></button>
            <button id="token-copy" onclick="copyTokenValue(event)" class="p-1.5 text-zinc-500 hover:text-amber-400 rounded-md hover:bg-zinc-800 transition hidden" title="Copy"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
          </div>
        </div>

        <div class="flex items-center justify-between py-3">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
              <svg class="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            </div>
            <div>
              <p class="text-xs text-zinc-500">API Token</p>
              ${apiToken
                ? `<p class="font-mono text-sm">
                    <span id="api-masked" class="text-zinc-300">${escapeHtml(apiToken.slice(0, 4))}<span class="text-zinc-600">${'•'.repeat(Math.max(0, apiToken.length - 8))}</span>${escapeHtml(apiToken.slice(-4))}</span>
                    <span id="api-value" data-token="${escapeHtml(apiToken)}" class="text-amber-400 text-xs break-all hidden">${escapeHtml(apiToken)}</span>
                  </p>
                  <p class="text-[11px] text-zinc-600 mt-0.5">Save this token now — it will not appear again.</p>`
                : '<p class="text-sm text-zinc-600">Already displayed. <a href="/portal/dashboard" class="text-amber-500 hover:underline">Reload</a> or rotate via API.</p>'
              }
            </div>
          </div>
          ${apiToken
            ? `<div class="flex items-center gap-1">
                <button onclick="toggleCred('api')" class="p-1.5 text-zinc-500 hover:text-amber-400 rounded-md hover:bg-zinc-800 transition" title="Reveal"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg></button>
                <button onclick="copyCred(document.getElementById('api-value').dataset.token, event)" class="p-1.5 text-zinc-500 hover:text-amber-400 rounded-md hover:bg-zinc-800 transition" title="Copy"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
              </div>`
            : ''
          }
        </div>
      </div>
    </div>

    <div class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
      <h3 class="text-sm text-zinc-500 uppercase tracking-wider mb-4">Security</h3>

      <div class="space-y-4">
        <div class="flex items-center justify-between py-3 border-b border-zinc-800/50">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg ${tenant.auth?.totpEnabled ? 'bg-green-900/30' : 'bg-zinc-800'} flex items-center justify-center flex-shrink-0">
              <svg class="w-4 h-4 ${tenant.auth?.totpEnabled ? 'text-green-400' : 'text-zinc-400'}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            </div>
            <div>
              <p class="text-sm text-zinc-200 font-medium">Authenticator App (TOTP)</p>
              <p class="text-xs ${tenant.auth?.totpEnabled ? 'text-green-400' : 'text-zinc-500'}">${tenant.auth?.totpEnabled ? 'Enabled' : 'Not configured'}</p>
            </div>
          </div>
          ${tenant.auth?.totpEnabled
            ? '<a href="/portal/totp/enroll" class="text-xs text-zinc-500 hover:text-zinc-300 px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-600 transition">Change</a>'
            : '<a href="/portal/totp/enroll" class="text-xs text-amber-400 hover:text-amber-300 px-3 py-1.5 rounded-lg border border-amber-600/40 bg-amber-600/10 hover:bg-amber-600/20 transition">Enable</a>'
          }
        </div>

        <div class="py-3">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
                <svg class="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4"/></svg>
              </div>
              <div>
                <p class="text-sm text-zinc-200 font-medium">Passkeys</p>
                <p class="text-xs text-zinc-500" id="passkey-count">Loading...</p>
              </div>
            </div>
            <button onclick="registerPasskey()" class="text-xs text-amber-400 hover:text-amber-300 px-3 py-1.5 rounded-lg border border-amber-600/40 bg-amber-600/10 hover:bg-amber-600/20 transition">Add Passkey</button>
          </div>
          <div id="passkey-list" class="space-y-2 ml-11"></div>
          <div id="passkey-error" class="text-xs text-red-400 ml-11 mt-2 hidden"></div>
        </div>
      </div>
    </div>

    <div class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
      <h3 class="text-sm text-zinc-500 uppercase tracking-wider mb-4 flex items-center gap-2">
        <svg class="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/></svg>
        Maintenance
      </h3>

      <div id="maintenance-collapsed">
        <p class="text-sm text-zinc-400 mb-3">After a server reboot, Vault needs to be unsealed before services can access secrets (encryption keys, passwords, tokens).</p>
        <button onclick="document.getElementById('maintenance-collapsed').classList.add('hidden'); document.getElementById('maintenance-expanded').classList.remove('hidden');" class="text-sm text-amber-400 hover:text-amber-300 px-4 py-2 rounded-lg border border-amber-600/40 bg-amber-600/10 hover:bg-amber-600/20 transition">
          Show Vault Unseal Guide
        </button>
      </div>

      <div id="maintenance-expanded" class="hidden">
        <div class="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 mb-4">
          <div class="flex items-start gap-3 mb-4">
            <svg class="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <div class="text-sm">
              <p class="text-amber-400 font-semibold mb-1">After Server Reboot</p>
              <p class="text-zinc-400 text-xs mb-2">When your server restarts, Vault becomes sealed. All services that depend on secrets (chat, encryption, authentication) will stop working until Vault is unsealed.</p>
            </div>
          </div>

          <div class="space-y-3">
            <div>
              <span class="text-[10px] text-zinc-600 uppercase tracking-wider">Step 1: Check Vault status</span>
              <div class="flex items-center gap-2 mt-1">
                <code id="vault-cmd-1" class="flex-1 text-sm text-amber-400 font-mono select-all bg-zinc-900/50 rounded px-2 py-1.5">docker exec ${escapeHtml(tenant.subdomain)}-vault-1 vault status</code>
                <button onclick="copyCred(document.getElementById('vault-cmd-1').textContent, event)" class="p-1 text-zinc-500 hover:text-amber-400 transition flex-shrink-0" title="Copy"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
              </div>
              <p class="text-[11px] text-zinc-600 mt-1">If <span class="text-red-400">Sealed: true</span>, proceed to Step 2.</p>
            </div>

            <div>
              <span class="text-[10px] text-zinc-600 uppercase tracking-wider">Step 2: Unseal Vault</span>
              <div class="flex items-center gap-2 mt-1">
                <code id="vault-cmd-2" class="flex-1 text-sm text-amber-400 font-mono select-all bg-zinc-900/50 rounded px-2 py-1.5">docker exec -it ${escapeHtml(tenant.subdomain)}-vault-1 vault operator unseal</code>
                <button onclick="copyCred(document.getElementById('vault-cmd-2').textContent, event)" class="p-1 text-zinc-500 hover:text-amber-400 transition flex-shrink-0" title="Copy"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
              </div>
              <p class="text-[11px] text-zinc-600 mt-1">Paste your unseal key from <span class="font-mono text-zinc-400">.secrets/.vault-keys</span> when prompted.</p>
            </div>

            <div>
              <span class="text-[10px] text-zinc-600 uppercase tracking-wider">Step 3: Verify</span>
              <p class="text-xs text-zinc-500 mt-1">Run Step 1 again &mdash; <span class="text-green-400">Sealed: false</span> means Vault is operational. Services recover automatically.</p>
            </div>
          </div>

          <div class="mt-4 p-3 bg-amber-950/20 border border-amber-900/30 rounded-lg">
            <p class="text-xs text-amber-400/80"><strong>Keep your .vault-keys file safe.</strong> It contains the unseal key generated during installation. Without it, Vault cannot be unsealed and all encrypted data becomes inaccessible.</p>
          </div>
        </div>

        <button onclick="document.getElementById('maintenance-expanded').classList.add('hidden'); document.getElementById('maintenance-collapsed').classList.remove('hidden');" class="text-xs text-zinc-600 hover:text-zinc-400 transition">
          Hide
        </button>
      </div>
    </div>

    <div class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
      <h3 class="text-sm text-zinc-500 uppercase tracking-wider mb-4">Authorized Devices</h3>
      <div id="device-list" class="space-y-2"></div>
      <p id="device-empty" class="text-sm text-zinc-600 hidden">No devices authorized yet.</p>
    </div>

    <script>
    function toggleCred(prefix) {
      var masked = document.getElementById(prefix + '-masked');
      var shown = document.getElementById(prefix + '-value');
      if (shown.classList.contains('hidden')) {
        masked.classList.add('hidden');
        shown.classList.remove('hidden');
      } else {
        shown.classList.add('hidden');
        masked.classList.remove('hidden');
      }
    }
    function copyCred(value, event) {
      navigator.clipboard.writeText(value).then(function() {
        var btn = event && event.currentTarget ? event.currentTarget : null;
        if (!btn) return;
        var orig = btn.innerHTML;
        btn.innerHTML = '<svg class="w-4 h-4 text-green-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>';
        setTimeout(function() { btn.innerHTML = orig; }, 1500);
      });
    }
    function copyTokenValue(event) {
      var el = document.getElementById('token-value');
      if (el) {
        navigator.clipboard.writeText(el.textContent || '').then(function() {
          var btn = event && event.currentTarget ? event.currentTarget : null;
          if (!btn) return;
          var orig = btn.innerHTML;
          btn.innerHTML = '<svg class="w-4 h-4 text-green-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>';
          setTimeout(function() { btn.innerHTML = orig; }, 1500);
        });
      }
    }

    // --- Passkey management ---
    async function loadPasskeys() {
      try {
        var res = await fetch('/portal/passkey/list', { credentials: 'same-origin' });
        if (!res.ok) return;
        var data = await res.json();
        var list = document.getElementById('passkey-list');
        var count = document.getElementById('passkey-count');
        count.textContent = data.passkeys.length + ' registered';
        list.innerHTML = '';
        data.passkeys.forEach(function(pk) {
          var created = new Date(pk.createdAt).toLocaleDateString();
          var div = document.createElement('div');
          div.className = 'flex items-center justify-between bg-zinc-800/50 rounded-lg px-3 py-2 border border-zinc-700/50';
          div.innerHTML = '<div class="flex items-center gap-2">' +
            '<svg class="w-3.5 h-3.5 text-zinc-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 7h2a5 5 0 010 10h-2m-6 0H7A5 5 0 017 7h2"/><path d="M8 12h8"/></svg>' +
            '<span class="text-xs text-zinc-300">' + (pk.name || 'Passkey') + '</span>' +
            '<span class="text-[10px] text-zinc-600 ml-1">added ' + created + '</span>' +
            '</div>' +
            '<button onclick="deletePasskey(\\'' + pk.id + '\\')" class="p-1 text-zinc-600 hover:text-red-400 transition" title="Remove passkey">' +
            '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>' +
            '</button>';
          list.appendChild(div);
        });
      } catch {}
    }
    loadPasskeys();

    async function registerPasskey() {
      var errEl = document.getElementById('passkey-error');
      errEl.classList.add('hidden');
      try {
        var optRes = await fetch('/portal/passkey/register-options', { credentials: 'same-origin' });
        if (!optRes.ok) throw new Error('Failed to get options');
        var options = await optRes.json();
        options.challenge = _b64ToBuf(options.challenge);
        options.user.id = _b64ToBuf(options.user.id);
        if (options.excludeCredentials) {
          options.excludeCredentials = options.excludeCredentials.map(function(c) {
            return Object.assign({}, c, { id: _b64ToBuf(c.id) });
          });
        }
        var cred = await navigator.credentials.create({ publicKey: options });
        if (!cred) throw new Error('No credential returned');
        var verifyRes = await fetch('/portal/passkey/register-verify', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: cred.id, rawId: _bufToB64(cred.rawId), type: cred.type,
            response: {
              clientDataJSON: _bufToB64(cred.response.clientDataJSON),
              attestationObject: _bufToB64(cred.response.attestationObject),
            },
            clientExtensionResults: cred.getClientExtensionResults(),
          }),
        });
        if (!verifyRes.ok) { var e = await verifyRes.json(); throw new Error(e.error || 'Registration failed'); }
        loadPasskeys();
      } catch (e) {
        errEl.textContent = e.message || 'Passkey registration failed';
        errEl.classList.remove('hidden');
      }
    }

    async function deletePasskey(id) {
      if (!confirm('Remove this passkey?')) return;
      var pw = prompt('Enter your password to confirm:');
      if (!pw) return;
      var errEl = document.getElementById('passkey-error');
      errEl.classList.add('hidden');
      try {
        var res = await fetch('/portal/passkey/delete', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credentialId: id, password: pw }),
        });
        if (!res.ok) { var e = await res.json(); throw new Error(e.error || 'Delete failed'); }
        loadPasskeys();
      } catch (e) {
        errEl.textContent = e.message || 'Failed to delete passkey';
        errEl.classList.remove('hidden');
      }
    }

    // --- Device management ---
    async function loadDevices() {
      try {
        var res = await fetch('/portal/devices', { credentials: 'same-origin' });
        if (!res.ok) return;
        var data = await res.json();
        var list = document.getElementById('device-list');
        var empty = document.getElementById('device-empty');
        list.textContent = '';
        if (data.devices.length === 0) {
          empty.classList.remove('hidden');
          return;
        }
        empty.classList.add('hidden');
        data.devices.forEach(function(d) {
          var approved = d.approvedAt ? new Date(d.approvedAt).toLocaleDateString() : '';
          var div = document.createElement('div');
          div.className = 'flex items-center justify-between bg-zinc-800/50 rounded-lg px-3 py-2.5 border border-zinc-700/50';
          var infoDiv = document.createElement('div');
          infoDiv.className = 'flex items-center gap-3';
          var iconDiv = document.createElement('div');
          iconDiv.className = 'w-8 h-8 rounded-lg bg-green-900/30 flex items-center justify-center flex-shrink-0';
          iconDiv.innerHTML = '<svg class="w-4 h-4 text-green-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/></svg>';
          var textDiv = document.createElement('div');
          var hostEl = document.createElement('span');
          hostEl.className = 'text-sm text-zinc-200 font-mono';
          hostEl.textContent = d.hostname;
          var metaEl = document.createElement('span');
          metaEl.className = 'text-[10px] text-zinc-600 ml-2';
          metaEl.textContent = d.os + '/' + d.arch + ' \u00b7 ' + d.ip + ' \u00b7 approved ' + approved;
          textDiv.appendChild(hostEl);
          textDiv.appendChild(metaEl);
          infoDiv.appendChild(iconDiv);
          infoDiv.appendChild(textDiv);
          var revokeBtn = document.createElement('button');
          revokeBtn.className = 'p-1 text-zinc-600 hover:text-red-400 transition';
          revokeBtn.title = 'Revoke device';
          revokeBtn.setAttribute('data-id', d.id);
          revokeBtn.onclick = function() { revokeDevice(d.id); };
          revokeBtn.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';
          div.appendChild(infoDiv);
          div.appendChild(revokeBtn);
          list.appendChild(div);
        });
      } catch {}
    }
    loadDevices();

    async function revokeDevice(id) {
      if (!confirm('Revoke this device?')) return;
      try {
        var res = await fetch('/portal/devices/revoke', {
          method: 'POST', credentials: 'same-origin',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({deviceId: id}),
        });
        if (!res.ok) { var e = await res.json(); throw new Error(e.error); }
        loadDevices();
      } catch {}
    }
    </script>

    <!-- Danger Zone -->
    <div class="bg-red-950/20 border border-red-900/40 rounded-xl p-6 mb-8">
      <h3 class="text-sm text-red-400 uppercase tracking-wider mb-4 flex items-center gap-2">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        Danger Zone
      </h3>

      <div id="danger-zone-collapsed">
        <p class="text-sm text-zinc-400 mb-4">Reset your installation to start fresh. This will <strong class="text-red-400">permanently delete</strong> all local data including the database, Keycloak config, and Vault secrets.</p>
        <button onclick="document.getElementById('danger-zone-collapsed').classList.add('hidden'); document.getElementById('danger-zone-expanded').classList.remove('hidden');" class="text-sm text-red-400 hover:text-red-300 px-4 py-2 rounded-lg border border-red-900/40 hover:border-red-800/60 bg-red-950/30 hover:bg-red-950/50 transition">
          Show Reset Commands
        </button>
      </div>

      <div id="danger-zone-expanded" class="hidden">
        <div class="bg-red-950/30 border border-red-900/30 rounded-lg p-4 mb-4">
          <div class="flex items-start gap-3 mb-4">
            <svg class="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <div class="text-sm">
              <p class="text-red-400 font-semibold mb-1">Warning: This cannot be undone!</p>
              <ul class="text-zinc-400 space-y-1 list-disc list-inside text-xs">
                <li>All Docker volumes (database, Keycloak, Vault) will be destroyed</li>
                <li>All user accounts, publishers, territories, and meetings will be lost</li>
                <li>You will need to generate a new setup code to reinstall</li>
              </ul>
            </div>
          </div>

          <p class="text-xs text-zinc-500 mb-2">Run these commands on your server:</p>

          <div class="space-y-3">
            <div>
              <span class="text-[10px] text-zinc-600 uppercase tracking-wider">Step 1: Stop and remove all containers + volumes</span>
              <div class="flex items-center gap-2 mt-1">
                <code id="danger-cmd-1" class="flex-1 text-sm text-red-400 font-mono select-all bg-zinc-900/50 rounded px-2 py-1.5">docker compose -p ${escapeHtml(tenant.subdomain)} down -v --remove-orphans</code>
                <button onclick="copyCred(document.getElementById('danger-cmd-1').textContent, event)" class="p-1 text-zinc-500 hover:text-red-400 transition flex-shrink-0" title="Copy"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
              </div>
            </div>

            <div>
              <span class="text-[10px] text-zinc-600 uppercase tracking-wider">Step 2: Remove project directory</span>
              <div class="flex items-center gap-2 mt-1">
                <code id="danger-cmd-2" class="flex-1 text-sm text-red-400 font-mono select-all bg-zinc-900/50 rounded px-2 py-1.5">rm -rf ~/hubport.cloud/${escapeHtml(tenant.subdomain)}</code>
                <button onclick="copyCred(document.getElementById('danger-cmd-2').textContent, event)" class="p-1 text-zinc-500 hover:text-red-400 transition flex-shrink-0" title="Copy"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
              </div>
            </div>

            <div>
              <span class="text-[10px] text-zinc-600 uppercase tracking-wider">Step 3: Reinstall</span>
              <p class="text-xs text-zinc-500 mt-1">Generate a new setup code above, then run the installer again.</p>
            </div>
          </div>
        </div>

        <button onclick="document.getElementById('danger-zone-expanded').classList.add('hidden'); document.getElementById('danger-zone-collapsed').classList.remove('hidden');" class="text-xs text-zinc-600 hover:text-zinc-400 transition">
          Hide
        </button>
      </div>
    </div>

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
        var token = data.tunnelToken;
        document.getElementById('token-masked').classList.add('hidden');
        document.getElementById('token-value').textContent = token;
        document.getElementById('token-value').classList.remove('hidden');
        document.getElementById('token-eye').onclick = function() { toggleCred('token'); };
        // Update masked to show first4••••last4 pattern
        document.getElementById('token-masked').innerHTML = '<span class="text-zinc-300">' + token.slice(0,4) + '<span class="text-zinc-600">' + '\u2022'.repeat(Math.min(16, token.length - 8)) + '</span>' + token.slice(-4) + '</span>';
        document.getElementById('token-copy').classList.remove('hidden');
        closeRevealModal();
      } catch {
        document.getElementById('reveal-error').textContent = 'Request failed';
        document.getElementById('reveal-error').classList.remove('hidden');
      }
    }
    </script>
  `;
}

export function docsPage(): string {
  return `
    <h2 class="text-2xl text-amber-500 mb-6">Documentation</h2>

    <div class="space-y-8">

      <div class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
        <h3 class="text-lg text-amber-400 mb-4 flex items-center gap-2">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          Quick Start
        </h3>
        <ol class="space-y-3 text-sm text-zinc-300 list-decimal list-inside">
          <li><strong class="text-zinc-200">Generate a Setup Code</strong> on your <a href="/portal/dashboard" class="text-amber-500 hover:underline">Dashboard</a></li>
          <li><strong class="text-zinc-200">Run the installer</strong> on your server:
            <pre class="bg-zinc-800 rounded-lg px-4 py-2 mt-2 text-amber-400 text-xs font-mono overflow-x-auto">curl -fsSL https://get.hubport.cloud | sh</pre>
          </li>
          <li><strong class="text-zinc-200">Enter the setup code</strong> when prompted</li>
          <li><strong class="text-zinc-200">Approve the device</strong> in the portal when the device code appears</li>
          <li><strong class="text-zinc-200">Done!</strong> Your hub is running at <code class="text-amber-400">http://localhost:3000</code></li>
        </ol>
      </div>

      <div class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
        <h3 class="text-lg text-amber-400 mb-4 flex items-center gap-2">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/></svg>
          Server Requirements
        </h3>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div class="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/50">
            <p class="text-zinc-500 text-xs uppercase tracking-wider mb-1">CPU</p>
            <p class="text-zinc-200">1 vCPU minimum</p>
          </div>
          <div class="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/50">
            <p class="text-zinc-500 text-xs uppercase tracking-wider mb-1">RAM</p>
            <p class="text-zinc-200">4 GB minimum</p>
          </div>
          <div class="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/50">
            <p class="text-zinc-500 text-xs uppercase tracking-wider mb-1">Disk</p>
            <p class="text-zinc-200">20 GB minimum</p>
          </div>
        </div>
        <p class="text-xs text-zinc-500 mt-3">Works on any Docker-compatible OS: Ubuntu, Debian, macOS, Windows (Docker Desktop), Raspberry Pi, Synology NAS.</p>
      </div>

      <div class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
        <h3 class="text-lg text-amber-400 mb-4 flex items-center gap-2">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
          Common Commands
        </h3>
        <div class="space-y-3">
          <div>
            <p class="text-xs text-zinc-500 uppercase tracking-wider mb-1">Start services</p>
            <pre class="bg-zinc-800 rounded-lg px-4 py-2 text-amber-400 text-xs font-mono">cd ~/hubport.cloud/&lt;slug&gt; &amp;&amp; docker compose up -d</pre>
          </div>
          <div>
            <p class="text-xs text-zinc-500 uppercase tracking-wider mb-1">Stop services</p>
            <pre class="bg-zinc-800 rounded-lg px-4 py-2 text-amber-400 text-xs font-mono">cd ~/hubport.cloud/&lt;slug&gt; &amp;&amp; docker compose down</pre>
          </div>
          <div>
            <p class="text-xs text-zinc-500 uppercase tracking-wider mb-1">View logs</p>
            <pre class="bg-zinc-800 rounded-lg px-4 py-2 text-amber-400 text-xs font-mono">cd ~/hubport.cloud/&lt;slug&gt; &amp;&amp; docker compose logs -f</pre>
          </div>
          <div>
            <p class="text-xs text-zinc-500 uppercase tracking-wider mb-1">View specific service logs</p>
            <pre class="bg-zinc-800 rounded-lg px-4 py-2 text-amber-400 text-xs font-mono">docker compose logs -f hubport    # app + api
docker compose logs -f keycloak   # auth server
docker compose logs -f vault      # secrets
docker compose logs -f cloudflared # tunnel</pre>
          </div>
          <div>
            <p class="text-xs text-zinc-500 uppercase tracking-wider mb-1">Restart a service</p>
            <pre class="bg-zinc-800 rounded-lg px-4 py-2 text-amber-400 text-xs font-mono">docker compose restart hubport</pre>
          </div>
          <div>
            <p class="text-xs text-zinc-500 uppercase tracking-wider mb-1">Update to latest version</p>
            <pre class="bg-zinc-800 rounded-lg px-4 py-2 text-amber-400 text-xs font-mono">docker compose pull &amp;&amp; docker compose up -d</pre>
          </div>
          <div>
            <p class="text-xs text-zinc-500 uppercase tracking-wider mb-1">Full reinstall (destroys data)</p>
            <pre class="bg-zinc-800 rounded-lg px-4 py-2 text-red-400 text-xs font-mono">curl -fsSL https://get.hubport.cloud | sh -s -- &lt;CODE&gt; --force</pre>
          </div>
        </div>
      </div>

      <div class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
        <h3 class="text-lg text-amber-400 mb-4 flex items-center gap-2">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          Architecture
        </h3>
        <div class="text-sm text-zinc-300 space-y-2">
          <p>Your hub runs as Docker containers on your own server:</p>
          <table class="w-full text-xs mt-3">
            <thead><tr class="border-b border-zinc-700"><th class="text-left py-2 text-zinc-500">Service</th><th class="text-left py-2 text-zinc-500">Port</th><th class="text-left py-2 text-zinc-500">Description</th></tr></thead>
            <tbody class="text-zinc-300">
              <tr class="border-b border-zinc-800/50"><td class="py-2 font-mono">hubport</td><td class="py-2">3000, 3001</td><td class="py-2">Hub app (SPA) + API</td></tr>
              <tr class="border-b border-zinc-800/50"><td class="py-2 font-mono">keycloak</td><td class="py-2">8080</td><td class="py-2">Authentication (OIDC, RBAC)</td></tr>
              <tr class="border-b border-zinc-800/50"><td class="py-2 font-mono">vault</td><td class="py-2">8200</td><td class="py-2">Secrets management</td></tr>
              <tr class="border-b border-zinc-800/50"><td class="py-2 font-mono">postgres</td><td class="py-2">5432</td><td class="py-2">Database</td></tr>
              <tr><td class="py-2 font-mono">cloudflared</td><td class="py-2">&mdash;</td><td class="py-2">Cloudflare Tunnel (secure ingress)</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
        <h3 class="text-lg text-amber-400 mb-4 flex items-center gap-2">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Security
        </h3>
        <div class="text-sm text-zinc-300 space-y-3">
          <div class="flex items-start gap-3">
            <span class="text-green-400 mt-0.5">&#10003;</span>
            <div><strong class="text-zinc-200">End-to-end encryption</strong><p class="text-zinc-500 text-xs">All traffic runs through Cloudflare Tunnel &mdash; no open ports, no public IP needed.</p></div>
          </div>
          <div class="flex items-start gap-3">
            <span class="text-green-400 mt-0.5">&#10003;</span>
            <div><strong class="text-zinc-200">Your data stays on your server</strong><p class="text-zinc-500 text-xs">Database, files, and secrets never leave your infrastructure.</p></div>
          </div>
          <div class="flex items-start gap-3">
            <span class="text-green-400 mt-0.5">&#10003;</span>
            <div><strong class="text-zinc-200">Vault-managed secrets</strong><p class="text-zinc-500 text-xs">Database passwords and encryption keys stored in HashiCorp Vault.</p></div>
          </div>
          <div class="flex items-start gap-3">
            <span class="text-green-400 mt-0.5">&#10003;</span>
            <div><strong class="text-zinc-200">RBAC via Keycloak</strong><p class="text-zinc-500 text-xs">Roles: admin, elder, publisher, viewer. Managed through Keycloak at <code class="text-amber-400">localhost:8080</code>.</p></div>
          </div>
        </div>
      </div>

      <div class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
        <h3 class="text-lg text-amber-400 mb-4 flex items-center gap-2">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></svg>
          Troubleshooting
        </h3>
        <div class="space-y-4 text-sm">
          <div>
            <p class="text-zinc-200 font-medium">Hub app not loading?</p>
            <p class="text-zinc-500 text-xs mt-1">Check if all services are running: <code class="text-amber-400">docker compose ps</code>. If keycloak shows "unhealthy", wait 1-2 minutes &mdash; it needs time to start.</p>
          </div>
          <div>
            <p class="text-zinc-200 font-medium">Authentication error on localhost:3000?</p>
            <p class="text-zinc-500 text-xs mt-1">Keycloak may still be starting. Check <code class="text-amber-400">docker compose logs keycloak</code> and wait for "Listening on: http://0.0.0.0:8080".</p>
          </div>
          <div>
            <p class="text-zinc-200 font-medium">Tunnel not connecting?</p>
            <p class="text-zinc-500 text-xs mt-1">Verify your server has internet access. Check <code class="text-amber-400">docker compose logs cloudflared</code> for errors. The tunnel token is in <code class="text-amber-400">.secrets/.env</code>.</p>
          </div>
          <div>
            <p class="text-zinc-200 font-medium">Forgot admin credentials?</p>
            <p class="text-zinc-500 text-xs mt-1">Credentials are stored in <code class="text-amber-400">~/hubport.cloud/&lt;slug&gt;/.secrets/</code>. Keycloak admin password is in <code class="text-amber-400">.env</code> as <code class="text-amber-400">KC_ADMIN_PASSWORD</code>.</p>
          </div>
          <div>
            <p class="text-zinc-200 font-medium">Need a fresh start?</p>
            <p class="text-zinc-500 text-xs mt-1">Generate a new setup code and run the installer with <code class="text-amber-400">--force</code>. This destroys all data and starts clean.</p>
          </div>
        </div>
      </div>

      <div class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
        <h3 class="text-lg text-amber-400 mb-4 flex items-center gap-2">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          Getting Help
        </h3>
        <div class="text-sm text-zinc-300 space-y-2">
          <p>hubport.cloud is open-source (MIT + Commons Clause).</p>
          <div class="flex flex-wrap gap-3 mt-3">
            <a href="https://github.com/itunified-io/hubport.cloud" target="_blank" rel="noopener" class="inline-flex items-center gap-2 text-xs text-amber-400 hover:text-amber-300 px-3 py-1.5 rounded-lg border border-amber-600/40 bg-amber-600/10 hover:bg-amber-600/20 transition">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
              GitHub
            </a>
            <a href="https://hubport.cloud/en/faq" target="_blank" rel="noopener" class="inline-flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-600 transition">FAQ</a>
            <a href="https://hubport.cloud/en/contact" target="_blank" rel="noopener" class="inline-flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-600 transition">Contact</a>
          </div>
        </div>
      </div>

    </div>
  `;
}
