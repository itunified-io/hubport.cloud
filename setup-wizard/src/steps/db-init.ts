import type { WizardStep, StepStatus, StepResult } from './types.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const dbStep: WizardStep = {
  number: 2,
  id: 'db-init',
  title: 'Database Initialization',
  description: 'Run Prisma migrations to set up the database schema.',
  optional: false,

  async check(): Promise<StepStatus> {
    try {
      const { stdout } = await execFileAsync('npx', ['prisma', 'migrate', 'status'], {
        cwd: '/app/hub-api',
        timeout: 10000,
      });
      const hasPending = stdout.includes('Following migration');
      return { completed: !hasPending, details: { status: hasPending ? 'pending' : 'up-to-date' } };
    } catch {
      return { completed: false, details: { status: 'not-initialized' } };
    }
  },

  async execute(): Promise<StepResult> {
    try {
      const { stdout } = await execFileAsync('npx', ['prisma', 'migrate', 'deploy'], {
        cwd: '/app/hub-api',
        timeout: 60000,
      });

      const applied = (stdout.match(/applied/gi) || []).length;
      return {
        success: true,
        message: `Database migrations applied (${applied} migration${applied !== 1 ? 's' : ''}).`,
        credentials: { database: 'hubport', host: 'postgres:5432', user: 'hubport' },
      };
    } catch (err) {
      return { success: false, message: `Migration failed: ${(err as Error).message}` };
    }
  },
};
