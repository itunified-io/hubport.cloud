/**
 * Client-side AES-256-GCM crypto module for offline data encryption.
 *
 * Encryption key derivation:
 *   HMAC-SHA256(sub, deviceId) → PBKDF2(seed, salt, 100K iter) → AES-256-GCM key
 *
 * Encrypted payload format (base64-encoded):
 *   [12-byte IV][ciphertext+tag]
 */

// ─── Key Derivation ──────────────────────────────────────────────

/**
 * Derives an AES-256-GCM encryption key from user subject, device ID and a
 * server-provided salt.
 *
 * @param sub       - Keycloak subject (user ID)
 * @param deviceId  - Device UUID from localStorage
 * @param saltBase64 - Base64-encoded salt from the server (per-device)
 */
export async function deriveEncryptionKey(
  sub: string,
  deviceId: string,
  saltBase64: string,
): Promise<CryptoKey> {
  const enc = new TextEncoder();

  // Step 1: HMAC-SHA256(key=sub, data=deviceId) → raw seed bytes
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(sub),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const seedBuffer = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    enc.encode(deviceId),
  );

  // Step 2: Import seed as PBKDF2 base key
  const pbkdf2Key = await crypto.subtle.importKey(
    "raw",
    seedBuffer,
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  // Step 3: Decode salt from base64
  const saltBytes = base64ToUint8Array(saltBase64);
  // Ensure we have a plain ArrayBuffer (not SharedArrayBuffer) for SubtleCrypto
  const saltBuffer = saltBytes.buffer.slice(
    saltBytes.byteOffset,
    saltBytes.byteOffset + saltBytes.byteLength,
  ) as ArrayBuffer;

  // Step 4: Derive AES-256-GCM key via PBKDF2 (100K iterations)
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations: 100_000,
      hash: "SHA-256",
    },
    pbkdf2Key,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ─── Field-level encrypt / decrypt ──────────────────────────────

/**
 * Encrypts a plaintext string with AES-256-GCM.
 * Returns a base64 string encoding: [12-byte IV][ciphertext+tag].
 */
export async function encryptField(
  key: CryptoKey,
  plaintext: string,
): Promise<string> {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext),
  );

  // Combine IV + ciphertext (includes GCM auth tag)
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);

  return uint8ArrayToBase64(combined);
}

/**
 * Decrypts a base64-encoded AES-256-GCM payload back to plaintext.
 * Expects the format produced by encryptField: [12-byte IV][ciphertext+tag].
 */
export async function decryptField(
  key: CryptoKey,
  encrypted: string,
): Promise<string> {
  const combined = base64ToUint8Array(encrypted);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(plainBuffer);
}

// ─── Object-level helpers ────────────────────────────────────────

/**
 * Encrypt specified fields in an object in-place.
 * Object-type field values are JSON.stringified before encryption.
 *
 * @param key        - AES-256-GCM CryptoKey
 * @param obj        - The object to encrypt fields in (mutated copy returned)
 * @param fieldNames - Names of fields to encrypt
 */
export async function encryptFields<T extends Record<string, unknown>>(
  key: CryptoKey,
  obj: T,
  fieldNames: (keyof T)[],
): Promise<T> {
  const result = { ...obj };
  for (const field of fieldNames) {
    const value = result[field];
    if (value === null || value === undefined) continue;
    const plaintext =
      typeof value === "string" ? value : JSON.stringify(value);
    (result as Record<string, unknown>)[field as string] = await encryptField(
      key,
      plaintext,
    );
  }
  return result;
}

/**
 * Decrypt specified fields in an object in-place.
 *
 * @param key         - AES-256-GCM CryptoKey
 * @param obj         - The object with encrypted fields
 * @param fieldNames  - Names of fields to decrypt
 * @param jsonFields  - Subset of fieldNames whose decrypted value should be JSON.parsed
 */
export async function decryptFields<T extends Record<string, unknown>>(
  key: CryptoKey,
  obj: T,
  fieldNames: (keyof T)[],
  jsonFields?: (keyof T)[],
): Promise<T> {
  const result = { ...obj };
  for (const field of fieldNames) {
    const value = result[field];
    if (value === null || value === undefined || typeof value !== "string")
      continue;
    const plaintext = await decryptField(key, value);
    const isJson = jsonFields?.includes(field);
    (result as Record<string, unknown>)[field as string] = isJson
      ? (JSON.parse(plaintext) as unknown)
      : plaintext;
  }
  return result;
}

// ─── Base64 helpers ──────────────────────────────────────────────

/**
 * Convert Uint8Array to base64 string.
 * Uses a loop (not spread) to avoid stack overflow on large payloads.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary);
}

/** Convert base64 string to Uint8Array. */
function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
