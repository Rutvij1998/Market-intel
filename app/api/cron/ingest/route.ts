import { NextResponse } from 'next/server';
import { runIngestion } from '@/lib/ingest';
import { finishJobRun, startJobRun } from '@/lib/jobRuns';
import { unauthorizedCronResponse, verifyCronAuth } from '@/lib/cronAuth';
import { notifyCronOutcome } from '@/lib/cronNotify';

export const dynamic = 'force-dynamic';
/** Ingest scrapes Reddit + BBB and can take several minutes. Hobby/Pro max is typically 300s. */
export const maxDuration = 300;

// Cron: twice daily (see vercel.json) — morning + evening UTC schedules.
// Window: last 24 hours of source data only.
// Alert digests run separately via /api/notifications/run.

const CRON_SINCE_HOURS = 24;
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
    await notifyCronOutcome({
      jobName: 'cron_ingest',
      status: 'error',
      message: 'Rejected: unauthorized',
      error: auth.reason,
      durationMs: Date.now() - startedAt,
      jobRunId: runId,
    });
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

    const message =
      result.message ||
      `Ingested last ${CRON_SINCE_HOURS}h: ${result.count ?? 0} mentions` +
        (result.sources
          ? ` (reddit=${result.sources.reddit}, pc=${result.sources.pissedconsumer}, bbb=${result.sources.bbb})`
          : '');

    const ok = result.success !== false;
    const details = {
      count: result.count,
      sources: result.sources,
      sinceHours: CRON_SINCE_HOURS,
      authMode: auth.mode,
      partial: (result as { partial?: boolean }).partial ?? false,
      elapsedMs: (result as { elapsedMs?: number }).elapsedMs ?? Date.now() - startedAt,
      processed: (result as { processed?: number }).processed,
      candidates: (result as { candidates?: number }).candidates,
    };

    await finishJobRun(runId, {
      status: ok ? 'success' : 'error',
      message,
      details,
      error: ok ? undefined : result.message || 'ingest failed',
      startedAt,
    });

    await notifyCronOutcome({
      jobName: 'cron_ingest',
      status: ok ? 'success' : 'error',
      message,
      error: ok ? undefined : result.message || 'ingest failed',
      details,
      durationMs: Date.now() - startedAt,
      jobRunId: runId,
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
    await notifyCronOutcome({
      jobName: 'cron_ingest',
      status: 'error',
      message: 'Cron ingest failed',
      error: msg,
      durationMs: Date.now() - startedAt,
      jobRunId: runId,
    });
    return NextResponse.json({ success: false, error: msg, job_run_id: runId }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
