import type { WizardStep, StepStatus, StepResult } from './types.js';

export const tunnelStep: WizardStep = {
  number: 6,
  id: 'cf-tunnel',
  title: 'Cloudflare Tunnel',
  description: 'Verify connectivity through your CF Tunnel. The tunnel token was provided in your signup email.',
  optional: false,

  async check(): Promise<StepStatus> {
    const token = process.env.CF_TUNNEL_TOKEN;
    if (!token) return { completed: false, details: { status: 'no-token' } };

    // Check if cloudflared is running and connected
    try {
      const res = await fetch('http://localhost:3001/health', { signal: AbortSignal.timeout(3000) });
      return { completed: res.ok, details: { status: 'connected' } };
    } catch {
      return { completed: false, details: { status: 'not-connected' } };
    }
  },

  async execute(): Promise<StepResult> {
    const token = process.env.CF_TUNNEL_TOKEN;
    if (!token) {
      return {
        success: false,
        message: 'CF_TUNNEL_TOKEN not set in .env file. Add the tunnel token from your signup email.',
      };
    }

    // Tunnel is managed by the cloudflared Docker container — just verify it's running
    try {
      const res = await fetch('http://localhost:3001/health', { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        return {
          success: true,
          message: 'Cloudflare Tunnel is active. Your app is accessible via your subdomain.',
          credentials: { tunnel_status: 'connected' },
        };
      }
    } catch {
      // Expected if cloudflared hasn't started yet
    }

    return {
      success: false,
      message: 'Tunnel not connected yet. Ensure cloudflared container is running (docker compose logs cloudflared).',
      warnings: ['The cloudflared container may take 10-30 seconds to establish the tunnel after startup.'],
    };
  },
};
