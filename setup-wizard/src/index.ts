import Fastify from 'fastify';
import { renderWizard, renderStep } from './ui/wizard-page.js';
import { tenantStep } from './steps/tenant-register.js';
import { dbStep } from './steps/db-init.js';
import { vaultStep } from './steps/vault-init.js';
import { encryptionKeyStep } from './steps/encryption-key.js';
import { keycloakStep } from './steps/keycloak-setup.js';
import { tunnelStep } from './steps/cf-tunnel.js';
import { warpStep } from './steps/warp-setup.js';
import { adminStep } from './steps/admin-user.js';

const STEPS = [tenantStep, dbStep, vaultStep, encryptionKeyStep, keycloakStep, tunnelStep, warpStep, adminStep];

const app = Fastify({ logger: true });

// Wizard landing — shows progress overview
app.get('/', async (_req, reply) => {
  const statuses = await Promise.all(STEPS.map((s) => s.check()));
  reply.type('text/html').send(renderWizard(STEPS, statuses));
});

// Individual step pages
app.get<{ Params: { step: string } }>('/step/:step', async (req, reply) => {
  const idx = parseInt(req.params.step, 10) - 1;
  const step = STEPS[idx];
  if (!step) return reply.status(404).send({ error: 'Step not found' });

  const status = await step.check();
  reply.type('text/html').send(renderStep(step, idx + 1, status));
});

// Execute a step (POST with credential confirmation)
app.post<{ Params: { step: string } }>('/step/:step', async (req, reply) => {
  const idx = parseInt(req.params.step, 10) - 1;
  const step = STEPS[idx];
  if (!step) return reply.status(404).send({ error: 'Step not found' });

  const result = await step.execute(req.body as Record<string, string>);
  const status = await step.check();
  reply.type('text/html').send(renderStep(step, idx + 1, status, result));
});

app.get('/health', async () => ({ status: 'ok', wizard: true }));

const port = parseInt(process.env.WIZARD_PORT || '8080', 10);
await app.listen({ port, host: '0.0.0.0' });
app.log.info(`Setup wizard running at http://localhost:${port}`);
