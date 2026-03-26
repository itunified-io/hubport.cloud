/**
 * Security routes — profile credential management via Keycloak Admin API.
 * ADR-0086: Keycloak is the sole credential authority.
 *
 * All WebAuthn/TOTP registration and verification happens in Keycloak flows.
 * These endpoints manage existing credentials (list, delete) and password change.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";
import {
  getKeycloakUser,
  getUserCredentials,
  resetPassword,
  getUserSessions,
  revokeSession,
  removeCredential,
  verifyPassword,
  getPasskeyCount as kcGetPasskeyCount,
  hasTotp as kcHasTotp,
  getPasskeys as kcGetPasskeys,
} from "../lib/keycloak-admin.js";
import { invalidateSecurityCache } from "../lib/rbac.js";

// ─── Helper ─────────────────────────────────────────────────────────

function getUserId(request: FastifyRequest): string {
  return (request.user as { sub: string }).sub;
}

// ─── Routes ─────────────────────────────────────────────────────────

export async function securityRoutes(app: FastifyInstance): Promise<void> {
  // ═══════════════════════════════════════════════════════════════════
  // STATUS — derives setup state from Keycloak requiredActions
  // ═══════════════════════════════════════════════════════════════════

  app.get("/security/status", async (request) => {
    const userId = getUserId(request);
    const user = await getKeycloakUser(userId);

    // If requiredActions is empty, setup is complete
    const setupComplete = user.requiredActions.length === 0;

    // Derive individual flags from Keycloak credentials
    const [passkeyCount, hasTOTP] = await Promise.all([
      kcGetPasskeyCount(userId),
      kcHasTotp(userId),
    ]);

    return {
      passwordChanged: !user.requiredActions.includes("UPDATE_PASSWORD"),
      passkeyRegistered: passkeyCount > 0,
      totpConfigured: hasTOTP,
      setupComplete,
    };
  });

  // ═══════════════════════════════════════════════════════════════════
  // PASSWORD
  // ═══════════════════════════════════════════════════════════════════

  const PasswordBody = Type.Object({
    currentPassword: Type.Optional(Type.String({ minLength: 1 })),
    newPassword: Type.String({ minLength: 1 }),
  });

  /**
   * POST /security/password
   * Change user password via Keycloak Admin API.
   * Password policy is enforced by Keycloak realm policy.
   */
  app.post<{ Body: typeof PasswordBody.static }>(
    "/security/password",
    { schema: { body: PasswordBody }, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const userId = getUserId(request);
      const { currentPassword, newPassword } = request.body;

      // Verify current password (skip during onboarding — user has random temp password)
      const isOnboarding = (request as any).user?.scope === "onboarding";
      if (!isOnboarding) {
        if (!currentPassword) {
          return reply.code(400).send({ error: "Current password is required" });
        }
        const user = await getKeycloakUser(userId);
        const currentValid = await verifyPassword(user.username, currentPassword);
        if (!currentValid) {
          return reply.code(400).send({ error: "Current password is incorrect" });
        }
      }

      // Set new password via Admin API (non-temporary)
      await resetPassword(userId, newPassword, false);

      // Invalidate security status cache
      invalidateSecurityCache(userId);

      return { success: true };
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  // PASSKEYS (read/delete only — registration via Keycloak flow)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * GET /security/passkeys
   * List user's WebAuthn passkeys from Keycloak.
   */
  app.get("/security/passkeys", async (request) => {
    const userId = getUserId(request);
    const passkeys = await kcGetPasskeys(userId);
    return passkeys.map((p) => ({
      id: p.id,
      label: p.label,
      createdAt: new Date(p.createdDate).toISOString(),
    }));
  });

  /**
   * DELETE /security/passkeys/:id
   * Remove a passkey from Keycloak.
   * Guard: cannot delete last passkey if no TOTP exists.
   */
  app.delete<{ Params: { id: string } }>(
    "/security/passkeys/:id",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const userId = getUserId(request);
      const { id } = request.params;

      const [passkeyCount, hasTOTP] = await Promise.all([
        kcGetPasskeyCount(userId),
        kcHasTotp(userId),
      ]);

      if (passkeyCount <= 1 && !hasTOTP) {
        return reply.code(400).send({
          error: "Cannot remove last passkey without TOTP configured. Set up TOTP first.",
        });
      }

      await removeCredential(userId, id);

      // Invalidate security status cache
      invalidateSecurityCache(userId);

      return { success: true };
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  // TOTP (delete only — setup via Keycloak flow)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * DELETE /security/totp
   * Remove TOTP credential from Keycloak.
   * Guard: cannot delete TOTP if no passkey exists.
   */
  app.delete("/security/totp", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const userId = getUserId(request);

    const passkeyCount = await kcGetPasskeyCount(userId);
    if (passkeyCount === 0) {
      return reply.code(400).send({
        error: "Cannot remove TOTP without a registered passkey",
      });
    }

    // Find and remove OTP credential from Keycloak
    const credentials = await getUserCredentials(userId);
    const otpCred = credentials.find(
      (c) => c.type === "otp" || c.type === "totp",
    );
    if (otpCred) {
      await removeCredential(userId, otpCred.id);
    }

    // Invalidate security status cache
    invalidateSecurityCache(userId);

    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════════
  // SESSIONS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * GET /security/sessions
   * List active Keycloak sessions for the current user.
   */
  app.get("/security/sessions", async (request) => {
    const sessions = await getUserSessions(getUserId(request));
    return sessions.map((s) => ({
      id: s.id,
      ipAddress: s.ipAddress,
      started: s.start,
      lastAccess: s.lastAccess,
      clients: s.clients,
    }));
  });

  /**
   * DELETE /security/sessions/:id
   * Revoke a session.
   */
  app.delete<{ Params: { id: string } }>(
    "/security/sessions/:id",
    async (request) => {
      await revokeSession(request.params.id);
      return { success: true };
    },
  );
}
