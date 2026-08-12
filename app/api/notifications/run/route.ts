import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { processAlertDigests } from '@/lib/alertReport';
import { finishJobRun, startJobRun } from '@/lib/jobRuns';
import { verifyCronAuth } from '@/lib/cronAuth';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/sessionAuth';

export const dynamic = 'force-dynamic';
/** Alert digests may render screenshots + PDF — allow up to plan max. */
export const maxDuration = 300;

async function authorized(request: Request): Promise<boolean> {
  // Cron secret (Bearer / ?secret=) — same rules as /api/cron/*
  if (verifyCronAuth(request).ok) return true;

  // Dashboard session (manual "send now" from UI)
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (token && (await verifySessionToken(token))) return true;
  } catch {
    /* ignore */
  }

  return false;
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

async function handleRun(request: Request) {
  if (!(await authorized(request))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { force, onlyEmail, viewSnapshot } = await parseRunOptions(request);
  // Scheduled cron: last 24h only. Manual "send now" / snapshot may use a wider window.
  const isCron = !onlyEmail && !viewSnapshot && !force;
  const sinceHours = isCron ? 24 : force || viewSnapshot ? 72 : 24;
  const startedAt = Date.now();
  const runId = await startJobRun({
    jobName: 'notifications',
    trigger: isCron ? 'cron' : 'api',
    details: {
      force,
      onlyEmail: onlyEmail || null,
      hasViewSnapshot: !!viewSnapshot,
      sinceHours,
    },
  });

  try {
    const result = await processAlertDigests({
      sinceHours,
      force,
      onlyEmail,
      viewSnapshot,
    });
    const failed = result && (result as { ok?: boolean }).ok === false;
    const errList = Array.isArray((result as { errors?: unknown }).errors)
      ? ((result as { errors: string[] }).errors)
      : [];
    await finishJobRun(runId, {
      status: failed ? 'error' : 'success',
      message: summarizeNotifications(result),
      details: result as Record<string, unknown>,
      error: failed ? errList.join('; ') || 'alerts failed' : undefined,
      startedAt,
    });
    return NextResponse.json({ success: true, ...result, job_run_id: runId });
  } catch (e: any) {
    console.error('[notifications/run]', e);
    await finishJobRun(runId, {
      status: 'error',
      error: e?.message || 'failed',
      startedAt,
    });
    return NextResponse.json(
      { success: false, error: e?.message || 'failed', job_run_id: runId },
      { status: 500 },
    );
  }
}

function summarizeNotifications(result: unknown): string {
  if (!result || typeof result !== 'object') return 'Alert digests processed';
  const r = result as Record<string, unknown>;
  if (typeof r.message === 'string' && r.message) return r.message;
  const parts: string[] = [];
  if (typeof r.emailsSent === 'number') parts.push(`${r.emailsSent} email(s) sent`);
  if (typeof r.subscribers === 'number') parts.push(`${r.subscribers} subscriber(s)`);
  if (Array.isArray(r.errors) && r.errors.length) parts.push(`${r.errors.length} error(s)`);
  if (r.ok === false && !parts.length) return 'Alert digests failed';
  return parts.length ? parts.join(' · ') : 'Alert digests processed';
}

export async function GET(request: Request) {
  return handleRun(request);
}

export async function POST(request: Request) {
  return handleRun(request);
}
