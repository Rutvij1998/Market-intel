/**
 * Email OTP for Likewize dashboard sign-in.
 * Challenge is a short-lived HMAC-signed cookie (no DB).
 */

import { isLikewizeEmail } from '@/lib/likewizeEmail';
import {
  createSignedPayload,
  safeEqual,
  sessionCookieOptions,
  verifySignedPayload,
} from '@/lib/sessionAuth';

export { DOMAIN_ERROR, isLikewizeEmail, normalizeLikewizeEmail } from '@/lib/likewizeEmail';

export const OTP_CHALLENGE_COOKIE = 'mv_otp_challenge';
export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 45 * 1000;

export interface OtpChallenge {
  email: string;
  exp: number;
  otpHash: string;
  attempts: number;
  issuedAt: number;
  nonce: string;
}

/** Cryptographically random 6-digit code (000000–999999). */
export function generateOtp(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0]! % 1_000_000).padStart(6, '0');
}

export async function hashOtp(otp: string, email: string, nonce: string): Promise<string> {
  // Bind hash to email + nonce so a leaked code is useless against another challenge
  const key = await importOtpKey();
  const data = new TextEncoder().encode(`${email}|${otp}|${nonce}`);
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return toHex(new Uint8Array(sig));
}

async function importOtpKey(): Promise<CryptoKey> {
  const secret = (
    process.env.AUTH_SECRET ||
    process.env.CRON_SECRET ||
    ''
  ).trim();
  const resolved =
    secret ||
    (process.env.NODE_ENV === 'production' || process.env.VERCEL === '1'
      ? ''
      : 'market-vantage-local-dev-only-not-for-prod');
  if (!resolved) {
    throw new Error(
      'AUTH_SECRET (or CRON_SECRET) must be set in production. Refusing weak default.',
    );
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`otp:${resolved}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomNonce(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return toHex(buf);
}

export async function createOtpChallenge(
  email: string,
  otp: string,
): Promise<{ token: string; challenge: OtpChallenge }> {
  const issuedAt = Date.now();
  const exp = issuedAt + OTP_TTL_MS;
  const nonce = randomNonce();
  const otpHash = await hashOtp(otp, email, nonce);
  const challenge: OtpChallenge = {
    email,
    exp,
    otpHash,
    attempts: 0,
    issuedAt,
    nonce,
  };
  const token = await createSignedPayload(serializeChallenge(challenge));
  return { token, challenge };
}

export async function parseOtpChallenge(
  token?: string | null,
): Promise<OtpChallenge | null> {
  const payload = await verifySignedPayload(token);
  if (!payload) return null;
  return deserializeChallenge(payload);
}

export async function reissueChallengeToken(challenge: OtpChallenge): Promise<string> {
  return createSignedPayload(serializeChallenge(challenge));
}

function serializeChallenge(c: OtpChallenge): string {
  return [c.email, c.exp, c.otpHash, c.attempts, c.issuedAt, c.nonce].join('|');
}

function deserializeChallenge(payload: string): OtpChallenge | null {
  const parts = payload.split('|');
  if (parts.length !== 6) return null;
  const [email, expStr, otpHash, attemptsStr, issuedAtStr, nonce] = parts;
  if (!email || !otpHash || !nonce) return null;
  const exp = Number(expStr);
  const attempts = Number(attemptsStr);
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(exp) || !Number.isFinite(attempts) || !Number.isFinite(issuedAt)) {
    return null;
  }
  if (!isLikewizeEmail(email)) return null;
  if (Date.now() > exp) return null;
  return { email, exp, otpHash, attempts, issuedAt, nonce };
}

/** Verify submitted OTP against challenge. Timing-safe. */
export async function otpMatches(
  challenge: OtpChallenge,
  otp: string,
): Promise<boolean> {
  const cleaned = otp.replace(/\s+/g, '').trim();
  if (!/^\d{6}$/.test(cleaned)) return false;
  const computed = await hashOtp(cleaned, challenge.email, challenge.nonce);
  return safeEqual(computed, challenge.otpHash);
}

export function otpChallengeCookieOptions(maxAgeSeconds = Math.ceil(OTP_TTL_MS / 1000)) {
  return sessionCookieOptions(maxAgeSeconds);
}

export function clearOtpChallengeCookieOptions() {
  return sessionCookieOptions(0);
}

export function otpEmailHtml(otp: string): string {
  return `
<!DOCTYPE html>
<html>
<body style="font-family: system-ui, sans-serif; color: #111; line-height: 1.5;">
  <p>Your Market Vantage sign-in code is:</p>
  <p style="font-size: 28px; font-weight: 700; letter-spacing: 0.2em; color: #3200BE;">${otp}</p>
  <p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>
  <p style="color: #666; font-size: 12px;">Likewize · Market Vantage</p>
</body>
</html>`.trim();
}

export function otpEmailText(otp: string): string {
  return `Your Market Vantage sign-in code is: ${otp}

This code expires in 10 minutes. If you did not request it, you can ignore this email.

— Likewize · Market Vantage`;
}
