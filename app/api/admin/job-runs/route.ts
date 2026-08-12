import { NextResponse } from 'next/server';
import { cronAuthDiagnostics } from '@/lib/cronAuth';
import { markStaleRunningJobs } from '@/lib/jobRuns';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/job-runs
 * Recent background job runs for the admin dashboard panel.
 * Protected by middleware session (same as other /api/* routes).
 */
export async function GET(request: Request) {
  const diagnostics = {
    ...cronAuthDiagnostics(),
    productionUrl: process.env.NEXT_PUBLIC_APP_URL || null,
    schedule: {
      cron_ingest: 'Daily 08:00 UTC → /api/cron/ingest (maxDuration 300s · last 24h data)',
      notifications: 'Daily 09:00 UTC → /api/notifications/run (maxDuration 300s · last 24h)',
    },
    notes: [
      'Jobs stuck in "running" past their limit are auto-closed as timed out when you refresh logs.',
      'Vercel kills functions at maxDuration; use job duration + stale cleanup to see failures.',
      'If Deployment Protection (SSO) blocks the cron host, jobs never start (302 → login).',
    ],
  };

  if (!supabaseAdmin) {
    return NextResponse.json(
      {
        success: false,
        error: 'Supabase not configured',
        runs: [],
        lastByJob: {},
        diagnostics,
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 100);

  try {
    // Close abandoned "running" rows (killed lambdas never call finishJobRun)
    const staleClosed = await markStaleRunningJobs();

    const { data, error } = await supabaseAdmin
      .from('job_runs')
      .select('id, job_name, trigger, status, started_at, finished_at, duration_ms, message, error, details')
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) {
      // Common when migration 004 has not been applied yet
      const missing =
        error.message?.includes('does not exist') ||
        error.code === '42P01' ||
        error.message?.toLowerCase().includes('job_runs');
      return NextResponse.json(
        {
          success: false,
          error: missing
            ? 'job_runs table missing — run supabase/migrations/004_job_runs.sql in the Supabase SQL Editor'
            : error.message,
          runs: [],
          lastByJob: {},
          migrationRequired: missing,
          diagnostics,
        },
        { status: missing ? 404 : 500 },
      );
    }

    const runs = data || [];
    // First occurrence per job_name (already ordered newest-first)
    const lastByJob: Record<string, (typeof runs)[0]> = {};
    for (const run of runs) {
      const name = run.job_name as string;
      if (!lastByJob[name]) lastByJob[name] = run;
    }

    return NextResponse.json({
      success: true,
      runs,
      lastByJob,
      staleClosed,
      schedule: diagnostics.schedule,
      diagnostics,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'failed';
    console.error('[admin/job-runs]', e);
    return NextResponse.json(
      { success: false, error: msg, runs: [], lastByJob: {}, diagnostics },
      { status: 500 },
    );
  }
}
