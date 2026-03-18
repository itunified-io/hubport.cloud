/**
 * Gmail API email sender — uses GCP service account (otp-mailer).
 * Shared infrastructure per ADR-0043.
 *
 * Env vars:
 *   GMAIL_SERVICE_ACCOUNT_EMAIL — service account email
 *   GMAIL_PRIVATE_KEY — PEM private key (base64-encoded)
 *   GMAIL_SENDER_EMAIL — sender "from" address
 */

import { SignJWT, importPKCS8 } from 'jose';

const SA_EMAIL = process.env.GMAIL_SERVICE_ACCOUNT_EMAIL || '';
const PRIVATE_KEY_B64 = process.env.GMAIL_PRIVATE_KEY || '';
const SENDER_EMAIL = process.env.GMAIL_SENDER_EMAIL || '';
const GMAIL_USER = SENDER_EMAIL;

async function getAccessToken(): Promise<string> {
  const privateKeyPem = Buffer.from(PRIVATE_KEY_B64, 'base64').toString('utf-8');
  const privateKey = await importPKCS8(privateKeyPem, 'RS256');

  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    iss: SA_EMAIL,
    sub: GMAIL_USER,
    scope: 'https://www.googleapis.com/auth/gmail.send',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .sign(privateKey);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) throw new Error(`OAuth token failed: ${res.statusText}`);
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

function buildMimeMessage(to: string, subject: string, htmlBody: string): string {
  const boundary = `boundary_${Date.now()}`;
  const raw = [
    `From: hubport.cloud <${SENDER_EMAIL}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    ``,
    htmlBody,
    `--${boundary}--`,
  ].join('\r\n');

  return Buffer.from(raw).toString('base64url');
}

export async function sendEmail(to: string, subject: string, htmlBody: string): Promise<void> {
  if (!SA_EMAIL || !PRIVATE_KEY_B64 || !SENDER_EMAIL) {
    console.warn('[email] Gmail API not configured — skipping email send');
    return;
  }

  const token = await getAccessToken();
  const raw = buildMimeMessage(to, subject, htmlBody);

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(GMAIL_USER)}/messages/send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail send failed: ${res.status} ${err}`);
  }
}

export function onboardingEmailHtml(tenant: {
  name: string;
  subdomain: string;
  id: string;
  tunnelToken?: string;
}): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #050507; color: #e4e4e7;">
  <div style="text-align: center; padding: 20px 0; border-bottom: 1px solid rgba(255,255,255,0.08);">
    <h1 style="color: #d97706; margin: 0;">hubport.cloud</h1>
  </div>

  <div style="padding: 30px 0;">
    <h2 style="color: #e4e4e7;">Welcome, ${tenant.name}!</h2>
    <p>Your congregation has been approved on hubport.cloud. Here are your setup credentials:</p>

    <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 20px; margin: 20px 0;">
      <h3 style="color: #d97706; margin-top: 0;">Your Credentials</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 8px 0; color: #a1a1aa;">Tenant ID</td><td style="padding: 8px 0; font-family: monospace; color: #f59e0b;">${tenant.id}</td></tr>
        <tr><td style="padding: 8px 0; color: #a1a1aa;">Subdomain</td><td style="padding: 8px 0; font-family: monospace; color: #f59e0b;">${tenant.subdomain}.hubport.cloud</td></tr>
        ${tenant.tunnelToken ? `<tr><td style="padding: 8px 0; color: #a1a1aa;">Tunnel Token</td><td style="padding: 8px 0; font-family: monospace; color: #f59e0b; word-break: break-all; font-size: 11px;">${tenant.tunnelToken}</td></tr>` : ''}
      </table>
    </div>

    <h3 style="color: #e4e4e7;">Quick Start</h3>
    <ol style="line-height: 1.8;">
      <li>Install <a href="https://docs.docker.com/get-docker/" style="color: #d97706;">Docker</a> on your server</li>
      <li>Clone the repository:<br><code style="background: rgba(255,255,255,0.04); padding: 2px 6px; border-radius: 4px; color: #f59e0b;">git clone https://github.com/itunified-io/hubport.cloud.git</code></li>
      <li>Copy <code>.env.example</code> to <code>.env</code> and fill in your credentials above</li>
      <li>Run: <code style="background: rgba(255,255,255,0.04); padding: 2px 6px; border-radius: 4px; color: #f59e0b;">docker compose up -d</code></li>
      <li>Open <code style="color: #f59e0b;">http://localhost:8080</code> to complete the setup wizard</li>
    </ol>

    <p style="margin-top: 30px;">Need help? Visit <a href="https://hubport.cloud/docs" style="color: #d97706;">hubport.cloud/docs</a> or <a href="https://hubport.cloud/contact" style="color: #d97706;">contact us</a>.</p>
  </div>

  <div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 20px; text-align: center; color: #71717a; font-size: 12px;">
    <p>hubport.cloud — Free, open-source congregation management (GPL-3.0)</p>
  </div>
</body>
</html>`;
}

export function rejectionEmailHtml(tenant: { name: string }, reason?: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #050507; color: #e4e4e7;">
  <div style="text-align: center; padding: 20px 0; border-bottom: 1px solid rgba(255,255,255,0.08);">
    <h1 style="color: #d97706;">hubport.cloud</h1>
  </div>
  <div style="padding: 30px 0;">
    <h2 style="color: #e4e4e7;">Registration Update</h2>
    <p>Dear ${tenant.name},</p>
    <p>Unfortunately, your registration request for hubport.cloud could not be approved at this time.</p>
    ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
    <p>If you believe this is an error, please <a href="https://hubport.cloud/contact" style="color: #d97706;">contact us</a>.</p>
  </div>
</body>
</html>`;
}
