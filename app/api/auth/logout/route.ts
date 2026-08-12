import { NextResponse, type NextRequest } from 'next/server';
import { markUserLoggedOut } from '@/lib/dashboardAuthStore';
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  verifySessionToken,
} from '@/lib/sessionAuth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const email = token ? await verifySessionToken(token) : null;
  if (email) {
    await markUserLoggedOut(email);
  }

  const res = NextResponse.json({ ok: true, redirect: '/' });
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(0), maxAge: 0 });
  return res;
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const email = token ? await verifySessionToken(token) : null;
  if (email) {
    await markUserLoggedOut(email);
  }

  const origin =
    request.nextUrl?.origin ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3000';
  const res = NextResponse.redirect(new URL('/', origin));
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(0), maxAge: 0 });
  return res;
}
