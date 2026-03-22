/**
 * HashiCorp Vault client with AppRole authentication.
 * ADR-0083: Vault is the sole runtime secret source for all operational secrets.
 *
 * Auth modes (checked in order):
 *   1. VAULT_TOKEN env var — legacy direct token (backwards compat)
 *   2. VAULT_ROLE_ID + VAULT_SECRET_ID — AppRole login (production)
 *
 * Secret paths (KV v2 under secret/hubport/):
 *   encryption-key   — AES-256 field encryption key
 *   credentials       — KC client secret, Synapse admin/registration secrets
 *   runtime           — mail relay secret, tunnel token
 */

// ── Secret Path Constants ────────────────────────────────────────────

const VAULT_PATHS = {
  encryptionKey: "secret/data/hubport/encryption-key",
  credentials: "secret/data/hubport/credentials",
  runtime: "secret/data/hubport/runtime",
} as const;

let cachedKey: Buffer | null = null;
const secretCache = new Map<string, Record<string, string>>();

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

// ── Generic Secret Reader ────────────────────────────────────────────

/**
 * Reads a KV v2 secret from Vault. Results are cached per path.
 * Falls back to env vars if Vault is not configured (transition period).
 */
async function readSecret(path: string): Promise<Record<string, string>> {
  const cached = secretCache.get(path);
  if (cached) return cached;

  const vaultAddr = process.env.VAULT_ADDR;
  if (!vaultAddr) {
    throw new Error("VAULT_ADDR environment variable is not set");
  }

  const vaultToken = await getVaultToken();
  const url = `${vaultAddr.replace(/\/+$/, "")}/v1/${path}`;

  const response = await fetch(url, {
    headers: { "X-Vault-Token": vaultToken, Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Vault read ${path} failed: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as { data?: { data?: Record<string, string> } };
  const data = body?.data?.data;
  if (!data) {
    throw new Error(`Vault secret at ${path} has no data`);
  }

  secretCache.set(path, data);
  return data;
}

/**
 * Read a single field from a Vault secret, with env var fallback.
 * If Vault read fails and envFallback is provided, returns the env var value.
 * If neither is available, throws.
 */
async function getSecretField(path: string, field: string, envFallback?: string): Promise<string> {
  try {
    const data = await readSecret(path);
    const value = data[field];
    if (value) return value;
  } catch {
    // Vault unavailable — try env fallback
  }

  if (envFallback) {
    const envValue = process.env[envFallback];
    if (envValue) return envValue;
  }

  throw new Error(`Secret ${field} not found in Vault (${path}) or env (${envFallback ?? "none"})`);
}

// ── Operational Secret Getters (ADR-0083) ────────────────────────────

/** Keycloak admin client secret for hub-api service account. */
export async function getKeycloakClientSecret(): Promise<string> {
  return getSecretField(VAULT_PATHS.credentials, "keycloak_client_secret", "KEYCLOAK_ADMIN_CLIENT_SECRET");
}

/** Synapse admin password for Matrix operations. */
export async function getSynapseAdminPassword(): Promise<string> {
  return getSecretField(VAULT_PATHS.credentials, "synapse_admin_password", "SYNAPSE_ADMIN_PASSWORD");
}

/** Synapse registration shared secret for admin user creation. */
export async function getSynapseRegistrationSecret(): Promise<string> {
  return getSecretField(VAULT_PATHS.credentials, "synapse_registration_secret", "SYNAPSE_REGISTRATION_SECRET");
}

/** Mail relay HMAC secret for outbound email authentication. */
export async function getMailRelaySecret(): Promise<string> {
  return getSecretField(VAULT_PATHS.runtime, "mail_relay_secret", "MAIL_RELAY_SECRET");
}

/** Cloudflare tunnel token for ingress. */
export async function getTunnelToken(): Promise<string> {
  return getSecretField(VAULT_PATHS.runtime, "tunnel_token", "CF_TUNNEL_TOKEN");
}

/**
 * Clears all cached secrets and AppRole token.
 * Useful for testing or key rotation.
 */
export function clearKeyCache(): void {
  cachedKey = null;
  tokenCache = null;
  secretCache.clear();
}
