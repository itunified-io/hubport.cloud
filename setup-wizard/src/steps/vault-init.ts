import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { WizardStep, StepStatus, StepResult } from './types.js';

const execFileAsync = promisify(execFile);

const VAULT_ADDR = process.env.VAULT_ADDR || 'http://vault:8200';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://hubport:hubport@postgres:5432/hubport';

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
      const healthRes = await fetch(`${VAULT_ADDR}/v1/sys/health`, { signal: AbortSignal.timeout(3000) });
      const health = await healthRes.json() as { initialized: boolean; sealed: boolean };

      if (health.initialized && !health.sealed) {
        return { success: true, message: 'Vault is already initialized and unsealed.' };
      }

      if (health.initialized && health.sealed) {
        return {
          success: false,
          message: 'Vault is initialized but sealed. Please provide the unseal key.',
        };
      }

      // Initialize with 1 key, threshold 1 (simple for self-hosted)
      const initRes = await fetch(`${VAULT_ADDR}/v1/sys/init`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret_shares: 1, secret_threshold: 1 }),
      });

      if (!initRes.ok) {
        return { success: false, message: `Vault init API returned ${initRes.status}` };
      }

      const init = await initRes.json() as { keys: string[]; root_token: string };

      // Return hard-stop: user MUST save credentials before we proceed
      return {
        success: true,
        message: 'Vault initialized. Save credentials below before continuing.',
        hardStop: {
          unsealKey: init.keys[0]!,
          rootToken: init.root_token,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (err) {
      return { success: false, message: `Vault init failed: ${(err as Error).message}` };
    }
  },
};

/**
 * Second-phase handler for POST /step/3/confirm.
 * Called after the user confirms they saved the credentials.
 * Unseals Vault, enables KV v2, generates a PG password, and stores it.
 */
export async function vaultConfirmHandler(body: Record<string, string>): Promise<StepResult> {
  const unsealKey = body.unsealKey;
  const rootToken = body.rootToken;

  if (!unsealKey || !rootToken) {
    return { success: false, message: 'Missing unseal key or root token. Go back and re-run Step 3.' };
  }

  try {
    // 1. Unseal Vault
    const unsealRes = await fetch(`${VAULT_ADDR}/v1/sys/unseal`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: unsealKey }),
    });

    if (!unsealRes.ok) {
      return { success: false, message: `Vault unseal failed: HTTP ${unsealRes.status}` };
    }

    const unsealData = await unsealRes.json() as { sealed: boolean };
    if (unsealData.sealed) {
      return { success: false, message: 'Vault is still sealed after unseal attempt. Check the unseal key.' };
    }

    // 2. Enable KV v2 secrets engine
    const mountRes = await fetch(`${VAULT_ADDR}/v1/sys/mounts/secret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Vault-Token': rootToken },
      body: JSON.stringify({ type: 'kv', options: { version: '2' } }),
    });

    // 400 = already mounted — that is fine
    if (!mountRes.ok && mountRes.status !== 400) {
      return { success: false, message: `KV engine mount failed: HTTP ${mountRes.status}` };
    }

    // 3. Generate a secure Postgres password
    const pgPassword = randomBytes(24).toString('base64url');

    // 4. Store in Vault at secret/data/hubport/postgres
    const storeRes = await fetch(`${VAULT_ADDR}/v1/secret/data/hubport/postgres`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Vault-Token': rootToken },
      body: JSON.stringify({ data: { username: 'hubport', password: pgPassword } }),
    });

    if (!storeRes.ok) {
      return { success: false, message: `Failed to store PG credentials in Vault: HTTP ${storeRes.status}` };
    }

    // 5. Connect to Postgres and ALTER USER password
    const pgUrl = new URL(DATABASE_URL);
    const pgHost = pgUrl.hostname;
    const pgPort = pgUrl.port || '5432';
    const pgUser = pgUrl.username;
    const pgDb = pgUrl.pathname.slice(1);

    try {
      await execFileAsync('psql', [
        '-h', pgHost,
        '-p', pgPort,
        '-U', pgUser,
        '-d', pgDb,
        '-c', `ALTER USER hubport PASSWORD '${pgPassword.replace(/'/g, "''")}'`,
      ], {
        timeout: 10_000,
        env: { ...process.env, PGPASSWORD: pgUrl.password },
      });
    } catch (pgErr) {
      return {
        success: false,
        message: `Vault configured but ALTER USER failed: ${(pgErr as Error).message}. The password is stored in Vault but Postgres still uses the old password.`,
      };
    }

    // 6. Generate encryption key and store in Vault
    const encryptionKey = randomBytes(32).toString('base64');

    const encKeyRes = await fetch(`${VAULT_ADDR}/v1/secret/data/hubport/encryption-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Vault-Token': rootToken },
      body: JSON.stringify({ data: { key: encryptionKey } }),
    });

    if (!encKeyRes.ok) {
      return {
        success: false,
        message: `PG password rotated but encryption key storage failed: HTTP ${encKeyRes.status}`,
      };
    }

    return {
      success: true,
      message: 'Vault initialized. Database password and encryption key secured in Vault.',
      encryptionKeyDownload: {
        key: encryptionKey,
        generatedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    return { success: false, message: `Vault confirm failed: ${(err as Error).message}` };
  }
}
