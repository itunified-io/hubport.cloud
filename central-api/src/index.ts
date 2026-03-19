import Fastify from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import { tenantRoutes } from './routes/tenants.js';
import { sharingRoutes } from './routes/sharing.js';
import { tokenRoutes } from './routes/tokens.js';
import { adminRoutes } from './admin/index.js';
import { portalRoutes } from './portal/index.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(formbody);
await app.register(tenantRoutes, { prefix: '/tenants' });
await app.register(sharingRoutes, { prefix: '/sharing' });
await app.register(tokenRoutes, { prefix: '/api/v1/tokens' });
await app.register(adminRoutes, { prefix: '/admin' });
await app.register(portalRoutes, { prefix: '/portal' });

// Root redirect to admin portal
app.get('/', async (_req, reply) => reply.redirect('/admin'));

app.get('/health', async () => ({ status: 'ok' }));

app.get('/releases/latest', async () => ({
  version: process.env.APP_VERSION || '0.0.0',
  changelog: 'https://github.com/itunified-io/hubport.cloud/blob/main/CHANGELOG.md',
}));

const port = parseInt(process.env.PORT || '3000', 10);
await app.listen({ port, host: '0.0.0.0' });
