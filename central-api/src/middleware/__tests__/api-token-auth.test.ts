import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma before importing the module
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    tenantApiToken: {
      findFirst: vi.fn(),
    },
  },
}));

import { extractBearerToken } from '../api-token-auth.js';

describe('extractBearerToken', () => {
  it('extracts token from Bearer header', () => {
    expect(extractBearerToken('Bearer hpt_abc12345_token')).toBe('hpt_abc12345_token');
  });

  it('returns null for missing header', () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it('returns null for non-Bearer scheme', () => {
    expect(extractBearerToken('Basic abc123')).toBeNull();
  });

  it('returns null for empty Bearer value', () => {
    expect(extractBearerToken('Bearer ')).toBeNull();
  });
});
