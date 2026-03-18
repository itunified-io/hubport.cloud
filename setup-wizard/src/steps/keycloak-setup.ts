import type { WizardStep, StepStatus, StepResult } from './types.js';

const KC_URL = process.env.KEYCLOAK_URL || 'http://keycloak:8080';
const KC_ADMIN = process.env.KC_ADMIN || 'admin';
const KC_ADMIN_PASSWORD = process.env.KC_ADMIN_PASSWORD || '';
const REALM = 'hubport';

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

export const keycloakStep: WizardStep = {
  number: 4,
  id: 'keycloak-setup',
  title: 'Keycloak Realm Setup',
  description: 'Create the hubport realm, configure OIDC client for the app, and set up RBAC roles (admin, elder, publisher, viewer).',
  optional: false,

  async check(): Promise<StepStatus> {
    const token = await getAdminToken();
    if (!token) return { completed: false, details: { status: 'unreachable' } };

    try {
      const res = await fetch(`${KC_URL}/admin/realms/${REALM}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
      return { completed: res.ok, details: { realm: res.ok ? REALM : 'not-found' } };
    } catch {
      return { completed: false };
    }
  },

  async execute(): Promise<StepResult> {
    const token = await getAdminToken();
    if (!token) return { success: false, message: 'Cannot authenticate with Keycloak admin. Check KC_ADMIN_PASSWORD.' };

    try {
      // Create realm
      const realmRes = await fetch(`${KC_URL}/admin/realms`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          realm: REALM,
          enabled: true,
          displayName: 'Hubport',
          registrationAllowed: false,
          loginWithEmailAllowed: true,
          duplicateEmailsAllowed: false,
        }),
      });

      if (realmRes.status === 409) {
        return { success: true, message: 'Realm already exists.' };
      }
      if (!realmRes.ok) {
        return { success: false, message: `Failed to create realm: ${realmRes.statusText}` };
      }

      // Create OIDC client for hub-app
      const clientRes = await fetch(`${KC_URL}/admin/realms/${REALM}/clients`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'hub-app',
          publicClient: true,
          directAccessGrantsEnabled: true,
          redirectUris: ['*'],
          webOrigins: ['*'],
          protocol: 'openid-connect',
        }),
      });

      // Create realm roles (RBAC: admin, elder, publisher, viewer)
      const roles = ['admin', 'elder', 'publisher', 'viewer'];
      for (const role of roles) {
        await fetch(`${KC_URL}/admin/realms/${REALM}/roles`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: role, description: `${role} role for hubport` }),
        });
      }

      return {
        success: true,
        message: 'Keycloak realm created with OIDC client and RBAC roles.',
        credentials: {
          realm: REALM,
          client_id: 'hub-app',
          client_type: 'public',
          roles: roles.join(', '),
        },
      };
    } catch (err) {
      return { success: false, message: `Keycloak setup failed: ${(err as Error).message}` };
    }
  },
};
