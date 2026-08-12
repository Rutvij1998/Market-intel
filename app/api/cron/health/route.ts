import { NextResponse } from 'next/server';
import { cronAuthDiagnostics, unauthorizedCronResponse, verifyCronAuth } from '@/lib/cronAuth';
import { finishJobRun, startJobRun } from '@/lib/jobRuns';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * Lightweight cron auth + config probe.
 * Use to verify Vercel Cron can reach the app without running a full ingest:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://your-app/api/cron/health
 */
export async function GET(request: Request) {
  const auth = verifyCronAuth(request);
  const diag = cronAuthDiagnostics();
  const ua = request.headers.get('user-agent') || '';
  const isVercelCron = /vercel-cron/i.test(ua);

  if (!auth.ok) {
    const startedAt = Date.now();
    const runId = await startJobRun({
      jobName: 'cron_health',
      trigger: isVercelCron ? 'cron' : 'api',
      details: { authFailed: true, reason: auth.reason },
    });
    await finishJobRun(runId, {
      status: 'error',
      error: auth.reason,
      message: 'Health check unauthorized',
      startedAt,
    });
    return unauthorizedCronResponse(auth.reason);
  }

  const startedAt = Date.now();
  const runId = await startJobRun({
    jobName: 'cron_health',
    trigger: isVercelCron || auth.mode === 'open' ? 'cron' : 'api',
    details: { authMode: auth.mode, probe: true },
  });
  await finishJobRun(runId, {
    status: 'success',
    message: 'Cron health OK',
    details: { authMode: auth.mode, ...diag },
    startedAt,
  });

  return NextResponse.json({
    success: true,
    ok: true,
    message: 'Cron endpoint reachable and authorized',
    authMode: auth.mode,
    isVercelCron,
    ...diag,
    job_run_id: runId,
    schedules: {
      cron_ingest: '0 8 * * * → /api/cron/ingest',
      notifications: '0 9 * * * → /api/notifications/run',
    },
    tips: [
      'Vercel Cron does not follow redirects — Deployment Protection (SSO) on *.vercel.app deployment hosts will block cron (302 → login).',
      'Set Project Settings → Deployment Protection → Vercel Authentication to "Only Preview Deployments" so production cron hosts work.',
      'CRON_SECRET must be set in the same environment as production; Vercel sends Authorization: Bearer automatically.',
    ],
  });
}
