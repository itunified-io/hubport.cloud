import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma before importing the module
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    tenantApiToken: {
      findFirst: vi.fn(),
    },
  },
}));

import { extractBearerToken, apiTokenAuth } from '../api-token-auth.js';
import { prisma } from '../../lib/prisma.js';
import { hashToken, generateApiToken } from '../../lib/tokens.js';

// Helper to create mock Fastify request/reply
function mockRequest(authorization?: string): any {
  return { headers: { authorization } };
}

function mockReply(): any {
  const reply: any = {};
  reply.status = vi.fn().mockReturnValue(reply);
  reply.send = vi.fn().mockReturnValue(reply);
  return reply;
}

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

describe('apiTokenAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('attaches tenantId for valid active token', async () => {
    const { plaintext, hash } = generateApiToken('tenant-123');
    const request = mockRequest(`Bearer ${plaintext}`);
    const reply = mockReply();

    (prisma.tenantApiToken.findFirst as any).mockResolvedValueOnce({
      id: 'token-id',
      tenantId: 'tenant-123',
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 86400000),
      revokedAt: null,
    });

    await apiTokenAuth(request, reply);

    expect(reply.status).not.toHaveBeenCalled();
    expect(request.tenantId).toBe('tenant-123');
  });

  it('returns 401 for missing Authorization header', async () => {
    const request = mockRequest(undefined);
    const reply = mockReply();

    await apiTokenAuth(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_token' })
    );
  });

  it('returns 401 for malformed token format', async () => {
    const request = mockRequest('Bearer not-a-valid-token');
    const reply = mockReply();

    await apiTokenAuth(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_token', message: 'Missing or malformed API token' })
    );
  });

  it('returns 401 with token_expired for expired token', async () => {
    const { plaintext } = generateApiToken('tenant-123');
    const request = mockRequest(`Bearer ${plaintext}`);
    const reply = mockReply();

    // First findFirst (active lookup) returns null
    (prisma.tenantApiToken.findFirst as any).mockResolvedValueOnce(null);
    // Second findFirst (grace window lookup) returns null
    (prisma.tenantApiToken.findFirst as any).mockResolvedValueOnce(null);
    // Third findFirst (expired check) returns the expired record
    (prisma.tenantApiToken.findFirst as any).mockResolvedValueOnce({
      id: 'expired-id',
      tenantId: 'tenant-123',
      tokenHash: hashToken(plaintext),
      expiresAt: new Date(Date.now() - 86400000), // expired yesterday
      revokedAt: null,
    });

    await apiTokenAuth(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'token_expired' })
    );
  });

  it('returns 401 for unknown token hash', async () => {
    const { plaintext } = generateApiToken('tenant-123');
    const request = mockRequest(`Bearer ${plaintext}`);
    const reply = mockReply();

    // All findFirst calls return null
    (prisma.tenantApiToken.findFirst as any).mockResolvedValue(null);

    await apiTokenAuth(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_token', message: 'Invalid API token' })
    );
  });

  it('succeeds during rotation grace window', async () => {
    const { plaintext, hash } = generateApiToken('tenant-123');
    const request = mockRequest(`Bearer ${plaintext}`);
    const reply = mockReply();

    // First findFirst (active lookup) returns null
    (prisma.tenantApiToken.findFirst as any).mockResolvedValueOnce(null);
    // Second findFirst (grace window) returns recently revoked token
    (prisma.tenantApiToken.findFirst as any).mockResolvedValueOnce({
      id: 'old-token',
      tenantId: 'tenant-123',
      tokenHash: hash,
      revokedAt: new Date(Date.now() - 30000), // revoked 30s ago (within 60s grace)
    });
    // Third findFirst (replacement lookup) returns new active token
    (prisma.tenantApiToken.findFirst as any).mockResolvedValueOnce({
      id: 'new-token',
      tenantId: 'tenant-123',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
    });

    await apiTokenAuth(request, reply);

    expect(reply.status).not.toHaveBeenCalled();
    expect(request.tenantId).toBe('tenant-123');
  });
});
