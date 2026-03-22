/**
 * API token rotation job — reads/writes runtime token via Vault.
 * ADR-0083: Vault as sole runtime secret source (no file-based storage).
 * Falls back to env var / file during transition period.
 */

const CENTRAL_API_URL = process.env.CENTRAL_API_URL || 'https://api.hubport.cloud';
const ROTATION_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const ROTATION_THRESHOLD_DAYS = 3;

const VAULT_ADDR = process.env.VAULT_ADDR;
const VAULT_TOKEN_PATH = 'secret/data/hubport/runtime';

async function getVaultToken(): Promise<string | null> {
  const roleId = process.env.VAULT_ROLE_ID;
  const secretId = process.env.VAULT_SECRET_ID;
  if (!VAULT_ADDR || !roleId || !secretId) return null;

  try {
    const res = await fetch(`${VAULT_ADDR.replace(/\/+$/, '')}/v1/auth/approle/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role_id: roleId, secret_id: secretId }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { auth?: { client_token?: string } };
    return body?.auth?.client_token ?? null;
  } catch {
    return null;
  }
}

async function readToken(): Promise<string | null> {
  // Try Vault first
  const vaultToken = await getVaultToken();
  if (vaultToken && VAULT_ADDR) {
    try {
      const res = await fetch(`${VAULT_ADDR.replace(/\/+$/, '')}/v1/${VAULT_TOKEN_PATH}`, {
        headers: { 'X-Vault-Token': vaultToken, Accept: 'application/json' },
      });
      if (res.ok) {
        const body = (await res.json()) as { data?: { data?: { api_token?: string } } };
        const token = body?.data?.data?.api_token;
        if (token) return token;
      }
    } catch {
      // Fall through to env var
    }
  }

  // Fallback: env var
  return process.env.HUBPORT_API_TOKEN ?? null;
}

async function storeToken(token: string): Promise<void> {
  const vaultToken = await getVaultToken();
  if (!vaultToken || !VAULT_ADDR) {
    throw new Error('[token-rotation] Cannot store token — Vault not available');
  }

  // Read existing runtime secrets, merge in new api_token
  let existing: Record<string, string> = {};
  try {
    const res = await fetch(`${VAULT_ADDR.replace(/\/+$/, '')}/v1/${VAULT_TOKEN_PATH}`, {
      headers: { 'X-Vault-Token': vaultToken, Accept: 'application/json' },
    });
    if (res.ok) {
      const body = (await res.json()) as { data?: { data?: Record<string, string> } };
      existing = body?.data?.data ?? {};
    }
  } catch {
    // Start fresh
  }

  const writeRes = await fetch(`${VAULT_ADDR.replace(/\/+$/, '')}/v1/secret/data/hubport/runtime`, {
    method: 'POST',
    headers: { 'X-Vault-Token': vaultToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { ...existing, api_token: token } }),
  });

  if (!writeRes.ok) {
    throw new Error(`[token-rotation] Vault write failed: ${writeRes.status}`);
  }
}

async function checkAndRotate(log: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void }): Promise<void> {
  const token = await readToken();
  if (!token) {
    log.info('[token-rotation] No API token found — wizard may not have completed yet');
    return;
  }
  try {
    const infoRes = await fetch(`${CENTRAL_API_URL}/api/v1/tokens/info`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!infoRes.ok) {
      log.warn(`[token-rotation] Token check failed: ${infoRes.status}`);
      return;
    }
    const { daysUntilExpiry } = await infoRes.json() as { daysUntilExpiry: number };
    log.info(`[token-rotation] Token expires in ${daysUntilExpiry} days`);
    if (daysUntilExpiry <= ROTATION_THRESHOLD_DAYS) {
      log.info('[token-rotation] Rotating token...');
      const rotateRes = await fetch(`${CENTRAL_API_URL}/api/v1/tokens/rotate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (rotateRes.ok) {
        const { token: newToken } = await rotateRes.json() as { token: string };
        await storeToken(newToken);
        log.info('[token-rotation] Token rotated and stored in Vault');
      } else {
        log.error(`[token-rotation] Rotation failed: ${rotateRes.status}`);
      }
    }
  } catch (error) {
    log.warn(`[token-rotation] Check failed: ${error instanceof Error ? error.message : 'unknown'}`);
  }
}

export function startTokenRotationJob(log: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void }): void {
  checkAndRotate(log).catch((e) => log.error(`[token-rotation] Startup check failed: ${e}`));
  setInterval(() => {
    checkAndRotate(log).catch((e) => log.error(`[token-rotation] Scheduled check failed: ${e}`));
  }, ROTATION_INTERVAL_MS);
  log.info(`[token-rotation] Job started (interval: ${ROTATION_INTERVAL_MS / 3600000}h, threshold: ${ROTATION_THRESHOLD_DAYS}d)`);
}
