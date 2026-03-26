import type { FastifyInstance } from 'fastify';
import { loginRoutes } from './login.js';
import { dashboardRoutes } from './dashboard.js';
import { deviceRoutes } from './devices.js';
import { docsRoutes } from './docs.js';

export async function portalRoutes(app: FastifyInstance): Promise<void> {
  await app.register(loginRoutes);
  await app.register(dashboardRoutes);
  await app.register(deviceRoutes);
  await app.register(docsRoutes);
}
