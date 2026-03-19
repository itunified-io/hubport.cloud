import type { WizardStep, StepStatus, StepResult } from './types.js';

const VAULT_ADDR = process.env.VAULT_ADDR || 'http://vault:8200';
const VAULT_TOKEN = process.env.VAULT_TOKEN || '';
const SECRET_PATH = 'secret/data/hubport/encryption-key';

export const encryptionKeyStep: WizardStep = {
  number: 4,
  id: 'encryption-key',
  title: 'Encryption Key Verification',
  description:
    'Verifies the encryption key was generated during Vault initialization (Step 3). The key encrypts personal data (names, emails, phone numbers) at rest.',
  optional: false,

  async check(): Promise<StepStatus> {
    try {
      const res = await fetch(`${VAULT_ADDR}/v1/${SECRET_PATH}`, {
        headers: { 'X-Vault-Token': VAULT_TOKEN },
        signal: AbortSignal.timeout(3000),
      });

      if (!res.ok) return { completed: false };

      const body = (await res.json()) as {
        data?: { data?: { key?: string } };
      };
      const exists = typeof body.data?.data?.key === 'string' && body.data.data.key.length > 0;

      return {
        completed: exists,
        details: exists
          ? { status: 'Encryption key present in Vault (generated during Step 3)' }
          : { status: 'Key not found — re-run Step 3 (Vault Initialization)' },
      };
    } catch {
      return { completed: false, details: { status: 'Vault unreachable' } };
    }
  },

  async execute(): Promise<StepResult> {
    // Encryption key is now generated during Vault init (Step 3)
    // This step only verifies it exists
    const status = await this.check();

    if (status.completed) {
      return {
        success: true,
        message: 'Encryption key verified in Vault. Generated during Step 3 (Vault Initialization).',
      };
    }

    return {
      success: false,
      message: 'Encryption key not found in Vault. Please re-run Step 3 (Vault Initialization) first.',
    };
  },
};
