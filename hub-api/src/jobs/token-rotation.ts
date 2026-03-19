import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const CENTRAL_API_URL = process.env.CENTRAL_API_URL || 'https://api.hubport.cloud';
const ROTATION_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const ROTATION_THRESHOLD_DAYS = 3;

const TOKEN_FILE = process.env.TOKEN_STORE_PATH || join(process.cwd(), '.hubport-token');

async function readToken(): Promise<string | null> {
  const envToken = process.env.HUBPORT_API_TOKEN;
  if (envToken) return envToken;
  try {
    return (await readFile(TOKEN_FILE, 'utf-8')).trim();
  } catch {
    return null;
  }
}

async function storeToken(token: string): Promise<void> {
  await mkdir(join(TOKEN_FILE, '..'), { recursive: true }).catch(() => {});
  await writeFile(TOKEN_FILE, token, { mode: 0o600 });
}

async function checkAndRotate(log: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void }): Promise<void> {
  const token = await readToken();
  if (!token) {
    log.info('[token-rotation] No API token found — wizard may not have completed yet');
    return;
  }
  try {
    const infoRes = await fetch(`${CENTRAL_API_URL}/api/v1/tokens/info`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!infoRes.ok) {
      log.warn(`[token-rotation] Token check failed: ${infoRes.status}`);
      return;
    }
    const { daysUntilExpiry } = await infoRes.json() as { daysUntilExpiry: number };
    log.info(`[token-rotation] Token expires in ${daysUntilExpiry} days`);
    if (daysUntilExpiry <= ROTATION_THRESHOLD_DAYS) {
      log.info('[token-rotation] Rotating token...');
      const rotateRes = await fetch(`${CENTRAL_API_URL}/api/v1/tokens/rotate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (rotateRes.ok) {
        const { token: newToken } = await rotateRes.json() as { token: string };
        await storeToken(newToken);
        log.info('[token-rotation] Token rotated successfully');
      } else {
        log.error(`[token-rotation] Rotation failed: ${rotateRes.status}`);
      }
    }
  } catch (error) {
    log.warn(`[token-rotation] Check failed: ${error instanceof Error ? error.message : 'unknown'}`);
  }
}

export function startTokenRotationJob(log: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void }): void {
  checkAndRotate(log).catch((e) => log.error(`[token-rotation] Startup check failed: ${e}`));
  setInterval(() => {
    checkAndRotate(log).catch((e) => log.error(`[token-rotation] Scheduled check failed: ${e}`));
  }, ROTATION_INTERVAL_MS);
  log.info(`[token-rotation] Job started (interval: ${ROTATION_INTERVAL_MS / 3600000}h, threshold: ${ROTATION_THRESHOLD_DAYS}d)`);
}
