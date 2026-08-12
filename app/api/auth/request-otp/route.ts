import { NextResponse, type NextRequest } from 'next/server';
import { emailConfigured, sendEmail } from '@/lib/email';
import {
  clearOtpChallengeCookieOptions,
  createOtpChallenge,
  DOMAIN_ERROR,
  generateOtp,
  normalizeLikewizeEmail,
  OTP_CHALLENGE_COOKIE,
  OTP_RESEND_COOLDOWN_MS,
  otpChallengeCookieOptions,
  otpEmailHtml,
  otpEmailText,
  parseOtpChallenge,
} from '@/lib/otpAuth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const email = normalizeLikewizeEmail(body.email || '');
  if (!email) {
    return NextResponse.json({ ok: false, error: DOMAIN_ERROR }, { status: 403 });
  }

  if (!emailConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Email is not configured. Set SMTP_HOST / SMTP_USER / SMTP_PASS (or RESEND_API_KEY) and EMAIL_FROM.',
      },
      { status: 503 },
    );
  }

  const existingToken = request.cookies.get(OTP_CHALLENGE_COOKIE)?.value;
  if (existingToken) {
    const existing = await parseOtpChallenge(existingToken);
    if (
      existing &&
      existing.email === email &&
      Date.now() - existing.issuedAt < OTP_RESEND_COOLDOWN_MS
    ) {
      const waitSec = Math.ceil(
        (OTP_RESEND_COOLDOWN_MS - (Date.now() - existing.issuedAt)) / 1000,
      );
      return NextResponse.json(
        { ok: false, error: `Please wait ${waitSec}s before requesting another code.` },
        { status: 429 },
      );
    }
  }

  const otp = generateOtp();
  const { token } = await createOtpChallenge(email, otp);

  const sent = await sendEmail({
    to: email,
    subject: 'Your Market Vantage sign-in code',
    html: otpEmailHtml(otp),
    text: otpEmailText(otp),
  });

  if (!sent.ok) {
    console.error('[auth/request-otp] email failed:', sent.error);
    return NextResponse.json(
      { ok: false, error: 'Could not send sign-in code. Try again shortly.' },
      { status: 502 },
    );
  }

  const res = NextResponse.json({
    ok: true,
    email,
    message: 'A sign-in code has been sent to your email.',
  });

  res.cookies.set(OTP_CHALLENGE_COOKIE, '', { ...clearOtpChallengeCookieOptions(), maxAge: 0 });
  res.cookies.set(OTP_CHALLENGE_COOKIE, token, otpChallengeCookieOptions());
  return res;
}
