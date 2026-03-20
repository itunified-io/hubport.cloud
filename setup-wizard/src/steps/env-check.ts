import type { WizardStep, StepStatus, StepResult } from './types.js';

const CENTRAL_API = process.env.CENTRAL_API_URL || 'https://api.hubport.cloud';
const TENANT_ID = process.env.HUBPORT_TENANT_ID || '';
const API_TOKEN = process.env.HUBPORT_API_TOKEN || '';

interface EnvCheck {
  name: string;
  value: string;
  valid: boolean;
  error?: string;
}

function validateEnvVars(): EnvCheck[] {
  const checks: EnvCheck[] = [
    {
      name: 'HUBPORT_TENANT_ID',
      value: TENANT_ID,
      valid: /^[0-9a-f-]{36}$/i.test(TENANT_ID),
      error: TENANT_ID ? 'Invalid UUID format' : 'Not set',
    },
    {
      name: 'HUBPORT_API_TOKEN',
      value: API_TOKEN ? `${API_TOKEN.slice(0, 8)}...` : '',
      valid: API_TOKEN.startsWith('hpt_'),
      error: API_TOKEN ? 'Must start with hpt_' : 'Not set',
    },
    {
      name: 'DATABASE_URL',
      value: process.env.DATABASE_URL ? 'set' : '',
      valid: (process.env.DATABASE_URL || '').startsWith('postgresql://'),
      error: process.env.DATABASE_URL ? 'Must start with postgresql://' : 'Not set',
    },
    {
      name: 'VAULT_ADDR',
      value: process.env.VAULT_ADDR || '',
      valid: (process.env.VAULT_ADDR || '').startsWith('http'),
      error: process.env.VAULT_ADDR ? 'Must start with http' : 'Not set',
    },
    {
      name: 'KEYCLOAK_URL',
      value: process.env.KEYCLOAK_URL || '',
      valid: (process.env.KEYCLOAK_URL || '').startsWith('http'),
      error: process.env.KEYCLOAK_URL ? 'Must start with http' : 'Not set',
    },
    {
      name: 'CF_TUNNEL_TOKEN',
      value: process.env.CF_TUNNEL_TOKEN ? 'set' : '',
      valid: (process.env.CF_TUNNEL_TOKEN || '').length > 10,
      error: process.env.CF_TUNNEL_TOKEN ? 'Too short' : 'Not set',
    },
    {
      name: 'CENTRAL_API_URL',
      value: CENTRAL_API,
      valid: CENTRAL_API.startsWith('http'),
      error: 'Must start with http',
    },
  ];
  return checks;
}

export const envCheckStep: WizardStep = {
  number: 1,
  id: 'env-check',
  title: 'Environment Check',
  description: 'Validates environment variables and checks tenant status with the central API.',
  optional: false,

  async check(): Promise<StepStatus> {
    const checks = validateEnvVars();
    const allValid = checks.every((c) => c.valid);

    if (!allValid) {
      const failed = checks.filter((c) => !c.valid).map((c) => `${c.name}: ${c.error}`);
      return { completed: false, details: { errors: failed.join(', ') } };
    }

    // Try to check tenant status
    try {
      const res = await fetch(`${CENTRAL_API}/tenants/${TENANT_ID}/status`, {
        headers: API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {},
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const tenant = await res.json() as { status: string; subdomain: string };
        return {
          completed: true,
          details: { status: tenant.status, subdomain: tenant.subdomain },
        };
      }
      return { completed: true, details: { status: 'env-valid', api: 'unreachable' } };
    } catch {
      // Central API offline — env vars are valid, proceed with warning
      return { completed: true, details: { status: 'env-valid', api: 'offline' } };
    }
  },

  async execute(): Promise<StepResult> {
    const checks = validateEnvVars();
    const failed = checks.filter((c) => !c.valid);

    if (failed.length > 0) {
      return {
        success: false,
        message: `Environment check failed: ${failed.map((c) => `${c.name} (${c.error})`).join(', ')}`,
      };
    }

    const warnings: string[] = [];

    // Try to activate tenant
    try {
      const headers: Record<string, string> = {};
      if (API_TOKEN) headers['Authorization'] = `Bearer ${API_TOKEN}`;

      const res = await fetch(`${CENTRAL_API}/tenants/${TENANT_ID}/activate`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        return {
          success: true,
          message: 'Environment validated. Tenant activated on central hub.',
        };
      }

      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (res.status === 401 && body.error === 'token_expired') {
        return {
          success: false,
          message: 'API token has expired. Log in to your Tenant Portal to get a new one.',
        };
      }

      warnings.push(`Central API returned ${res.status} — tenant may already be active.`);
    } catch {
      warnings.push('Central hub unreachable — proceeding in offline mode. Sharing features unavailable until connectivity is restored.');
    }

    return {
      success: true,
      message: 'Environment variables validated successfully.',
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },
};
