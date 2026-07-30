import { NextResponse } from 'next/server';
import {
  createSessionToken,
  dashboardCredentials,
  safeEqual,
  sessionCookieOptions,
  SESSION_COOKIE,
} from '@/lib/sessionAuth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const username = (body.username || '').trim();
  const password = body.password || '';
  const creds = dashboardCredentials();

  const userOk = safeEqual(username, creds.username);
  const passOk = safeEqual(password, creds.password);

  if (!userOk || !passOk) {
    return NextResponse.json(
      { ok: false, error: 'Invalid username or password.' },
      { status: 401 },
    );
  }

  const token = await createSessionToken(creds.username);
  const res = NextResponse.json({ ok: true, redirect: '/dashboard' });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
