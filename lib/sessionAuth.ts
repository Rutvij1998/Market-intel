/**
 * Simple shared-credential session for Market Vantage.
 * Username/password from env (defaults: Likewize / Likewize2026!).
 */

export const SESSION_COOKIE = 'mv_session';
const SESSION_DAYS = 14;

export function dashboardCredentials() {
  return {
    username: process.env.DASHBOARD_USERNAME || 'Likewize',
    password: process.env.DASHBOARD_PASSWORD || 'Likewize2026!',
  };
}

function authSecret(): string {
  return (
    process.env.AUTH_SECRET ||
    process.env.CRON_SECRET ||
    'market-vantage-dev-secret-change-in-prod'
  );
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]!);
  // btoa available in edge + node
  const b64 = btoa(s);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importHmacKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(authSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Create a signed session token (username + expiry). */
export async function createSessionToken(username: string): Promise<string> {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${username}|${exp}`;
  const key = await importHmacKey();
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${toBase64Url(new TextEncoder().encode(payload))}.${toBase64Url(sig)}`;
}

/** Verify cookie value; returns username or null. */
export async function verifySessionToken(token?: string | null): Promise<string | null> {
  if (!token || !token.includes('.')) return null;
  const [payloadB64, sigB64] = token.split('.');
  if (!payloadB64 || !sigB64) return null;

  try {
    const key = await importHmacKey();
    const payloadBytes = fromBase64Url(payloadB64);
    const sigBytes = fromBase64Url(sigB64);
    const ok = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes as BufferSource,
      payloadBytes as BufferSource,
    );
    if (!ok) return null;

    const payload = new TextDecoder().decode(payloadBytes);
    const [username, expStr] = payload.split('|');
    const exp = Number(expStr);
    if (!username || !Number.isFinite(exp) || Date.now() > exp) return null;

    const { username: expected } = dashboardCredentials();
    if (username !== expected) return null;
    return username;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAgeSeconds = SESSION_DAYS * 24 * 60 * 60) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/** Timing-safe string compare (edge-safe). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
