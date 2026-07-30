import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { processAlertDigests } from '@/lib/alertReport';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/sessionAuth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function authorized(request: Request): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    const querySecret = new URL(request.url).searchParams.get('secret');
    const provided = authHeader?.replace('Bearer ', '') || querySecret;
    if (provided === cronSecret) return true;
  }

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

type ViewSnapshot = {
  tab: 'overview' | 'competitor';
  range: '7d' | '30d' | '90d' | 'All';
  client: string;
  source: string;
  businessLine: string;
};

function parseSnapshot(raw: unknown): ViewSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as Record<string, unknown>;
  const tab = s.tab === 'competitor' ? 'competitor' : s.tab === 'overview' ? 'overview' : null;
  const range =
    s.range === '7d' || s.range === '30d' || s.range === '90d' || s.range === 'All'
      ? s.range
      : null;
  if (!tab || !range) return undefined;
  return {
    tab,
    range,
    client: typeof s.client === 'string' && s.client.trim() ? s.client.trim() : 'All',
    source: typeof s.source === 'string' && s.source.trim() ? s.source.trim() : 'All',
    businessLine:
      typeof s.businessLine === 'string' && s.businessLine.trim()
        ? s.businessLine.trim()
        : 'All',
  };
}

async function parseRunOptions(request: Request): Promise<{
  force: boolean;
  onlyEmail?: string;
  viewSnapshot?: ViewSnapshot;
}> {
  const url = new URL(request.url);
  let force =
    url.searchParams.get('force') === '1' || url.searchParams.get('force') === 'true';
  let onlyEmail = url.searchParams.get('email') || undefined;
  let viewSnapshot: ViewSnapshot | undefined;

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
        viewSnapshot = parseSnapshot(body.viewSnapshot || body.snapshot);
      }
    } catch {
      /* no body */
    }
  }

  return { force, onlyEmail, viewSnapshot };
}

export async function GET(request: Request) {
  if (!(await authorized(request))) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { force, onlyEmail, viewSnapshot } = await parseRunOptions(request);
    const result = await processAlertDigests({
      sinceHours: 72,
      force,
      onlyEmail,
      viewSnapshot,
    });
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
    const { force, onlyEmail, viewSnapshot } = await parseRunOptions(request);
    const result = await processAlertDigests({
      sinceHours: 72,
      force,
      onlyEmail,
      viewSnapshot,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (e: any) {
    console.error('[notifications/run]', e);
    return NextResponse.json({ success: false, error: e?.message || 'failed' }, { status: 500 });
  }
}
