import { randomBytes } from 'node:crypto';
import type { WizardStep, StepStatus, StepResult } from './types.js';

const VAULT_ADDR = process.env.VAULT_ADDR || 'http://vault:8200';
const VAULT_TOKEN = process.env.VAULT_TOKEN || '';
const SECRET_PATH = 'secret/data/hubport/encryption-key';

export const encryptionKeyStep: WizardStep = {
  number: 4,
  id: 'encryption-key',
  title: 'Encryption Key Generation',
  description:
    'Generate a 32-byte random encryption key and store it securely in Vault. The key is used to encrypt sensitive tenant data at rest and is never exposed outside Vault.',
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
        details: exists ? { status: 'Key present in Vault' } : { status: 'Key not found' },
      };
    } catch {
      return { completed: false, details: { status: 'Vault unreachable' } };
    }
  },

  async execute(): Promise<StepResult> {
    if (!VAULT_TOKEN) {
      return {
        success: false,
        message: 'VAULT_TOKEN is not set. Complete the Vault Initialization step first.',
      };
    }

    try {
      // Check if a key already exists (idempotent)
      const existingRes = await fetch(`${VAULT_ADDR}/v1/${SECRET_PATH}`, {
        headers: { 'X-Vault-Token': VAULT_TOKEN },
        signal: AbortSignal.timeout(3000),
      });

      if (existingRes.ok) {
        const body = (await existingRes.json()) as {
          data?: { data?: { key?: string } };
        };
        if (typeof body.data?.data?.key === 'string' && body.data.data.key.length > 0) {
          return {
            success: true,
            message: 'Encryption key already exists in Vault. Skipping generation.',
          };
        }
      }

      // Generate a 32-byte random key
      const key = randomBytes(32).toString('base64');

      // Store in Vault KV v2
      const writeRes = await fetch(`${VAULT_ADDR}/v1/${SECRET_PATH}`, {
        method: 'POST',
        headers: {
          'X-Vault-Token': VAULT_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: { key } }),
      });

      if (!writeRes.ok) {
        const errBody = (await writeRes.text()) || writeRes.statusText;
        return { success: false, message: `Failed to store key in Vault: ${errBody}` };
      }

      return {
        success: true,
        message:
          'Encryption key generated and stored in Vault at hubport/encryption-key. The key is not displayed for security — it will be read from Vault by the application at runtime.',
      };
    } catch (err) {
      return {
        success: false,
        message: `Encryption key generation failed: ${(err as Error).message}`,
      };
    }
  },
};
