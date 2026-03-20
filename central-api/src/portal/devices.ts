import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { portalAuth } from './auth.js';
import { portalShell } from './ui.js';

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  // Device verification page (requires portal login)
  app.get('/devices/verify', { preHandler: portalAuth }, async (req, reply) => {
    const html = portalShell('Authorize Device', `
      <div class="max-w-md mx-auto">
        <h2 class="text-2xl text-amber-500 mb-2 text-center">Authorize Device</h2>
        <p class="text-zinc-400 text-center mb-6">Enter the code shown in your terminal to authorize the device.</p>

        <div id="code-form">
          <div class="mb-4">
            <label class="block text-sm text-zinc-400 mb-1">Device Code</label>
            <input type="text" id="device-code" class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-zinc-200 text-center text-2xl font-mono tracking-widest uppercase focus:border-amber-500 focus:outline-none" placeholder="ABCD-1234" maxlength="9" autofocus>
          </div>
          <button onclick="lookupDevice()" class="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold py-3 rounded-lg transition">Verify</button>
          <div id="code-error" class="text-sm text-red-400 mt-3 hidden"></div>
        </div>

        <div id="device-details" class="hidden">
          <div class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-6">
            <h3 class="text-sm text-zinc-500 uppercase tracking-wider mb-3">Device Details</h3>
            <table class="w-full text-sm">
              <tr class="border-b border-zinc-800/50"><td class="py-2 text-zinc-400">Hostname</td><td class="py-2 text-zinc-200 font-mono" id="dev-hostname"></td></tr>
              <tr class="border-b border-zinc-800/50"><td class="py-2 text-zinc-400">OS</td><td class="py-2 text-zinc-200" id="dev-os"></td></tr>
              <tr class="border-b border-zinc-800/50"><td class="py-2 text-zinc-400">Architecture</td><td class="py-2 text-zinc-200 font-mono" id="dev-arch"></td></tr>
              <tr><td class="py-2 text-zinc-400">IP Address</td><td class="py-2 text-zinc-200 font-mono" id="dev-ip"></td></tr>
            </table>
          </div>

          <div class="bg-amber-900/20 border border-amber-600/30 rounded-lg p-4 mb-6">
            <p class="text-sm text-amber-400">Only approve this device if you recognize it and initiated the installation yourself.</p>
          </div>

          <div class="flex gap-3">
            <button onclick="denyDevice()" class="flex-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 py-3 rounded-lg transition font-semibold">Deny</button>
            <button onclick="approveDevice()" class="flex-1 bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg transition font-semibold">Approve</button>
          </div>
          <div id="action-error" class="text-sm text-red-400 mt-3 hidden"></div>
        </div>

        <div id="device-result" class="hidden text-center py-8">
          <p id="result-text" class="text-lg mb-4"></p>
          <a href="/portal/dashboard" class="text-amber-500 hover:underline text-sm">Back to Dashboard</a>
        </div>
      </div>

      <script>
      var _deviceCode = '';

      document.getElementById('device-code').addEventListener('input', function(e) {
        var v = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (v.length > 4) v = v.slice(0,4) + '-' + v.slice(4,8);
        e.target.value = v;
      });

      async function lookupDevice() {
        var code = document.getElementById('device-code').value.toUpperCase();
        var errEl = document.getElementById('code-error');
        errEl.classList.add('hidden');
        try {
          var res = await fetch('/portal/devices/lookup', {
            method: 'POST', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({deviceCode: code}),
          });
          if (!res.ok) { var e = await res.json(); throw new Error(e.error || 'Not found'); }
          var data = await res.json();
          _deviceCode = code;
          document.getElementById('dev-hostname').textContent = data.hostname;
          document.getElementById('dev-os').textContent = data.os;
          document.getElementById('dev-arch').textContent = data.arch;
          document.getElementById('dev-ip').textContent = data.ip;
          document.getElementById('code-form').classList.add('hidden');
          document.getElementById('device-details').classList.remove('hidden');
        } catch(e) {
          errEl.textContent = e.message || 'Device not found';
          errEl.classList.remove('hidden');
        }
      }

      async function approveDevice() { await deviceAction('approve'); }
      async function denyDevice() { await deviceAction('deny'); }

      async function deviceAction(action) {
        var errEl = document.getElementById('action-error');
        errEl.classList.add('hidden');
        try {
          var res = await fetch('/portal/devices/' + action, {
            method: 'POST', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({deviceCode: _deviceCode}),
          });
          if (!res.ok) { var e = await res.json(); throw new Error(e.error || 'Failed'); }
          document.getElementById('device-details').classList.add('hidden');
          var resultEl = document.getElementById('device-result');
          var textEl = document.getElementById('result-text');
          resultEl.classList.remove('hidden');
          if (action === 'approve') {
            textEl.textContent = 'Device approved! The installer will continue automatically.';
            textEl.className = 'text-lg mb-4 text-green-400';
          } else {
            textEl.textContent = 'Device denied. The installer will not proceed.';
            textEl.className = 'text-lg mb-4 text-red-400';
          }
        } catch(e) {
          errEl.textContent = e.message || 'Action failed';
          errEl.classList.remove('hidden');
        }
      }
      </script>
    `);
    return reply.type('text/html').send(html);
  });

  // Lookup device by code (portal-authenticated, must be tenant's device)
  app.post('/devices/lookup', { preHandler: portalAuth }, async (req, reply) => {
    const tenantId = (req as unknown as Record<string, unknown>).tenantId as string;
    const body = req.body as { deviceCode?: string } | null;
    if (!body?.deviceCode) {
      return reply.status(400).send({ error: 'deviceCode required.' });
    }

    const device = await prisma.tenantDevice.findUnique({
      where: { deviceCode: body.deviceCode.toUpperCase() },
    });

    if (!device || device.tenantId !== tenantId) {
      return reply.status(404).send({ error: 'Device code not found or does not belong to your account.' });
    }

    if (device.status !== 'pending') {
      return reply.status(400).send({ error: `Device already ${device.status}.` });
    }

    if (device.expiresAt < new Date()) {
      await prisma.tenantDevice.update({
        where: { id: device.id },
        data: { status: 'expired' },
      });
      return reply.status(400).send({ error: 'Device code expired.' });
    }

    return reply.send({
      hostname: device.hostname,
      os: device.os,
      arch: device.arch,
      ip: device.ip,
    });
  });

  // Approve device
  app.post('/devices/approve', { preHandler: portalAuth }, async (req, reply) => {
    const tenantId = (req as unknown as Record<string, unknown>).tenantId as string;
    const body = req.body as { deviceCode?: string } | null;
    if (!body?.deviceCode) {
      return reply.status(400).send({ error: 'deviceCode required.' });
    }

    const device = await prisma.tenantDevice.findUnique({
      where: { deviceCode: body.deviceCode.toUpperCase() },
    });

    if (!device || device.tenantId !== tenantId) {
      return reply.status(404).send({ error: 'Device not found.' });
    }

    if (device.status !== 'pending') {
      return reply.status(400).send({ error: `Device already ${device.status}.` });
    }

    if (device.expiresAt < new Date()) {
      await prisma.tenantDevice.update({
        where: { id: device.id },
        data: { status: 'expired' },
      });
      return reply.status(400).send({ error: 'Device code expired.' });
    }

    await prisma.tenantDevice.update({
      where: { id: device.id },
      data: { status: 'approved', approvedAt: new Date() },
    });

    return reply.send({ ok: true });
  });

  // Deny device
  app.post('/devices/deny', { preHandler: portalAuth }, async (req, reply) => {
    const tenantId = (req as unknown as Record<string, unknown>).tenantId as string;
    const body = req.body as { deviceCode?: string } | null;
    if (!body?.deviceCode) {
      return reply.status(400).send({ error: 'deviceCode required.' });
    }

    const device = await prisma.tenantDevice.findUnique({
      where: { deviceCode: body.deviceCode.toUpperCase() },
    });

    if (!device || device.tenantId !== tenantId) {
      return reply.status(404).send({ error: 'Device not found.' });
    }

    if (device.status !== 'pending') {
      return reply.status(400).send({ error: `Device already ${device.status}.` });
    }

    await prisma.tenantDevice.update({
      where: { id: device.id },
      data: { status: 'denied' },
    });

    return reply.send({ ok: true });
  });

  // List devices (portal-authenticated)
  app.get('/devices', { preHandler: portalAuth }, async (req, reply) => {
    const tenantId = (req as unknown as Record<string, unknown>).tenantId as string;
    const devices = await prisma.tenantDevice.findMany({
      where: { tenantId, status: 'approved' },
      orderBy: { approvedAt: 'desc' },
      select: {
        id: true, hostname: true, os: true, arch: true, ip: true,
        approvedAt: true, createdAt: true,
      },
    });
    return reply.send({ devices });
  });

  // Revoke device
  app.post('/devices/revoke', { preHandler: portalAuth }, async (req, reply) => {
    const tenantId = (req as unknown as Record<string, unknown>).tenantId as string;
    const body = req.body as { deviceId?: string } | null;
    if (!body?.deviceId) {
      return reply.status(400).send({ error: 'deviceId required.' });
    }

    const device = await prisma.tenantDevice.findUnique({
      where: { id: body.deviceId },
    });

    if (!device || device.tenantId !== tenantId) {
      return reply.status(404).send({ error: 'Device not found.' });
    }

    await prisma.tenantDevice.delete({
      where: { id: device.id },
    });

    return reply.send({ ok: true });
  });
}
