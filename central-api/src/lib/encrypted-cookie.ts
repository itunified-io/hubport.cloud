import { encryptToken, decryptToken } from './crypto.js';

const COOKIE_NAME = 'hubport_api_token';
const COOKIE_TTL_SECONDS = 3600;

export function setApiTokenCookie(reply: { header: (name: string, value: string) => unknown }, plaintext: string): void {
  const encrypted = encryptToken(plaintext);
  reply.header(
    'Set-Cookie',
    `${COOKIE_NAME}=${encrypted}; HttpOnly; Secure; SameSite=Strict; Path=/portal; Max-Age=${COOKIE_TTL_SECONDS}`,
  );
}

export function readApiTokenCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(';')) {
    const [key, ...vals] = pair.trim().split('=');
    if (key === COOKIE_NAME) {
      const encrypted = vals.join('=');
      if (!encrypted) return null;
      try { return decryptToken(encrypted); } catch { return null; }
    }
  }
  return null;
}

export function clearApiTokenCookie(reply: { header: (name: string, value: string) => unknown }): void {
  reply.header('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/portal; Max-Age=0`);
}
