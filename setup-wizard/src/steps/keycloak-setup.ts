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
  number: 5,
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
          // ADR-0077: Password policy — 12+ chars, upper, lower, digit, special, not username, history 5
          passwordPolicy: 'length(12) and upperCase(1) and lowerCase(1) and digits(1) and specialChars(1) and notUsername() and passwordHistory(5)',
          // ADR-0077: Brute force protection — 5 failures, 60s wait, 15min max
          bruteForceProtected: true,
          maxFailureWaitSeconds: 900,
          minimumQuickLoginWaitSeconds: 60,
          waitIncrementSeconds: 60,
          maxDeltaTimeSeconds: 43200,
          failureFactor: 5,
        }),
      });

      if (realmRes.status === 409) {
        return { success: true, message: 'Realm already exists.' };
      }
      if (!realmRes.ok) {
        return { success: false, message: `Failed to create realm: ${realmRes.statusText}` };
      }

      // Create OIDC public client for hub-app (SPA — no direct access grants per ADR-0081)
      await fetch(`${KC_URL}/admin/realms/${REALM}/clients`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'hub-app',
          publicClient: true,
          directAccessGrantsEnabled: false,
          redirectUris: ['*'],
          webOrigins: ['*'],
          protocol: 'openid-connect',
        }),
      });

      // Create OIDC confidential client for hub-api (admin API + service account)
      const apiClientSecret = process.env.KC_API_CLIENT_SECRET || crypto.randomUUID();
      await fetch(`${KC_URL}/admin/realms/${REALM}/clients`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'hub-api',
          publicClient: false,
          secret: apiClientSecret,
          serviceAccountsEnabled: true,
          directAccessGrantsEnabled: true,
          redirectUris: [],
          webOrigins: [],
          protocol: 'openid-connect',
        }),
      });

      // Create dedicated verification client (ROPC only — no admin access, SEC-004 F3)
      const verifyClientSecret = process.env.KC_VERIFY_CLIENT_SECRET || crypto.randomUUID();
      await fetch(`${KC_URL}/admin/realms/${REALM}/clients`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'hub-verify',
          publicClient: false,
          secret: verifyClientSecret,
          serviceAccountsEnabled: false,
          directAccessGrantsEnabled: true,
          redirectUris: [],
          webOrigins: [],
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
        message: 'Keycloak realm created with OIDC clients, RBAC roles, password policy, and brute force protection.',
        credentials: {
          realm: REALM,
          app_client_id: 'hub-app',
          app_client_type: 'public (directAccessGrants disabled)',
          api_client_id: 'hub-api',
          api_client_type: 'confidential (admin + service account)',
          api_client_secret: apiClientSecret,
          verify_client_id: 'hub-verify',
          verify_client_type: 'confidential (ROPC password verification only)',
          verify_client_secret: verifyClientSecret,
          password_policy: '12+ chars, upper, lower, digit, special, not-username, history 5',
          brute_force: '5 failures → 60s lockout (max 15min)',
          roles: roles.join(', '),
        },
      };
    } catch (err) {
      return { success: false, message: `Keycloak setup failed: ${(err as Error).message}` };
    }
  },
};
