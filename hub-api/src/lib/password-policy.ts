/**
 * Password policy validation.
 * ADR-0077: 12+ chars, upper, lower, digit, special, not username, not common.
 */

/** Top common passwords — reject these outright. */
const COMMON_PASSWORDS = new Set([
  "password",
  "123456",
  "12345678",
  "qwerty",
  "abc123",
  "monkey",
  "master",
  "dragon",
  "111111",
  "baseball",
  "iloveyou",
  "trustno1",
  "sunshine",
  "letmein",
  "welcome",
  "shadow",
  "superman",
  "michael",
  "football",
  "password1",
  "password123",
  "admin",
  "admin123",
  "root",
  "toor",
  "changeme",
  "passw0rd",
  "1234567890",
  "000000",
  "654321",
  "123123",
]);

export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
  checks: {
    minLength: boolean;
    hasUpper: boolean;
    hasLower: boolean;
    hasDigit: boolean;
    hasSpecial: boolean;
    notUsername: boolean;
    notCommon: boolean;
  };
}

export function validatePassword(
  password: string,
  username?: string,
): PasswordPolicyResult {
  const checks = {
    minLength: password.length >= 12,
    hasUpper: /[A-Z]/.test(password),
    hasLower: /[a-z]/.test(password),
    hasDigit: /\d/.test(password),
    hasSpecial: /[^A-Za-z0-9]/.test(password),
    notUsername:
      !username || password.toLowerCase() !== username.toLowerCase(),
    notCommon: !COMMON_PASSWORDS.has(password.toLowerCase()),
  };

  const errors: string[] = [];
  if (!checks.minLength)
    errors.push("Password must be at least 12 characters");
  if (!checks.hasUpper)
    errors.push("Must contain at least one uppercase letter");
  if (!checks.hasLower)
    errors.push("Must contain at least one lowercase letter");
  if (!checks.hasDigit) errors.push("Must contain at least one digit");
  if (!checks.hasSpecial)
    errors.push("Must contain at least one special character");
  if (!checks.notUsername) errors.push("Password must not match username");
  if (!checks.notCommon) errors.push("This password is too common");

  return {
    valid: errors.length === 0,
    errors,
    checks,
  };
}
