import { randomInt } from 'node:crypto';

export const SETUP_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const CODE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function generateSetupCode(): string {
  const half = (len: number) =>
    Array.from({ length: len }, () =>
      SETUP_CODE_ALPHABET[randomInt(SETUP_CODE_ALPHABET.length)]
    ).join('');
  return `${half(CODE_LENGTH)}-${half(CODE_LENGTH)}`;
}

const VALID_PATTERN = new RegExp(
  `^[${SETUP_CODE_ALPHABET}]{4}-[${SETUP_CODE_ALPHABET}]{4}$`
);

export function validateCodeFormat(code: string): boolean {
  return VALID_PATTERN.test(code);
}

export function getCodeExpiresAt(): Date {
  return new Date(Date.now() + CODE_TTL_MS);
}

export const SETUP_CODE_TTL_MS = CODE_TTL_MS;
