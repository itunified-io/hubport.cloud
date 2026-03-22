/**
 * Prisma client extension for central-api field-level encryption.
 * Encrypts PII and operational secrets using AES-256-GCM.
 *
 * ADR-0082: All PII and operational secrets must be encrypted at rest.
 */

import { Prisma } from '@prisma/client';
import { encryptToken, decryptToken } from './crypto.js';

/** Model → fields requiring encryption. */
const ENCRYPTION_MAP: Record<string, readonly string[]> = {
  Tenant: ['email', 'ownerFirstName', 'ownerLastName', 'tunnelToken'],
  TenantAuth: ['totpSecret'],
} as const;

function getEncryptedFields(model: string | undefined): readonly string[] | null {
  if (!model) return null;
  return ENCRYPTION_MAP[model] ?? null;
}

function encryptFields(data: Record<string, unknown>, fields: readonly string[]): void {
  for (const field of fields) {
    const value = data[field];
    if (typeof value === 'string' && value.length > 0) {
      data[field] = encryptToken(value);
    }
  }
}

function decryptRecord(record: Record<string, unknown>, fields: readonly string[]): void {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.length > 0) {
      try {
        record[field] = decryptToken(value);
      } catch {
        // Legacy unencrypted value — leave as-is during migration period
      }
    }
  }
}

function decryptResult(result: unknown, fields: readonly string[]): void {
  if (result == null) return;
  if (Array.isArray(result)) {
    for (const record of result) {
      if (record && typeof record === 'object') {
        decryptRecord(record as Record<string, unknown>, fields);
      }
    }
  } else if (typeof result === 'object') {
    decryptRecord(result as Record<string, unknown>, fields);
  }
}

const WRITE_ACTIONS = ['create', 'update', 'upsert', 'createMany', 'updateMany'];
const READ_ACTIONS = ['findUnique', 'findFirst', 'findMany'];

export const encryptionExtension = Prisma.defineExtension({
  name: 'central-api-field-encryption',
  query: {
    $allOperations: async ({ model, operation, args, query }) => {
      const fields = getEncryptedFields(model);
      if (!fields) return query(args);

      // Encrypt before write
      if (WRITE_ACTIONS.includes(operation)) {
        const data = (args as Record<string, unknown>).data;
        if (data && typeof data === 'object') {
          if (Array.isArray(data)) {
            for (const item of data) {
              encryptFields(item as Record<string, unknown>, fields);
            }
          } else {
            encryptFields(data as Record<string, unknown>, fields);
          }
        }
      }

      const result = await query(args);

      // Decrypt after read or write
      if (READ_ACTIONS.includes(operation) || WRITE_ACTIONS.includes(operation)) {
        decryptResult(result, fields);
      }

      return result;
    },
  },
});
