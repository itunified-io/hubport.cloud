import Fastify from 'fastify';
import cors from '@fastify/cors';
import { tenantRoutes } from './routes/tenants.js';
import { sharingRoutes } from './routes/sharing.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(tenantRoutes, { prefix: '/tenants' });
await app.register(sharingRoutes, { prefix: '/sharing' });

app.get('/health', async () => ({ status: 'ok' }));

app.get('/releases/latest', async () => ({
  version: process.env.APP_VERSION || '0.0.0',
  changelog: 'https://github.com/itunified-io/hubport.cloud/blob/main/CHANGELOG.md',
}));

const port = parseInt(process.env.PORT || '3000', 10);
await app.listen({ port, host: '0.0.0.0' });
