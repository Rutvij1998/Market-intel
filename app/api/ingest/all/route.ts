import { after } from 'next/server';
import { NextResponse } from 'next/server';
import { runIngestion } from '@/lib/ingest';
import { finishJobRun, startJobRun } from '@/lib/jobRuns';

export const dynamic = 'force-dynamic';
/** Allow long manual syncs on hosts that honor maxDuration */
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = (body.mode === 'full' ? 'full' : 'update') as 'full' | 'update';

    const startedAt = Date.now();
    // Create the running row *before* responding so the admin panel sees it immediately
    const runId = await startJobRun({
      jobName: 'manual_ingest',
      trigger: 'manual',
      details: { mode },
    });

    // `after()` keeps work alive after the HTTP response on Next/Vercel
    // (plain fire-and-forget often freezes when the response is sent → stuck "running").
    after(async () => {
      try {
        const result = await runIngestion({ mode });
        console.log(
          '[Ingest API] Background ingestion completed:',
          result.message || `count=${result.count}`,
        );
        await finishJobRun(runId, {
          status: result.success === false ? 'error' : 'success',
          message:
            result.message ||
            `Ingested ${result.count ?? 0} mentions` +
              (result.sources
                ? ` (reddit=${result.sources.reddit}, pc=${result.sources.pissedconsumer}, bbb=${result.sources.bbb})`
                : ''),
          details: {
            count: result.count,
            sources: result.sources,
            mode,
          },
          error: result.success === false ? result.message || 'ingest failed' : undefined,
          startedAt,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Ingest API] Background ingestion failed:', msg);
        await finishJobRun(runId, {
          status: 'error',
          error: msg,
          details: { mode },
          startedAt,
        });
      }
    });

    return NextResponse.json({
      success: true,
      started: true,
      mode,
      job_run_id: runId,
      sources: { reddit: 0, pissedconsumer: 0 },
      message:
        'Data sync started in background. New records are saved to the database. Click "Refresh" to load results. Check Admin job logs for completion.',
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to start ingestion';
    console.error('Reddit ingest error (startup):', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
