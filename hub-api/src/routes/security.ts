/**
 * Security routes — credential management proxy to Keycloak Admin API.
 * ADR-0077: Passkey-first authentication with TOTP fallback.
 *
 * Architecture:
 * - Password, TOTP, sessions: hub-api → Keycloak Admin REST API (service account)
 * - WebAuthn passkeys: stored in our DB (Keycloak 24 doesn't support reliable WebAuthn CRUD)
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
  updateRequiredActions,
  verifyPassword,
  getPasskeyCount as kcGetPasskeyCount,
  hasTotp as kcHasTotp,
  getPasskeys as kcGetPasskeys,
} from "../lib/keycloak-admin.js";
import { validatePassword } from "../lib/password-policy.js";
import prisma from "../lib/prisma.js";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { TOTP } from "otpauth";
import QRCode from "qrcode";

// ─── WebAuthn Config ────────────────────────────────────────────────

const RP_NAME = "Hubport";
const RP_ID = process.env.WEBAUTHN_RP_ID || "localhost";
const RP_ORIGIN = process.env.WEBAUTHN_ORIGIN || `https://${RP_ID}`;
const TENANT_DISPLAY_NAME = process.env.HUBPORT_TENANT_NAME || "Hubport";
const TOTP_ISSUER = `${TENANT_DISPLAY_NAME} Hub`;

// In-memory challenge stores (per-user). Fine for single-instance tenant.
const pendingWebAuthnChallenges = new Map<string, string>();
const pendingTotpSecrets = new Map<string, string>();

// ─── Helper ─────────────────────────────────────────────────────────

function getUserId(request: FastifyRequest): string {
  return (request.user as { sub: string }).sub;
}

// ─── Routes ─────────────────────────────────────────────────────────

export async function securityRoutes(app: FastifyInstance): Promise<void> {
  // ═══════════════════════════════════════════════════════════════════
  // STATUS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * GET /security/status
   * Check if user has completed security setup.
   */
  app.get("/security/status", async (request) => {
    const userId = getUserId(request);

    // Check local DB for password-changed flag
    const setup = await prisma.securitySetup.findUnique({
      where: { keycloakSub: userId },
    });
    const passwordChanged = setup?.passwordChanged ?? false;

    // Check local DB for passkey and TOTP (source of truth — hub-api manages
    // these credentials directly, not Keycloak)
    const passkeyCount = await prisma.webAuthnCredential.count({
      where: { keycloakSub: userId },
    });
    const passkeyRegistered = passkeyCount > 0;
    const totpConfigured = !!setup?.totpSecret && !!setup?.totpEnabledAt;

    return {
      passwordChanged,
      passkeyRegistered,
      totpConfigured,
      setupComplete: passwordChanged && (passkeyRegistered || totpConfigured),
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
   * Change user password. Validates against policy.
   */
  app.post<{ Body: typeof PasswordBody.static }>(
    "/security/password",
    { schema: { body: PasswordBody } },
    async (request, reply) => {
      const userId = getUserId(request);
      const { currentPassword, newPassword } = request.body;
      const isOnboarding = (request as any).user?.scope === "onboarding";

      // Validate new password against policy
      const user = await getKeycloakUser(userId);
      const validation = validatePassword(newPassword, user.username);
      if (!validation.valid) {
        return reply.code(400).send({
          error: "Password does not meet policy requirements",
          details: validation.errors,
          checks: validation.checks,
        });
      }

      // Skip current password verification during onboarding
      // (user has a random temp password they never received)
      if (!isOnboarding) {
        if (!currentPassword) {
          return reply.code(400).send({ error: "Current password is required" });
        }
        const currentValid = await verifyPassword(user.username, currentPassword);
        if (!currentValid) {
          return reply.code(400).send({ error: "Current password is incorrect" });
        }
      }

      // Set new password via Admin API
      await resetPassword(userId, newPassword, false);

      // Track password change in our DB
      await prisma.securitySetup.upsert({
        where: { keycloakSub: userId },
        create: {
          keycloakSub: userId,
          passwordChanged: true,
          passwordChangedAt: new Date(),
        },
        update: {
          passwordChanged: true,
          passwordChangedAt: new Date(),
        },
      });

      return { success: true };
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  // TOTP
  // ═══════════════════════════════════════════════════════════════════

  /**
   * GET /security/totp/setup
   * Generate a new TOTP secret and QR code.
   * Does NOT enable TOTP — user must verify first via POST /security/totp/verify.
   */
  app.get("/security/totp/setup", async (request) => {
    const userId = getUserId(request);
    const user = await getKeycloakUser(userId);

    const totp = new TOTP({
      issuer: TOTP_ISSUER,
      label: user.email || user.username,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });

    // Store secret temporarily for verification
    pendingTotpSecrets.set(userId, totp.secret.base32);

    const uri = totp.toString();
    const qrCode = await QRCode.toDataURL(uri);

    return {
      secret: totp.secret.base32,
      uri,
      qrCode,
      issuer: TOTP_ISSUER,
    };
  });

  const TotpVerifyBody = Type.Object({
    code: Type.String({ minLength: 6, maxLength: 6 }),
  });

  /**
   * POST /security/totp/verify
   * Verify a TOTP code against the pending secret, then enable it.
   */
  app.post<{ Body: typeof TotpVerifyBody.static }>(
    "/security/totp/verify",
    { schema: { body: TotpVerifyBody } },
    async (request, reply) => {
      const userId = getUserId(request);
      const { code } = request.body;

      const secret = pendingTotpSecrets.get(userId);
      if (!secret) {
        return reply.code(400).send({
          error: "No pending TOTP setup. Call GET /security/totp/setup first.",
        });
      }

      // Verify the code
      const totp = new TOTP({
        issuer: TOTP_ISSUER,
        label: "verify",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret,
      });

      const delta = totp.validate({ token: code, window: 1 });
      if (delta === null) {
        return reply
          .code(400)
          .send({ error: "Invalid TOTP code. Please try again." });
      }

      // Store TOTP secret in our DB (reliable verification)
      await prisma.securitySetup.upsert({
        where: { keycloakSub: userId },
        create: {
          keycloakSub: userId,
          totpSecret: secret,
          totpEnabledAt: new Date(),
        },
        update: {
          totpSecret: secret,
          totpEnabledAt: new Date(),
        },
      });

      // Clean up pending secret
      pendingTotpSecrets.delete(userId);

      // Remove CONFIGURE_TOTP from required actions if present
      const user = await getKeycloakUser(userId);
      if (user.requiredActions.includes("CONFIGURE_TOTP")) {
        const newActions = user.requiredActions.filter(
          (a) => a !== "CONFIGURE_TOTP",
        );
        await updateRequiredActions(userId, newActions);
      }

      return { success: true };
    },
  );

  /**
   * DELETE /security/totp
   * Remove TOTP. Blocked if no passkey exists.
   */
  app.delete("/security/totp", async (request, reply) => {
    const userId = getUserId(request);

    // Check if user has a passkey (Keycloak first, fallback local DB)
    let passkeyCount = 0;
    try {
      passkeyCount = await kcGetPasskeyCount(userId);
    } catch {
      passkeyCount = await prisma.webAuthnCredential.count({
        where: { keycloakSub: userId },
      });
    }
    if (passkeyCount === 0) {
      return reply.code(400).send({
        error: "Cannot remove TOTP without a registered passkey",
      });
    }

    // Remove TOTP secret from our DB
    await prisma.securitySetup.update({
      where: { keycloakSub: userId },
      data: { totpSecret: null, totpEnabledAt: null },
    });

    // Also remove OTP credential from Keycloak if present
    try {
      const credentials = await getUserCredentials(userId);
      const otpCred = credentials.find(
        (c) => c.type === "otp" || c.type === "totp",
      );
      if (otpCred) {
        await removeCredential(userId, otpCred.id);
      }
    } catch {
      // Keycloak credential removal is best-effort
    }

    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════════
  // PASSKEYS (WebAuthn)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * POST /security/passkeys/challenge
   * Generate a WebAuthn registration challenge.
   */
  app.post("/security/passkeys/challenge", async (request) => {
    const userId = getUserId(request);
    const user = await getKeycloakUser(userId);

    // Get existing passkeys to exclude
    const existingCreds = await prisma.webAuthnCredential.findMany({
      where: { keycloakSub: userId },
      select: { credentialId: true, transports: true },
    });

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: new TextEncoder().encode(userId),
      userName: user.username,
      userDisplayName:
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        user.email ||
        user.username,
      attestationType: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "preferred",
        residentKey: "preferred",
      },
      excludeCredentials: existingCreds.map((c: { credentialId: string; transports: string[] }) => ({
        id: c.credentialId,
        transports: c.transports as ("ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb")[],
      })),
    });

    // Store challenge for verification
    pendingWebAuthnChallenges.set(userId, options.challenge);

    return options;
  });

  const PasskeyRegisterBody = Type.Object({
    credential: Type.Any(), // RegistrationResponseJSON from @simplewebauthn/browser
    label: Type.Optional(Type.String({ maxLength: 100 })),
  });

  /**
   * POST /security/passkeys/register
   * Verify the WebAuthn registration response and store the credential.
   */
  app.post<{ Body: typeof PasskeyRegisterBody.static }>(
    "/security/passkeys/register",
    { schema: { body: PasskeyRegisterBody } },
    async (request, reply) => {
      const userId = getUserId(request);
      const { credential, label } = request.body;

      const expectedChallenge = pendingWebAuthnChallenges.get(userId);
      if (!expectedChallenge) {
        return reply.code(400).send({
          error:
            "No pending challenge. Call POST /security/passkeys/challenge first.",
        });
      }

      let verification;
      try {
        verification = await verifyRegistrationResponse({
          response: credential,
          expectedChallenge,
          expectedOrigin: RP_ORIGIN,
          expectedRPID: RP_ID,
        });
      } catch (err) {
        return reply.code(400).send({
          error: "WebAuthn verification failed",
          details: (err as Error).message,
        });
      }

      if (!verification.verified || !verification.registrationInfo) {
        return reply.code(400).send({ error: "WebAuthn verification failed" });
      }

      const {
        credential: regCred,
        credentialDeviceType,
        credentialBackedUp,
      } = verification.registrationInfo;

      // Store in our DB
      await prisma.webAuthnCredential.create({
        data: {
          keycloakSub: userId,
          credentialId: regCred.id,
          publicKey: Buffer.from(regCred.publicKey),
          counter: BigInt(regCred.counter),
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
          transports: (credential.response?.transports as string[]) || [],
          label: label || "Passkey",
        },
      });

      // Clean up challenge
      pendingWebAuthnChallenges.delete(userId);

      // Remove webauthn-register from required actions if present
      const user = await getKeycloakUser(userId);
      if (user.requiredActions.includes("webauthn-register")) {
        const newActions = user.requiredActions.filter(
          (a) => a !== "webauthn-register",
        );
        await updateRequiredActions(userId, newActions);
      }

      return { success: true, credentialId: regCred.id };
    },
  );

  /**
   * GET /security/passkeys
   * List registered passkeys for the current user.
   */
  app.get("/security/passkeys", async (request) => {
    const userId = getUserId(request);

    // Try Keycloak first, fallback to local DB
    try {
      const kcPasskeys = await kcGetPasskeys(userId);
      if (kcPasskeys.length > 0) {
        return kcPasskeys.map((p) => ({
          id: p.id,
          label: p.label,
          createdAt: new Date(p.createdDate).toISOString(),
        }));
      }
    } catch {
      // Fallback to local DB
    }

    const credentials = await prisma.webAuthnCredential.findMany({
      where: { keycloakSub: userId },
      select: {
        id: true,
        label: true,
        deviceType: true,
        backedUp: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return credentials;
  });

  /**
   * DELETE /security/passkeys/:id
   * Remove a passkey. Blocked if this is the last one and no TOTP exists.
   */
  app.delete<{ Params: { id: string } }>(
    "/security/passkeys/:id",
    async (request, reply) => {
      const userId = getUserId(request);
      const { id } = request.params;

      // Check Keycloak for TOTP and passkey count
      let hasTOTP = false;
      let passkeyCount = 0;
      try {
        hasTOTP = await kcHasTotp(userId);
        passkeyCount = await kcGetPasskeyCount(userId);
      } catch {
        // Fallback to local DB
        const setup = await prisma.securitySetup.findUnique({
          where: { keycloakSub: userId },
        });
        hasTOTP = !!setup?.totpSecret && !!setup?.totpEnabledAt;
        passkeyCount = await prisma.webAuthnCredential.count({
          where: { keycloakSub: userId },
        });
      }

      if (passkeyCount <= 1 && !hasTOTP) {
        return reply.code(400).send({
          error:
            "Cannot remove last passkey without TOTP configured. Set up TOTP first.",
        });
      }

      // Remove from Keycloak first
      try {
        await removeCredential(userId, id);
      } catch {
        // Keycloak removal is best-effort
      }

      // Also remove from local DB (if exists)
      await prisma.webAuthnCredential.deleteMany({
        where: { id, keycloakSub: userId },
      }).catch(() => { /* local DB removal is best-effort */ });

      return { success: true };
    },
  );

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
