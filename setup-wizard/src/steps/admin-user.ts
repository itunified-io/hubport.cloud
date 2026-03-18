import type { WizardStep, StepStatus, StepResult } from './types.js';

const KC_URL = process.env.KEYCLOAK_URL || 'http://keycloak:8080';
const KC_ADMIN = process.env.KC_ADMIN || 'admin';
const KC_ADMIN_PASSWORD = process.env.KC_ADMIN_PASSWORD || '';
const REALM = 'hubport';

export const adminStep: WizardStep = {
  number: 7,
  id: 'admin-user',
  title: 'Admin User Creation',
  description: 'Create the first admin user in Keycloak for your congregation. This user will have full access to manage publishers, territories, and settings.',
  optional: false,

  async check(): Promise<StepStatus> {
    try {
      // Get admin token
      const tokenRes = await fetch(`${KC_URL}/realms/master/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: KC_ADMIN, password: KC_ADMIN_PASSWORD }),
        signal: AbortSignal.timeout(5000),
      });
      if (!tokenRes.ok) return { completed: false };
      const { access_token } = await tokenRes.json() as { access_token: string };

      // Check if any users exist in the hubport realm
      const usersRes = await fetch(`${KC_URL}/admin/realms/${REALM}/users?max=1`, {
        headers: { Authorization: `Bearer ${access_token}` },
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
    const { username, email, password, firstName, lastName } = input;
    if (!username || !email || !password) {
      return { success: false, message: 'Username, email, and password are required.' };
    }

    try {
      const tokenRes = await fetch(`${KC_URL}/realms/master/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: KC_ADMIN, password: KC_ADMIN_PASSWORD }),
      });
      if (!tokenRes.ok) return { success: false, message: 'Cannot authenticate with Keycloak admin.' };
      const { access_token } = await tokenRes.json() as { access_token: string };

      // Create user
      const userRes = await fetch(`${KC_URL}/admin/realms/${REALM}/users`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username, email, firstName, lastName,
          enabled: true,
          emailVerified: true,
          credentials: [{ type: 'password', value: password, temporary: false }],
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
          headers: { Authorization: `Bearer ${access_token}` },
        });
        if (rolesRes.ok) {
          const role = await rolesRes.json();
          await fetch(`${KC_URL}/admin/realms/${REALM}/users/${userId}/role-mappings/realm`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify([role]),
          });
        }
      }

      return {
        success: true,
        message: 'Admin user created with admin role. Setup complete!',
        credentials: { username, email, role: 'admin' },
      };
    } catch (err) {
      return { success: false, message: `User creation failed: ${(err as Error).message}` };
    }
  },
};
