import type { WizardStep, StepStatus, StepResult } from './types.js';

const CENTRAL_API = process.env.CENTRAL_API_URL || 'https://api.hubport.cloud';
const TENANT_ID = process.env.TENANT_ID || process.env.HUBPORT_TENANT_ID || '';
const API_TOKEN = process.env.HUBPORT_API_TOKEN || '';

export const apiTokenStep: WizardStep = {
  number: 1,
  id: 'api-token',
  title: 'API Token',
  description: 'Validate your API token from the Tenant Portal. Copy it from portal.hubport.cloud.',
  optional: false,

  async check(): Promise<StepStatus> {
    if (!API_TOKEN) {
      return { completed: false, details: { error: 'HUBPORT_API_TOKEN not set in environment' } };
    }
    if (!API_TOKEN.startsWith('hpt_')) {
      return { completed: false, details: { error: 'Token format invalid — must start with hpt_' } };
    }
    if (!TENANT_ID) {
      return { completed: false, details: { error: 'HUBPORT_TENANT_ID not set' } };
    }
    try {
      const res = await fetch(`${CENTRAL_API}/tenants/${TENANT_ID}`, {
        headers: { Authorization: `Bearer ${API_TOKEN}` },
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 401) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (body.error === 'token_expired') {
          return { completed: false, details: { error: 'Token expired — get a new one from the portal' } };
        }
        return { completed: false, details: { error: 'Token invalid or revoked' } };
      }
      if (!res.ok) {
        return { completed: false, details: { error: `API returned ${res.status}` } };
      }
      const infoRes = await fetch(`${CENTRAL_API}/api/v1/tokens/info`, {
        headers: { Authorization: `Bearer ${API_TOKEN}` },
        signal: AbortSignal.timeout(5000),
      });
      if (infoRes.ok) {
        const info = await infoRes.json() as { expiresAt: string; daysUntilExpiry: number };
        return {
          completed: true,
          details: { status: 'valid', expiresAt: info.expiresAt, daysUntilExpiry: String(info.daysUntilExpiry) },
        };
      }
      return { completed: true, details: { status: 'valid' } };
    } catch {
      return { completed: false, details: { error: 'Central API unreachable' } };
    }
  },

  async execute(input): Promise<StepResult> {
    const token = input.apiToken || API_TOKEN;
    const tenantId = input.tenantId || TENANT_ID;
    if (!token) {
      return { success: false, message: 'API token is required. Get it from your Tenant Portal.' };
    }
    if (!token.startsWith('hpt_')) {
      return { success: false, message: 'Invalid token format. Token must start with hpt_' };
    }
    if (!tenantId) {
      return { success: false, message: 'Tenant ID is required.' };
    }
    try {
      const res = await fetch(`${CENTRAL_API}/tenants/${tenantId}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 401) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (body.error === 'token_expired') {
          return { success: false, message: 'Token has expired. Log in to your Tenant Portal to get a new one.' };
        }
        return { success: false, message: 'Token is invalid or has been revoked.' };
      }
      if (!res.ok) {
        return { success: false, message: `Validation failed: API returned ${res.status}` };
      }
      return { success: true, message: 'API token validated successfully. Token is active and linked to your tenant.' };
    } catch {
      return { success: false, message: 'Cannot reach central API. Check your internet connection and try again.' };
    }
  },
};
