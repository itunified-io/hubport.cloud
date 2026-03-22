const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

// Key: "ip:codeHash", Value: timestamps
const attempts = new Map<string, number[]>();

export function checkRedeemRateLimit(ip: string, codeHash: string): boolean {
  const key = `${ip}:${codeHash}`;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  const timestamps = (attempts.get(key) || []).filter((t) => t > windowStart);
  attempts.set(key, timestamps);

  if (timestamps.length >= MAX_ATTEMPTS) {
    return false; // rate limited
  }

  timestamps.push(now);
  return true; // allowed
}

// Cleanup stale entries every 30 minutes
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, timestamps] of attempts.entries()) {
    const valid = timestamps.filter((t) => t > cutoff);
    if (valid.length === 0) {
      attempts.delete(key);
    } else {
      attempts.set(key, valid);
    }
  }
}, 30 * 60 * 1000).unref();
