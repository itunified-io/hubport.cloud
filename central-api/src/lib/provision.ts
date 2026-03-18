/**
 * Cloudflare provisioning — creates tunnel, ZT app, DNS for a tenant.
 *
 * Env vars:
 *   CF_API_TOKEN — Cloudflare API token with tunnel/dns/access permissions
 *   CF_ACCOUNT_ID — Cloudflare account ID
 *   CF_ZONE_ID — hubport.cloud zone ID
 */

const CF_API = 'https://api.cloudflare.com/client/v4';
const CF_TOKEN = process.env.CF_API_TOKEN || '';
const CF_ACCOUNT = process.env.CF_ACCOUNT_ID || '';
const CF_ZONE = process.env.CF_ZONE_ID || '';

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${CF_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

export interface ProvisionResult {
  tunnelId: string;
  tunnelToken: string;
  ztAppId: string;
  dnsRecordId: string;
}

export async function provisionTenant(subdomain: string, email: string): Promise<ProvisionResult> {
  if (!CF_TOKEN || !CF_ACCOUNT || !CF_ZONE) {
    throw new Error('CF_API_TOKEN, CF_ACCOUNT_ID, CF_ZONE_ID required for provisioning');
  }

  // 1. Create CF Tunnel
  const tunnelName = `hubport-tenant-${subdomain}`;
  const tunnelSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');

  const tunnelRes = await fetch(`${CF_API}/accounts/${CF_ACCOUNT}/cfd_tunnel`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ name: tunnelName, tunnel_secret: tunnelSecret }),
  });
  if (!tunnelRes.ok) throw new Error(`Tunnel create failed: ${await tunnelRes.text()}`);
  const tunnelData = await tunnelRes.json() as { result: { id: string } };
  const tunnelId = tunnelData.result.id;

  // 2. Get tunnel token
  const tokenRes = await fetch(`${CF_API}/accounts/${CF_ACCOUNT}/cfd_tunnel/${tunnelId}/token`, {
    method: 'GET',
    headers: headers(),
  });
  if (!tokenRes.ok) throw new Error(`Tunnel token failed: ${await tokenRes.text()}`);
  const tokenData = await tokenRes.json() as { result: string };
  const tunnelToken = tokenData.result;

  // 3. Create DNS CNAME (explicit, no wildcard)
  const dnsRes = await fetch(`${CF_API}/zones/${CF_ZONE}/dns_records`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      type: 'CNAME',
      name: `${subdomain}.hubport.cloud`,
      content: `${tunnelId}.cfargotunnel.com`,
      proxied: true,
      ttl: 1,
      comment: `Tenant: ${subdomain} (auto-provisioned)`,
    }),
  });
  if (!dnsRes.ok) throw new Error(`DNS create failed: ${await dnsRes.text()}`);
  const dnsData = await dnsRes.json() as { result: { id: string } };

  // 4. Create ZT Access app (no ZT for tenant users — Keycloak handles auth)
  // We skip ZT app creation since the decision was: CF tunnel is open pipe, Keycloak handles auth
  // Only platform admin gets ZT protection

  return {
    tunnelId,
    tunnelToken,
    ztAppId: '', // Not created — Keycloak handles tenant user auth
    dnsRecordId: dnsData.result.id,
  };
}

export async function deprovisionTenant(tunnelId: string, dnsRecordId?: string): Promise<void> {
  if (!CF_TOKEN || !CF_ACCOUNT || !CF_ZONE) return;

  // Delete tunnel
  if (tunnelId) {
    await fetch(`${CF_API}/accounts/${CF_ACCOUNT}/cfd_tunnel/${tunnelId}`, {
      method: 'DELETE',
      headers: headers(),
      body: JSON.stringify({ cascade: true }),
    });
  }

  // Delete DNS record
  if (dnsRecordId) {
    await fetch(`${CF_API}/zones/${CF_ZONE}/dns_records/${dnsRecordId}`, {
      method: 'DELETE',
      headers: headers(),
    });
  }
}
