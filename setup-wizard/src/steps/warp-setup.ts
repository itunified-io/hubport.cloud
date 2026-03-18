import type { WizardStep, StepStatus, StepResult } from './types.js';

export const warpStep: WizardStep = {
  number: 6,
  id: 'warp-setup',
  title: 'CF WARP Client (Optional)',
  description: 'Enable Cloudflare WARP for device posture checks. This is optional — skip if you only need Keycloak for authentication.',
  optional: true,

  async check(): Promise<StepStatus> {
    // WARP is optional — always "completed" (can be skipped)
    return { completed: true, details: { status: 'optional-skipped' } };
  },

  async execute(input): Promise<StepResult> {
    if (input.skip === 'true') {
      return { success: true, message: 'WARP setup skipped. Keycloak handles authentication.' };
    }

    return {
      success: true,
      message: 'To enable WARP, uncomment the warp service in docker-compose.yml and restart the stack.',
      warnings: [
        'WARP requires all users to install the Cloudflare WARP app on their devices.',
        'This adds security but increases onboarding friction.',
        'Keycloak authentication is sufficient for most congregations.',
      ],
    };
  },
};
