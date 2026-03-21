/**
 * HashiCorp Vault client with AppRole authentication.
 * Reads the tenant encryption key from Vault KV v2 and caches it in memory.
 *
 * Auth modes (checked in order):
 *   1. VAULT_TOKEN env var — legacy direct token (backwards compat)
 *   2. VAULT_ROLE_ID + VAULT_SECRET_ID — AppRole login (production)
 */

const VAULT_SECRET_PATH = "secret/data/hubport/encryption-key";

let cachedKey: Buffer | null = null;

// ── AppRole Token Cache ──────────────────────────────────────────────

interface VaultTokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: VaultTokenCache | null = null;

/**
 * Authenticates to Vault and returns a client token.
 * Supports legacy VAULT_TOKEN (direct) and AppRole (role_id + secret_id).
 * AppRole tokens are cached and auto-renewed 30s before expiry.
 */
async function getVaultToken(): Promise<string> {
  // Legacy: if VAULT_TOKEN is set, use it directly
  const legacyToken = process.env.VAULT_TOKEN;
  if (legacyToken) return legacyToken;

  // Check AppRole token cache (renew 30s before expiry)
  if (tokenCache && Date.now() < tokenCache.expiresAt - 30_000) {
    return tokenCache.token;
  }

  const vaultAddr = process.env.VAULT_ADDR;
  const roleId = process.env.VAULT_ROLE_ID;
  const secretId = process.env.VAULT_SECRET_ID;

  if (!vaultAddr || !roleId || !secretId) {
    throw new Error(
      "Missing Vault env: VAULT_ADDR + VAULT_ROLE_ID + VAULT_SECRET_ID (or VAULT_TOKEN for legacy)",
    );
  }

  const url = `${vaultAddr.replace(/\/+$/, "")}/v1/auth/approle/login`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role_id: roleId, secret_id: secretId }),
  });

  if (!response.ok) {
    throw new Error(
      `Vault AppRole login failed: ${response.status} ${response.statusText}`,
    );
  }

  const body = (await response.json()) as {
    auth?: { client_token?: string; lease_duration?: number };
  };

  const token = body?.auth?.client_token;
  const leaseDuration = body?.auth?.lease_duration ?? 3600;

  if (!token) {
    throw new Error("Vault AppRole login response missing client_token");
  }

  tokenCache = {
    token,
    expiresAt: Date.now() + leaseDuration * 1000,
  };

  return token;
}

// ── Encryption Key ───────────────────────────────────────────────────

/**
 * Fetches the AES-256 encryption key from Vault KV v2.
 * The key is cached after the first successful read.
 */
export async function getEncryptionKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;

  const vaultAddr = process.env.VAULT_ADDR;
  if (!vaultAddr) {
    throw new Error("VAULT_ADDR environment variable is not set");
  }

  const vaultToken = await getVaultToken();
  const url = `${vaultAddr.replace(/\/+$/, "")}/v1/${VAULT_SECRET_PATH}`;

  const response = await fetch(url, {
    headers: {
      "X-Vault-Token": vaultToken,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Vault read failed: ${response.status} ${response.statusText}`,
    );
  }

  const body = (await response.json()) as {
    data?: { data?: { key?: string } };
  };

  const keyHex = body?.data?.data?.key;
  if (!keyHex) {
    throw new Error(
      `Vault secret at ${VAULT_SECRET_PATH} is missing the "key" field`,
    );
  }

  const keyBuffer = Buffer.from(keyHex, "hex");
  if (keyBuffer.length !== 32) {
    throw new Error(
      `Encryption key must be 32 bytes (AES-256), got ${keyBuffer.length}`,
    );
  }

  cachedKey = keyBuffer;
  return cachedKey;
}

/**
 * Clears cached encryption key and AppRole token.
 * Useful for testing or key rotation.
 */
export function clearKeyCache(): void {
  cachedKey = null;
  tokenCache = null;
}
