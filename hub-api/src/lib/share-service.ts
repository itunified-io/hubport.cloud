/**
 * Territory share link service — code generation, hashing, and verification.
 *
 * Share codes are 22-char base64url tokens. All stored values are SHA-256
 * hashes salted with environment-specific pepper values. PIN verification
 * uses constant-time comparison to prevent timing attacks.
 */
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import prisma from "./prisma.js";

function requirePepper(name: string): string {
  const val = process.env[name];
  if (!val && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return val || `dev-${name}-not-for-production`;
}

const SHARE_CODE_PEPPER = requirePepper('SHARE_CODE_PEPPER');
const SHARE_PIN_PEPPER = requirePepper('SHARE_PIN_PEPPER');

/** Max PIN attempts before auto-revoke. */
const MAX_PIN_ATTEMPTS = 5;

/** Generate a cryptographically random 22-char base64url share code. */
export function generateCode(): string {
  return randomBytes(16).toString("base64url");
}

/** SHA-256 hash a share code with pepper. */
export function hashCode(code: string): string {
  return createHash("sha256").update(code + SHARE_CODE_PEPPER).digest("hex");
}

/** SHA-256 hash a PIN with pepper. */
export function hashPin(pin: string): string {
  return createHash("sha256").update(pin + SHARE_PIN_PEPPER).digest("hex");
}

/** Constant-time comparison of a plaintext code against a stored hash. */
export function verifyCode(code: string, storedHash: string): boolean {
  const candidateHash = hashCode(code);
  const a = Buffer.from(candidateHash, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Constant-time comparison of a plaintext PIN against a stored hash. */
export function verifyPin(pin: string, storedHash: string): boolean {
  const candidateHash = hashPin(pin);
  const a = Buffer.from(candidateHash, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Check whether a share has expired. */
export function checkExpiration(share: { expiresAt: Date }): boolean {
  return share.expiresAt < new Date();
}

/** Hash an IP address for logging (privacy-preserving). */
export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}

/**
 * Increment PIN attempts for a share. Auto-revokes at MAX_PIN_ATTEMPTS.
 * Returns the updated attempt count.
 */
export async function incrementPinAttempts(shareId: string): Promise<number> {
  const updated = await prisma.territoryShare.update({
    where: { id: shareId },
    data: { pinAttempts: { increment: 1 } },
  });

  if (updated.pinAttempts >= MAX_PIN_ATTEMPTS) {
    await prisma.territoryShare.update({
      where: { id: shareId },
      data: { isActive: false, revokedAt: new Date() },
    });
  }

  return updated.pinAttempts;
}
