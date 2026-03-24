import { SignJWT, jwtVerify } from 'jose';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';

const JWT_SECRET_KEY = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required — refusing to start with default');
  }
  return new TextEncoder().encode(secret);
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

export async function createAccessToken(payload: { tenantId: string; email: string }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setSubject(payload.tenantId)
    .sign(JWT_SECRET_KEY());
}

export async function createRefreshToken(payload: { tenantId: string }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .setSubject(payload.tenantId)
    .sign(JWT_SECRET_KEY());
}

export async function verifyToken(token: string): Promise<{ tenantId: string; email?: string } | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET_KEY());
    return {
      tenantId: payload.sub as string,
      email: (payload as Record<string, unknown>).email as string | undefined,
    };
  } catch {
    return null;
  }
}

export function generateSetupToken(): string {
  return randomUUID();
}

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption key — exactly 32 bytes, base64-encoded in env var.
 *
 * Generate: `python3 -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())"`
 * Result:   44-char base64 string (e.g., "K7gNU3sdo+OL0wNhqoVWhr3g6s1xYv72ol/pe/Unols=")
 *
 * Stored in Vault at `kv/hubport-cloud/{env}/central-api` → ESO syncs to K8s Secret.
 * MUST be base64-encoded 32 bytes — NOT hex-encoded (64 chars hex = 48 bytes after b64 decode = crash).
 */
const ENCRYPTION_KEY = () => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required — refusing to run without encryption');
  }
  const buf = Buffer.from(key, 'base64');
  if (buf.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be exactly 32 bytes (base64-encoded). Got ${buf.length} bytes. ` +
      `Generate with: python3 -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())"`,
    );
  }
  return buf;
};

export function encryptToken(plaintext: string): string {
  const key = ENCRYPTION_KEY();

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: base64(iv + authTag + encrypted)
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptToken(ciphertext: string): string {
  const key = ENCRYPTION_KEY();

  try {
    const data = Buffer.from(ciphertext, 'base64');
    const iv = data.subarray(0, 12);
    const authTag = data.subarray(12, 28);
    const encrypted = data.subarray(28);

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    // If decryption fails, assume plaintext (migration period)
    return ciphertext;
  }
}
