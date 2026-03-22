/**
 * Admin User Step — onboards a real person (ADR-0077: no generic admin).
 *
 * Creates a Keycloak user with a random temporary password (must change on first login),
 * assigns the admin role, and creates a matching Publisher record in the database.
 * The SecurityGate wizard will then enforce passkey/TOTP setup.
 */
import { randomBytes } from 'node:crypto';
import type { WizardStep, StepStatus, StepResult } from './types.js';

const KC_URL = process.env.KEYCLOAK_URL || 'http://keycloak:8080';
const KC_ADMIN = process.env.KC_ADMIN || 'admin';
const KC_ADMIN_PASSWORD = process.env.KC_ADMIN_PASSWORD || '';
const REALM = 'hubport';
const DB_URL = process.env.DATABASE_URL || '';

/**
 * Bias-free random index: rejection sampling eliminates modulo bias.
 * Rejects values >= (256 - 256 % max) so every index is equally likely.
 */
function secureRandomIndex(max: number): number {
  const limit = 256 - (256 % max);
  let byte: number;
  do {
    byte = randomBytes(1)[0]!;
  } while (byte >= limit);
  return byte % max;
}

/** Generate a random password meeting ADR-0077 policy (12+ chars, upper, lower, digit, special). */
function generateTempPassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  const special = '!@#$%^&*_-+=';
  const all = chars + upper + digits + special;

  // Guarantee at least one of each category
  const result = [
    upper[secureRandomIndex(upper.length)]!,
    chars[secureRandomIndex(chars.length)]!,
    digits[secureRandomIndex(digits.length)]!,
    special[secureRandomIndex(special.length)]!,
  ];

  // Fill remaining 12 chars
  for (let i = 0; i < 12; i++) {
    result.push(all[secureRandomIndex(all.length)]!);
  }

  // Shuffle (Fisher-Yates with unbiased random)
  for (let i = result.length - 1; i > 0; i--) {
    const j = secureRandomIndex(i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }

  return result.join('');
}

async function getAdminToken(): Promise<string | null> {
  try {
    const res = await fetch(`${KC_URL}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: KC_ADMIN, password: KC_ADMIN_PASSWORD }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { access_token: string };
    return data.access_token;
  } catch {
    return null;
  }
}

/** Create a Publisher record in the database for the new admin user. */
async function createPublisherRecord(
  keycloakSub: string,
  firstName: string,
  lastName: string,
  email: string,
): Promise<void> {
  if (!DB_URL) throw new Error('DATABASE_URL not set — cannot create Publisher record.');

  // Dynamic import to avoid bundling Prisma at module level
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });

  try {
    await prisma.publisher.create({
      data: {
        keycloakSub,
        firstName,
        lastName,
        email,
        role: 'admin',
        isOwner: true,
        congregationRole: 'elder',
        status: 'active',
        congregationFlags: [],
        privacyAccepted: false,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

export const adminStep: WizardStep = {
  number: 8,
  id: 'admin-user',
  title: 'First User Onboarding',
  description: 'Create the first real user (admin) for your congregation. A random temporary password is generated — the user must change it on first login and set up passkey/TOTP.',
  optional: false,

  async check(): Promise<StepStatus> {
    try {
      const token = await getAdminToken();
      if (!token) return { completed: false, details: { status: 'unreachable' } };

      const usersRes = await fetch(`${KC_URL}/admin/realms/${REALM}/users?max=1`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!usersRes.ok) return { completed: false };
      const users = await usersRes.json() as unknown[];
      return { completed: users.length > 0, details: { users: String(users.length) } };
    } catch {
      return { completed: false };
    }
  },

  async execute(input): Promise<StepResult> {
    const { firstName, lastName, email } = input;
    if (!firstName || !lastName || !email) {
      return { success: false, message: 'First name, last name, and email are required.' };
    }

    try {
      const token = await getAdminToken();
      if (!token) return { success: false, message: 'Cannot authenticate with Keycloak admin. Check KC_ADMIN_PASSWORD.' };

      // Generate random temporary password
      const tempPassword = generateTempPassword();

      // Derive username from email (part before @)
      const username = email.split('@')[0]!.toLowerCase().replace(/[^a-z0-9._-]/g, '');

      // Create user in Keycloak with temporary password (must change on first login)
      const userRes = await fetch(`${KC_URL}/admin/realms/${REALM}/users`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          email,
          firstName,
          lastName,
          enabled: true,
          emailVerified: true,
          credentials: [{ type: 'password', value: tempPassword, temporary: true }],
          requiredActions: ['UPDATE_PASSWORD'],
        }),
      });

      if (userRes.status === 409) return { success: true, message: 'User already exists.' };
      if (!userRes.ok) return { success: false, message: `Failed to create user: ${userRes.statusText}` };

      // Get user ID from Location header
      const location = userRes.headers.get('Location') || '';
      const userId = location.split('/').pop();

      // Assign admin role
      if (userId) {
        const rolesRes = await fetch(`${KC_URL}/admin/realms/${REALM}/roles/admin`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (rolesRes.ok) {
          const role = await rolesRes.json();
          await fetch(`${KC_URL}/admin/realms/${REALM}/users/${userId}/role-mappings/realm`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify([role]),
          });
        }

        // Create Publisher record in the database
        try {
          await createPublisherRecord(userId, firstName, lastName, email);
        } catch (err) {
          return {
            success: true,
            message: `Keycloak user created, but Publisher record failed: ${(err as Error).message}. The user can still log in — Publisher record will be created on first login.`,
            credentials: {
              name: `${firstName} ${lastName}`,
              email,
              username,
              temporary_password: tempPassword,
              role: 'admin',
            },
            warnings: ['Publisher record creation failed — will be auto-created on first login.'],
          };
        }
      }

      return {
        success: true,
        message: 'First user onboarded! Share the temporary password securely — they must change it on first login and set up passkey or TOTP.',
        credentials: {
          name: `${firstName} ${lastName}`,
          email,
          username,
          temporary_password: tempPassword,
          role: 'admin',
          publisher_record: 'created',
          security_note: 'Password must be changed on first login. SecurityGate enforces passkey/TOTP setup.',
        },
      };
    } catch (err) {
      return { success: false, message: `User creation failed: ${(err as Error).message}` };
    }
  },
};
