import type { WizardStep, StepStatus, StepResult } from './types.js';

const VAULT_ADDR = process.env.VAULT_ADDR || 'http://vault:8200';

export const vaultStep: WizardStep = {
  number: 3,
  id: 'vault-init',
  title: 'Vault Initialization',
  description: 'Initialize HashiCorp Vault, generate unseal keys, and enable the KV secrets engine. IMPORTANT: Save the unseal keys — they cannot be retrieved later.',
  optional: false,

  async check(): Promise<StepStatus> {
    try {
      const res = await fetch(`${VAULT_ADDR}/v1/sys/health`, { signal: AbortSignal.timeout(3000) });
      const health = await res.json() as { initialized: boolean; sealed: boolean };
      return {
        completed: health.initialized && !health.sealed,
        details: { initialized: String(health.initialized), sealed: String(health.sealed) },
      };
    } catch {
      return { completed: false, details: { status: 'unreachable' } };
    }
  },

  async execute(): Promise<StepResult> {
    try {
      // Check if already initialized
      const healthRes = await fetch(`${VAULT_ADDR}/v1/sys/health`, { signal: AbortSignal.timeout(3000) });
      const health = await healthRes.json() as { initialized: boolean; sealed: boolean };

      if (health.initialized && !health.sealed) {
        return { success: true, message: 'Vault is already initialized and unsealed.' };
      }

      if (!health.initialized) {
        // Initialize with 1 key, threshold 1 (simple for self-hosted)
        const initRes = await fetch(`${VAULT_ADDR}/v1/sys/init`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret_shares: 1, secret_threshold: 1 }),
        });
        const init = await initRes.json() as { keys: string[]; root_token: string };

        // Unseal
        await fetch(`${VAULT_ADDR}/v1/sys/unseal`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: init.keys[0] }),
        });

        // Enable KV v2
        await fetch(`${VAULT_ADDR}/v1/sys/mounts/secret`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Vault-Token': init.root_token },
          body: JSON.stringify({ type: 'kv', options: { version: '2' } }),
        });

        return {
          success: true,
          message: 'Vault initialized, unsealed, and KV engine enabled. SAVE THESE CREDENTIALS NOW.',
          credentials: {
            unseal_key: init.keys[0]!,
            root_token: init.root_token,
          },
          warnings: [
            'Store the unseal key and root token in a safe place.',
            'If you lose the unseal key, you will not be able to unseal Vault after a restart.',
            'The root token should be revoked after creating a proper auth method.',
          ],
        };
      }

      // Initialized but sealed — unseal
      return {
        success: false,
        message: 'Vault is initialized but sealed. Please provide the unseal key.',
      };
    } catch (err) {
      return { success: false, message: `Vault init failed: ${(err as Error).message}` };
    }
  },
};
