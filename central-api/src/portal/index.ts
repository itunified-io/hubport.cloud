import type { FastifyInstance } from 'fastify';
import { setupRoutes } from './setup.js';
import { loginRoutes } from './login.js';
import { dashboardRoutes } from './dashboard.js';
import { totpRoutes } from './totp.js';

export async function portalRoutes(app: FastifyInstance): Promise<void> {
  // Public routes (no auth needed)
  await app.register(setupRoutes);
  await app.register(loginRoutes);

  // Authenticated routes
  await app.register(dashboardRoutes);
  await app.register(totpRoutes);
}
