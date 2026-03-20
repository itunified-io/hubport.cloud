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
      const errMsg = (err as Error).message || '';
      // P3005: non-empty database — auto-baseline the initial migration and retry
      if (errMsg.includes('P3005')) {
        try {
          await execFileAsync('npx', ['prisma', 'migrate', 'resolve', '--applied', '0001_init'], {
            cwd: '/app/hub-api',
            timeout: 30000,
          });
          const { stdout: retryOut } = await execFileAsync('npx', ['prisma', 'migrate', 'deploy'], {
            cwd: '/app/hub-api',
            timeout: 60000,
          });
          const applied = (retryOut.match(/applied/gi) || []).length;
          return {
            success: true,
            message: `Database auto-baselined and migrations applied (${applied} migration${applied !== 1 ? 's' : ''}).`,
            credentials: { database: 'hubport', host: 'postgres:5432', user: 'hubport' },
            warnings: ['P3005: Existing database detected — initial migration was auto-baselined.'],
          };
        } catch (retryErr) {
          return { success: false, message: `Auto-baseline retry failed: ${(retryErr as Error).message}` };
        }
      }
      return { success: false, message: `Migration failed: ${errMsg}` };
    }
  },
};
