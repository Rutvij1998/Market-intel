import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/sessionAuth';

/**
 * Protect /dashboard (and future private routes) with the shared session cookie.
 * Public: home, sign-in, cron, static.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic =
    pathname === '/' ||
    pathname.startsWith('/sign-in') ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/api/cron') ||
    pathname.startsWith('/api/notifications/run') ||
    pathname.startsWith('/api/notifications/unsubscribe') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico';

  if (isPublic) {
    // Already signed in? Send them to the dashboard from the login page.
    if (pathname.startsWith('/sign-in')) {
      const token = request.cookies.get(SESSION_COOKIE)?.value;
      if (token && (await verifySessionToken(token))) {
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
    }
    return NextResponse.next();
  }

  // Dashboard + other app APIs require session
  const needsAuth =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/api/');

  if (!needsAuth) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await verifySessionToken(token) : null;

  if (!user) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const signIn = new URL('/sign-in', request.url);
    signIn.searchParams.set('redirect', pathname);
    return NextResponse.redirect(signIn);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
