import type { WizardStep, StepStatus, StepResult } from './types.js';

const CENTRAL_API = process.env.CENTRAL_API_URL || 'https://api.hubport.cloud';
const TENANT_ID = process.env.TENANT_ID || '';
const API_TOKEN = process.env.HUBPORT_API_TOKEN || '';

export const tenantStep: WizardStep = {
  number: 1,
  id: 'tenant-register',
  title: 'Tenant Registration',
  description: 'Enter your tenant ID from the signup email. One-time call-home to confirm setup started (skipped if central hub is offline).',
  optional: false,

  async check(): Promise<StepStatus> {
    if (!TENANT_ID) return { completed: false };

    try {
      const res = await fetch(`${CENTRAL_API}/tenants/${TENANT_ID}/status`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { completed: false, details: { error: 'Tenant not found' } };
      const tenant = await res.json() as { status: string; subdomain: string };
      return {
        completed: tenant.status === 'ACTIVE',
        details: { status: tenant.status, subdomain: tenant.subdomain },
      };
    } catch {
      // Central hub offline — check local marker
      return { completed: TENANT_ID.length > 0, details: { status: 'offline-mode', tenantId: TENANT_ID } };
    }
  },

  async execute(input): Promise<StepResult> {
    const tenantId = input.tenantId || TENANT_ID;
    if (!tenantId) return { success: false, message: 'Tenant ID is required' };

    const token = input.apiToken || API_TOKEN;

    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${CENTRAL_API}/tenants/${tenantId}/activate`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        return { success: true, message: 'Tenant activated successfully. Central hub notified.' };
      }
      const err = await res.json() as { error: string };
      return { success: false, message: err.error || 'Activation failed' };
    } catch {
      return {
        success: true,
        message: 'Central hub unreachable — proceeding in offline mode. All local features will work.',
        warnings: ['Central hub offline. Sharing features will be unavailable until connectivity is restored.'],
      };
    }
  },
};
