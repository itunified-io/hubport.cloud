/**
 * Minimal HashiCorp Vault KV v2 client.
 * Reads the tenant encryption key from Vault and caches it in memory.
 */

const VAULT_SECRET_PATH = "secret/data/hubport/encryption-key";

let cachedKey: Buffer | null = null;

/**
 * Fetches the AES-256 encryption key from Vault KV v2.
 * The key is cached after the first successful read.
 *
 * Required env vars:
 *   - VAULT_ADDR  — e.g. "https://vault.hubport.cloud"
 *   - VAULT_TOKEN — a valid Vault token with read access to the secret path
 */
export async function getEncryptionKey(): Promise<Buffer> {
  if (cachedKey) {
    return cachedKey;
  }

  const vaultAddr = process.env.VAULT_ADDR;
  const vaultToken = process.env.VAULT_TOKEN;

  if (!vaultAddr) {
    throw new Error("VAULT_ADDR environment variable is not set");
  }
  if (!vaultToken) {
    throw new Error("VAULT_TOKEN environment variable is not set");
  }

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
 * Clears the cached encryption key. Useful for testing or key rotation.
 */
export function clearKeyCache(): void {
  cachedKey = null;
}
