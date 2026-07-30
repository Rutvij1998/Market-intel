import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { processAlertDigests } from '@/lib/alertReport';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/sessionAuth';

export const dynamic = 'force-dynamic';
// Screenshots need headless Chromium — allow longer runs on hosts that support it
export const maxDuration = 120;

async function authorized(request: Request): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    const querySecret = new URL(request.url).searchParams.get('secret');
    const provided = authHeader?.replace('Bearer ', '') || querySecret;
    if (provided === cronSecret) return true;
  }

  // Dashboard "Run digest now" — allow signed-in users
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (token && (await verifySessionToken(token))) return true;
  } catch {
    /* ignore */
  }

  if (cronSecret) return false;
  return true;
}

async function parseRunOptions(request: Request): Promise<{
  force: boolean;
  onlyEmail?: string;
}> {
  const url = new URL(request.url);
  let force =
    url.searchParams.get('force') === '1' || url.searchParams.get('force') === 'true';
  let onlyEmail = url.searchParams.get('email') || undefined;

  if (request.method === 'POST') {
    try {
      const body = await request.json().catch(() => null);
      if (body) {
        if (body.force === true || body.force === 1 || body.force === '1') force = true;
        if (typeof body.email === 'string' && body.email.trim()) {
          onlyEmail = body.email.trim().toLowerCase();
        }
        if (typeof body.onlyEmail === 'string' && body.onlyEmail.trim()) {
          onlyEmail = body.onlyEmail.trim().toLowerCase();
        }
      }
    } catch {
      /* no body */
    }
  }

  return { force, onlyEmail };
}

/** Cron / manual: send live dashboard screenshot digests for matching threads. */
export async function GET(request: Request) {
  if (!(await authorized(request))) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { force, onlyEmail } = await parseRunOptions(request);
    const result = await processAlertDigests({ sinceHours: 72, force, onlyEmail });
    return NextResponse.json({ success: true, ...result });
  } catch (e: any) {
    console.error('[notifications/run]', e);
    return NextResponse.json({ success: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await authorized(request))) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { force, onlyEmail } = await parseRunOptions(request);
    const result = await processAlertDigests({ sinceHours: 72, force, onlyEmail });
    return NextResponse.json({ success: true, ...result });
  } catch (e: any) {
    console.error('[notifications/run]', e);
    return NextResponse.json({ success: false, error: e?.message || 'failed' }, { status: 500 });
  }
}
