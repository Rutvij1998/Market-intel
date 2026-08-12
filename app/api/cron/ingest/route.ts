import { NextResponse } from 'next/server';
import { runIngestion } from '@/lib/ingest';
import { finishJobRun, startJobRun } from '@/lib/jobRuns';
import { unauthorizedCronResponse, verifyCronAuth } from '@/lib/cronAuth';

export const dynamic = 'force-dynamic';
/** Ingest scrapes Reddit + BBB and can take several minutes. Hobby/Pro max is typically 300s. */
export const maxDuration = 300;

// Cron endpoint for daily background data collection (Reddit + Trustpilot + BBB).
// Always performs incremental 'update' ingestion and writes results to Supabase first.
// The UI loads exclusively from Supabase via loadFromSupabase().
//
// Auth: if CRON_SECRET is set, require Authorization: Bearer <secret> or ?secret=
// Vercel Cron injects the Bearer header automatically when CRON_SECRET is configured.
//
// Schedule: vercel.json → "0 8 * * *" (daily 08:00 UTC; Hobby may fire anytime that hour)
// Window: last 24 hours of source data only.
// Alert digests run separately at 09:00 UTC via /api/notifications/run (do not stack them here).

/** Daily cron lookback for scrape */
const CRON_SINCE_HOURS = 24;
/**
 * Soft budget inside the 300s hard limit. Leave ~45s for finishJobRun + response
 * so rows never stick in "running" when Vercel kills the lambda.
 */
const CRON_RUNTIME_BUDGET_MS = 255_000;

export async function GET(request: Request) {
  const auth = verifyCronAuth(request);
  if (!auth.ok) {
    const startedAt = Date.now();
    const runId = await startJobRun({
      jobName: 'cron_ingest',
      trigger: 'cron',
      details: { authFailed: true, reason: auth.reason },
    });
    await finishJobRun(runId, {
      status: 'error',
      error: auth.reason,
      message: 'Rejected: unauthorized',
      startedAt,
    });
    console.error('[cron/ingest] unauthorized:', auth.reason);
    return unauthorizedCronResponse(auth.reason);
  }

  const startedAt = Date.now();
  const runId = await startJobRun({
    jobName: 'cron_ingest',
    trigger: auth.mode === 'vercel-cron' || auth.mode === 'open' ? 'cron' : 'api',
    details: {
      mode: 'update',
      sinceHours: CRON_SINCE_HOURS,
      authMode: auth.mode,
      maxRuntimeMs: CRON_RUNTIME_BUDGET_MS,
    },
  });

  try {
    const result = await runIngestion({
      mode: 'update',
      sinceHours: CRON_SINCE_HOURS,
      maxRuntimeMs: CRON_RUNTIME_BUDGET_MS,
    });

    // Digests are handled by /api/notifications/run at 09:00 UTC — keep this job under budget.

    const message =
      result.message ||
      `Ingested last ${CRON_SINCE_HOURS}h: ${result.count ?? 0} mentions` +
        (result.sources
          ? ` (reddit=${result.sources.reddit}, pc=${result.sources.pissedconsumer}, bbb=${result.sources.bbb})`
          : '');

    const ok = result.success !== false;
    await finishJobRun(runId, {
      status: ok ? 'success' : 'error',
      message,
      details: {
        count: result.count,
        sources: result.sources,
        sinceHours: CRON_SINCE_HOURS,
        authMode: auth.mode,
        partial: (result as { partial?: boolean }).partial ?? false,
        elapsedMs: (result as { elapsedMs?: number }).elapsedMs ?? Date.now() - startedAt,
        processed: (result as { processed?: number }).processed,
        candidates: (result as { candidates?: number }).candidates,
      },
      error: ok ? undefined : result.message || 'ingest failed',
      startedAt,
    });

    return NextResponse.json({
      ...result,
      sinceHours: CRON_SINCE_HOURS,
      job_run_id: runId,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Cron ingest error:', error);
    await finishJobRun(runId, {
      status: 'error',
      error: msg,
      message: 'Cron ingest failed',
      startedAt,
    });
    return NextResponse.json({ success: false, error: msg, job_run_id: runId }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
