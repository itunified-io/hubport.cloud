import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { renderWizard, renderStep } from './ui/wizard-page.js';
import { envCheckStep } from './steps/env-check.js';
import { dbStep } from './steps/db-init.js';
import { vaultStep, vaultConfirmHandler } from './steps/vault-init.js';
import { keycloakStep } from './steps/keycloak-setup.js';
import { adminStep } from './steps/admin-user.js';
import { tunnelStep } from './steps/cf-tunnel.js';

const STEPS = [envCheckStep, dbStep, vaultStep, keycloakStep, adminStep, tunnelStep];

const app = Fastify({ logger: true });
await app.register(formbody);

// Wizard landing — shows progress overview
app.get('/', async (_req, reply) => {
  const statuses = await Promise.all(STEPS.map((s) => s.check()));
  const autoAdvance = STEPS[0]!.id === 'env-check' && statuses[0]!.completed;
  reply.type('text/html').send(renderWizard(STEPS, statuses, autoAdvance));
});

// Individual step pages
app.get<{ Params: { step: string } }>('/step/:step', async (req, reply) => {
  const idx = parseInt(req.params.step, 10) - 1;
  const step = STEPS[idx];
  if (!step) return reply.status(404).send({ error: 'Step not found' });

  const status = await step.check();
  reply.type('text/html').send(renderStep(step, idx + 1, status, STEPS.length));
});

// Execute a step (POST with credential confirmation)
app.post<{ Params: { step: string } }>('/step/:step', async (req, reply) => {
  const idx = parseInt(req.params.step, 10) - 1;
  const step = STEPS[idx];
  if (!step) return reply.status(404).send({ error: 'Step not found' });

  const result = await step.execute(req.body as Record<string, string>);
  const status = await step.check();
  reply.type('text/html').send(renderStep(step, idx + 1, status, STEPS.length, result));
});

// Vault credential confirmation — second phase after user downloads & confirms credentials
app.post('/step/3/confirm', async (req, reply) => {
  const result = await vaultConfirmHandler(req.body as Record<string, string>);
  const status = await vaultStep.check();
  reply.type('text/html').send(renderStep(vaultStep, 3, status, STEPS.length, result));
});

app.get('/health', async () => ({ status: 'ok', wizard: true }));

const port = parseInt(process.env.WIZARD_PORT || '8080', 10);
await app.listen({ port, host: '0.0.0.0' });
app.log.info(`Setup wizard running at http://localhost:${port}`);
