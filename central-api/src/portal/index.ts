import type { FastifyInstance } from 'fastify';
import { setupRoutes } from './setup.js';
import { loginRoutes } from './login.js';
import { dashboardRoutes } from './dashboard.js';
import { totpRoutes } from './totp.js';
import { passkeyRoutes } from './passkey.js';
import { mfaSetupRoutes } from './mfa-setup.js';

export async function portalRoutes(app: FastifyInstance): Promise<void> {
  await app.register(setupRoutes);
  await app.register(loginRoutes);
  await app.register(mfaSetupRoutes);
  await app.register(dashboardRoutes);
  await app.register(totpRoutes);
  await app.register(passkeyRoutes);
}
