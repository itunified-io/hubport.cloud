import { createHash, randomBytes } from 'node:crypto';

/**
 * Generate a new M2M API token for a tenant.
 * Format: hpt_<8-char-sha256-of-tenant-id>_<32-byte-random-base64url>
 */
export function generateApiToken(tenantId: string): { plaintext: string; hash: string } {
  const tenantIdHash = createHash('sha256').update(tenantId).digest('hex').slice(0, 8);
  const random = randomBytes(32).toString('base64url'); // 32 bytes → 43 chars base64url (no padding)
  const plaintext = `hpt_${tenantIdHash}_${random}`;
  const hash = hashToken(plaintext);
  return { plaintext, hash };
}

/** SHA-256 hash a plaintext token for storage. */
export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/** Validate token format: hpt_<8hex>_<43base64url>. */
export function validateTokenFormat(token: string): boolean {
  return /^hpt_[a-f0-9]{8}_[A-Za-z0-9_-]{43}$/.test(token);
}

/** Extract the 8-char tenant ID hash from a token. Used by token routes (Phase 2). */
export function extractTenantIdHash(token: string): string {
  return token.split('_')[1] ?? '';
}

/** Token expiry duration in milliseconds (14 days). */
export const TOKEN_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000;

/** Grace window for concurrent rotation (60 seconds). */
export const ROTATION_GRACE_MS = 60 * 1000;
