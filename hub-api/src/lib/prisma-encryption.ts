/**
 * Prisma middleware that transparently encrypts/decrypts
 * personal data fields on the Publisher model using AES-256-GCM.
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

type EncryptedField = (typeof ENCRYPTED_FIELDS)[number];

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
 * Returns a Prisma middleware function that handles transparent
 * field-level encryption for personal data.
 */
export function encryptionMiddleware(): Prisma.Middleware {
  return async (
    params: Prisma.MiddlewareParams,
    next: (params: Prisma.MiddlewareParams) => Promise<unknown>,
  ): Promise<unknown> => {
    if (!isEncryptedModel(params.model)) {
      return next(params);
    }

    // --- Encrypt before write ---
    if (WRITE_ACTIONS.includes(params.action)) {
      if (params.args.data) {
        await encryptFields(params.args.data as Record<string, unknown>);
      }
      // createMany uses an array
      if (Array.isArray(params.args.data)) {
        for (const item of params.args.data) {
          await encryptFields(item as Record<string, unknown>);
        }
      }
    }

    const result = await next(params);

    // --- Decrypt after read ---
    if (READ_ACTIONS.includes(params.action)) {
      await decryptResult(result);
    }

    // Also decrypt after write so the returned object is plaintext
    if (WRITE_ACTIONS.includes(params.action)) {
      await decryptResult(result);
    }

    return result;
  };
}
