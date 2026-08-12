import { NextResponse, type NextRequest } from 'next/server';
import {
  clearOtpChallengeCookieOptions,
  OTP_CHALLENGE_COOKIE,
  OTP_MAX_ATTEMPTS,
  otpChallengeCookieOptions,
  otpMatches,
  parseOtpChallenge,
  reissueChallengeToken,
} from '@/lib/otpAuth';
import { markUserAuthenticated } from '@/lib/dashboardAuthStore';
import {
  createSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE,
} from '@/lib/sessionAuth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let body: { otp?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const otp = (body.otp || '').replace(/\s+/g, '').trim();
  if (!/^\d{6}$/.test(otp)) {
    return NextResponse.json(
      { ok: false, error: 'Enter the 6-digit code from your email.' },
      { status: 400 },
    );
  }

  const challengeToken = request.cookies.get(OTP_CHALLENGE_COOKIE)?.value;
  const challenge = await parseOtpChallenge(challengeToken);

  if (!challenge) {
    return NextResponse.json(
      { ok: false, error: 'Sign-in code expired. Request a new code.' },
      { status: 401 },
    );
  }

  if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
    const res = NextResponse.json(
      { ok: false, error: 'Too many attempts. Request a new code.' },
      { status: 401 },
    );
    res.cookies.set(OTP_CHALLENGE_COOKIE, '', { ...clearOtpChallengeCookieOptions(), maxAge: 0 });
    return res;
  }

  const match = await otpMatches(challenge, otp);
  if (!match) {
    const nextAttempts = challenge.attempts + 1;
    if (nextAttempts >= OTP_MAX_ATTEMPTS) {
      const res = NextResponse.json(
        { ok: false, error: 'Too many attempts. Request a new code.' },
        { status: 401 },
      );
      res.cookies.set(OTP_CHALLENGE_COOKIE, '', {
        ...clearOtpChallengeCookieOptions(),
        maxAge: 0,
      });
      return res;
    }

    const updated = { ...challenge, attempts: nextAttempts };
    const token = await reissueChallengeToken(updated);
    const remaining = OTP_MAX_ATTEMPTS - nextAttempts;
    const res = NextResponse.json(
      {
        ok: false,
        error: `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
      },
      { status: 401 },
    );
    res.cookies.set(OTP_CHALLENGE_COOKIE, token, otpChallengeCookieOptions());
    return res;
  }

  const session = await createSessionToken(challenge.email);
  // Persist email + authenticated=true in Supabase (non-blocking on failure)
  await markUserAuthenticated(challenge.email);

  const res = NextResponse.json({
    ok: true,
    redirect: '/dashboard',
    email: challenge.email,
  });
  res.cookies.set(OTP_CHALLENGE_COOKIE, '', { ...clearOtpChallengeCookieOptions(), maxAge: 0 });
  res.cookies.set(SESSION_COOKIE, session, sessionCookieOptions());
  return res;
}
