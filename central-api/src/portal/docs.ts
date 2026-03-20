import type { FastifyInstance } from 'fastify';
import { portalAuth } from './auth.js';
import { portalShell, docsPage } from './ui.js';

export async function docsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/docs', { preHandler: portalAuth }, async (_req, reply) => {
    return reply.type('text/html').send(portalShell('Documentation', docsPage()));
  });
}
