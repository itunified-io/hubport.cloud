import { describe, it, expect } from 'vitest';
import { generateApiToken, hashToken, validateTokenFormat, extractTenantIdHash } from '../tokens.js';

describe('tokens', () => {
  describe('generateApiToken', () => {
    it('generates token with hpt_ prefix', () => {
      const { plaintext } = generateApiToken('tenant-uuid-123');
      expect(plaintext).toMatch(/^hpt_[a-f0-9]{8}_[A-Za-z0-9_-]{43}$/);
    });

    it('generates different tokens each call', () => {
      const t1 = generateApiToken('tenant-uuid-123');
      const t2 = generateApiToken('tenant-uuid-123');
      expect(t1.plaintext).not.toBe(t2.plaintext);
    });

    it('returns hash that differs from plaintext', () => {
      const { plaintext, hash } = generateApiToken('tenant-uuid-123');
      expect(hash).not.toBe(plaintext);
      expect(hash.length).toBe(64); // SHA-256 hex
    });
  });

  describe('hashToken', () => {
    it('produces consistent SHA-256 hex digest', () => {
      const hash1 = hashToken('hpt_abc12345_test');
      const hash2 = hashToken('hpt_abc12345_test');
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
    });
  });

  describe('validateTokenFormat', () => {
    it('accepts valid hpt_ token', () => {
      const { plaintext } = generateApiToken('tenant-id');
      expect(validateTokenFormat(plaintext)).toBe(true);
    });

    it('rejects tokens without hpt_ prefix', () => {
      expect(validateTokenFormat('invalid_token')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(validateTokenFormat('')).toBe(false);
    });
  });

  describe('extractTenantIdHash', () => {
    it('extracts 8-char hash from token', () => {
      const { plaintext } = generateApiToken('tenant-uuid-123');
      const hash = extractTenantIdHash(plaintext);
      expect(hash).toHaveLength(8);
      expect(hash).toMatch(/^[a-f0-9]{8}$/);
    });
  });
});
