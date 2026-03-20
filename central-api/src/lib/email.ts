/**
 * Gmail API email sender — uses GCP service account (otp-mailer).
 * Shared infrastructure per ADR-0043.
 *
 * Env vars:
 *   GMAIL_SERVICE_ACCOUNT_EMAIL — service account email
 *   GMAIL_PRIVATE_KEY — PEM private key (base64-encoded)
 *   GMAIL_senderEmail() — sender "from" address
 */

import { SignJWT, importPKCS8 } from 'jose';

function saEmail(): string { return process.env.GMAIL_SERVICE_ACCOUNT_EMAIL || ''; }
function privateKeyB64(): string { return process.env.GMAIL_PRIVATE_KEY || ''; }
function senderEmail(): string { return process.env.GMAIL_SENDER_EMAIL || ''; }

async function getAccessToken(): Promise<string> {
  const privateKeyPem = Buffer.from(privateKeyB64(), 'base64').toString('utf-8');
  const privateKey = await importPKCS8(privateKeyPem, 'RS256');

  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    iss: saEmail(),
    sub: senderEmail(),
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

function encodeSubject(subject: string): string {
  // RFC 2047 encoded-word for UTF-8 subjects (handles em-dash, umlauts, etc.)
  const encoded = Buffer.from(subject, 'utf-8').toString('base64');
  return `=?UTF-8?B?${encoded}?=`;
}

function buildMimeMessage(to: string, subject: string, htmlBody: string): string {
  const boundary = `boundary_${Date.now()}`;
  const raw = [
    `From: hubport.cloud <${senderEmail()}>`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
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
  if (!saEmail() || !privateKeyB64() || !senderEmail()) {
    console.warn('[email] Gmail API not configured — skipping email send');
    return;
  }

  const token = await getAccessToken();
  const raw = buildMimeMessage(to, subject, htmlBody);

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(senderEmail())}/messages/send`,
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
  setupUrl?: string;
}): string {
  const portalUrl = process.env.PORTAL_BASE_URL || 'https://portal.hubport.cloud';
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
    <p>Your congregation has been approved on hubport.cloud. You can now set up your self-hosted instance.</p>

    <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 20px; margin: 20px 0;">
      <h3 style="color: #d97706; margin-top: 0;">Your Registration</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 8px 0; color: #a1a1aa;">Subdomain</td><td style="padding: 8px 0; font-family: monospace; color: #f59e0b;"> ${tenant.subdomain}.hubport.cloud</td></tr>
        <tr><td style="padding: 8px 0; color: #a1a1aa;">Status</td><td style="padding: 8px 0; color: #22c55e; font-weight: 600;">Approved</td></tr>
      </table>
    </div>

    ${tenant.setupUrl ? `
    <div style="background: rgba(217,119,6,0.15); border: 1px solid rgba(217,119,6,0.4); border-radius: 10px; padding: 20px; margin: 20px 0; text-align: center;">
      <p style="margin: 0 0 12px; font-size: 15px; font-weight: 600; color: #d97706;">Set Up Your Account</p>
      <a href="${tenant.setupUrl}" style="display: inline-block; background: #d97706; color: #fff; padding: 12px 32px; border-radius: 8px; font-weight: 600; text-decoration: none; font-size: 15px;">Create Password &amp; Enable MFA</a>
      <p style="margin: 12px 0 0; font-size: 12px; color: #a1a1aa;">This link expires in 7 days. After setup, you can access your credentials in the Tenant Portal.</p>
    </div>
    ` : `
    <div style="background: rgba(217,119,6,0.1); border: 1px solid rgba(217,119,6,0.3); border-radius: 10px; padding: 16px; margin: 20px 0;">
      <p style="margin: 0 0 8px; font-size: 14px;"><strong style="color: #d97706;">Your setup credentials</strong> are available in your <a href="${portalUrl}/portal/login" style="color: #d97706; font-weight: 600;">Tenant Portal</a>.</p>
    </div>
    `}

    <h3 style="color: #e4e4e7;">Quick Start</h3>
    <ol style="line-height: 1.8;">
      <li>${tenant.setupUrl
        ? 'Click the button above to create your password and enable MFA'
        : `Log in to your <a href="${portalUrl}/portal/login" style="color: #d97706;">Tenant Portal</a> and complete MFA setup`}</li>
      <li>Log in to your <a href="${portalUrl}/portal/dashboard" style="color: #d97706;">Tenant Portal</a></li>
      <li>Click <strong style="color: #d97706;">Generate Setup Code</strong> on your dashboard</li>
      <li>On your server, run: <code style="background: rgba(255,255,255,0.04); padding: 2px 6px; border-radius: 4px; color: #f59e0b;">curl -fsSL https://get.hubport.cloud | sh</code></li>
      <li>Enter your setup code when prompted</li>
      <li>Open <code style="color: #f59e0b;">http://localhost:8080</code> to complete the setup wizard</li>
    </ol>

    <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 16px; margin: 20px 0;">
      <h4 style="color: #d97706; margin-top: 0; font-size: 14px;">Server Requirements</h4>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr><td style="padding: 4px 0; color: #a1a1aa;">CPU</td><td style="padding: 4px 0; color: #e4e4e7;">1 vCPU (minimum)</td></tr>
        <tr><td style="padding: 4px 0; color: #a1a1aa;">RAM</td><td style="padding: 4px 0; color: #e4e4e7;">4 GB</td></tr>
        <tr><td style="padding: 4px 0; color: #a1a1aa;">Disk</td><td style="padding: 4px 0; color: #e4e4e7;">20 GB</td></tr>
        <tr><td style="padding: 4px 0; color: #a1a1aa;">Software</td><td style="padding: 4px 0; color: #e4e4e7;"><a href="https://docs.docker.com/get-docker/" style="color: #d97706;">Docker</a> + Docker Compose</td></tr>
      </table>
    </div>

    <div style="background: rgba(217,119,6,0.08); border: 1px solid rgba(217,119,6,0.2); border-radius: 10px; padding: 20px; margin: 24px 0;">
      <h3 style="color: #d97706; margin-top: 0;">Need a Server?</h3>
      <p style="font-size: 14px; margin: 8px 0;">hubport.cloud runs on any server with Docker. If your congregation doesn't have one yet, we recommend Hostinger VPS:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 12px 0;">
        <tr>
          <td style="padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 6px;">
            <strong style="color: #f59e0b;">KVM1</strong> <span style="color: #a1a1aa; font-size: 12px;">— small congregations (up to 50 publishers)</span><br>
            <span style="font-size: 12px; color: #71717a;">1 vCPU, 4 GB RAM, 50 GB SSD · from ~$5/month</span><br>
            <a href="https://www.hostinger.com/cart?product=vps%3Avps_kvm_1&period=24&referral_type=cart_link&REFERRALCODE=NSGBUECHEBQR&referral_id=019d04a9-d6f7-725d-a226-c08ca5d70b0b" style="color: #d97706; font-size: 13px; font-weight: 600;">Get KVM1 VPS &rarr;</a>
          </td>
        </tr>
        <tr><td style="height: 8px;"></td></tr>
        <tr>
          <td style="padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 6px;">
            <strong style="color: #f59e0b;">KVM2</strong> <span style="color: #a1a1aa; font-size: 12px;">— medium congregations (50–150 publishers)</span><br>
            <span style="font-size: 12px; color: #71717a;">2 vCPU, 8 GB RAM, 100 GB SSD · from ~$10/month</span><br>
            <a href="https://www.hostinger.com/cart?product=vps%3Avps_kvm_2&period=24&referral_type=cart_link&REFERRALCODE=NSGBUECHEBQR&referral_id=019d04a9-baed-70fa-b7da-b1d81e15c69a" style="color: #d97706; font-size: 13px; font-weight: 600;">Get KVM2 VPS &rarr;</a>
          </td>
        </tr>
      </table>
      <p style="font-size: 12px; color: #71717a; margin: 8px 0 0;">You can also run hubport.cloud on a Synology NAS, Raspberry Pi, or any computer with Docker.</p>
    </div>

    <p style="margin-top: 20px;">Need help? Visit <a href="https://hubport.cloud/docs" style="color: #d97706;">hubport.cloud/docs</a> or <a href="https://hubport.cloud/contact" style="color: #d97706;">contact us</a>.</p>
  </div>

  <div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 20px; text-align: center; color: #71717a; font-size: 12px;">
    <p>hubport.cloud - Self-hosted congregation management (MIT + Commons Clause)</p>
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
