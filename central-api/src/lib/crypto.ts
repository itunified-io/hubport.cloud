import { SignJWT, jwtVerify } from 'jose';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';

const JWT_SECRET_KEY = () => {
  const secret = process.env.JWT_SECRET || 'dev-secret-change-in-production';
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

const ENCRYPTION_KEY = () => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) return null;
  return Buffer.from(key, 'base64');
};

export function encryptToken(plaintext: string): string {
  const key = ENCRYPTION_KEY();
  if (!key) return plaintext; // fallback: no encryption in dev

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: base64(iv + authTag + encrypted)
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptToken(ciphertext: string): string {
  const key = ENCRYPTION_KEY();
  if (!key) return ciphertext; // fallback: no encryption in dev

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
