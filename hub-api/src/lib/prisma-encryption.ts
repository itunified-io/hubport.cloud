/**
 * Prisma client extension that transparently encrypts/decrypts
 * personal data fields on the Publisher model using AES-256-GCM.
 *
 * Replaces deprecated $use middleware (removed in Prisma v6).
 */

import { Prisma } from "@prisma/client";
import { encrypt, decrypt } from "./crypto.js";
import { getEncryptionKey } from "./vault-client.js";

/** Publisher fields that contain personal data and must be encrypted at rest. */
const ENCRYPTED_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
] as const;

/** Models whose data is subject to field-level encryption. */
const ENCRYPTED_MODELS = ["Publisher"] as const;

function isEncryptedModel(model: string | undefined): boolean {
  return ENCRYPTED_MODELS.includes(model as (typeof ENCRYPTED_MODELS)[number]);
}

/**
 * Encrypts the designated fields in a data object (mutates in place).
 */
async function encryptFields(
  data: Record<string, unknown>,
): Promise<void> {
  const key = await getEncryptionKey();

  for (const field of ENCRYPTED_FIELDS) {
    const value = data[field];
    if (typeof value === "string") {
      data[field] = encrypt(value, key);
    }
  }
}

/**
 * Decrypts the designated fields on a single record (mutates in place).
 */
async function decryptRecord(
  record: Record<string, unknown>,
): Promise<void> {
  const key = await getEncryptionKey();

  for (const field of ENCRYPTED_FIELDS) {
    const value = record[field];
    if (typeof value === "string" && value.includes(":")) {
      try {
        record[field] = decrypt(value, key);
      } catch {
        // If decryption fails the value is likely not encrypted (e.g. legacy
        // data written before encryption was enabled). Leave it as-is.
      }
    }
  }
}

/**
 * Decrypts fields on the query result, handling single records, arrays, and null.
 */
async function decryptResult(result: unknown): Promise<void> {
  if (result == null) return;

  if (Array.isArray(result)) {
    for (const record of result) {
      if (record && typeof record === "object") {
        await decryptRecord(record as Record<string, unknown>);
      }
    }
  } else if (typeof result === "object") {
    await decryptRecord(result as Record<string, unknown>);
  }
}

/** Actions that write data and therefore need encryption before the DB call. */
const WRITE_ACTIONS = ["create", "update", "upsert", "createMany", "updateMany"];

/** Actions that read data and therefore need decryption after the DB call. */
const READ_ACTIONS = ["findUnique", "findFirst", "findMany"];

/**
 * Returns a Prisma client extension that handles transparent
 * field-level encryption for personal data.
 */
export const encryptionExtension = Prisma.defineExtension({
  name: "field-encryption",
  query: {
    $allOperations: async ({ model, operation, args, query }) => {
      if (!isEncryptedModel(model)) {
        return query(args);
      }

      // --- Encrypt before write ---
      if (WRITE_ACTIONS.includes(operation)) {
        const data = (args as Record<string, unknown>).data;
        if (data && typeof data === "object") {
          if (Array.isArray(data)) {
            for (const item of data) {
              await encryptFields(item as Record<string, unknown>);
            }
          } else {
            await encryptFields(data as Record<string, unknown>);
          }
        }
      }

      const result = await query(args);

      // --- Decrypt after read or write (so returned object is plaintext) ---
      if (READ_ACTIONS.includes(operation) || WRITE_ACTIONS.includes(operation)) {
        await decryptResult(result);
      }

      return result;
    },
  },
});
