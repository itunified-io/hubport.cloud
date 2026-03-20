import { describe, it, expect } from 'vitest';
import { generateSetupCode, validateCodeFormat, SETUP_CODE_ALPHABET } from '../setup-code.js';

describe('generateSetupCode', () => {
  it('returns XXXX-XXXX format', () => {
    const code = generateSetupCode();
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('uses only non-ambiguous characters', () => {
    const ambiguous = ['0', 'O', '1', 'I', 'L'];
    for (let i = 0; i < 100; i++) {
      const code = generateSetupCode();
      for (const ch of ambiguous) {
        expect(code).not.toContain(ch);
      }
    }
  });

  it('generates unique codes', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateSetupCode()));
    expect(codes.size).toBe(100);
  });
});

describe('validateCodeFormat', () => {
  it('accepts valid XXXX-XXXX codes', () => {
    expect(validateCodeFormat('PENZ-4K7M')).toBe(true);
    expect(validateCodeFormat('ABCD-2345')).toBe(true);
  });

  it('rejects invalid formats', () => {
    expect(validateCodeFormat('PENZ4K7M')).toBe(false);
    expect(validateCodeFormat('penz-4k7m')).toBe(false);
    expect(validateCodeFormat('ABCD-EFGH-IJKL')).toBe(false);
    expect(validateCodeFormat('')).toBe(false);
    expect(validateCodeFormat('0OIL-1234')).toBe(false);
  });
});

describe('SETUP_CODE_ALPHABET', () => {
  it('has exactly 31 characters (23 letters + 8 digits, no ambiguous)', () => {
    expect(SETUP_CODE_ALPHABET.length).toBe(31);
  });

  it('excludes ambiguous characters', () => {
    expect(SETUP_CODE_ALPHABET).not.toContain('0');
    expect(SETUP_CODE_ALPHABET).not.toContain('O');
    expect(SETUP_CODE_ALPHABET).not.toContain('1');
    expect(SETUP_CODE_ALPHABET).not.toContain('I');
    expect(SETUP_CODE_ALPHABET).not.toContain('L');
  });
});
