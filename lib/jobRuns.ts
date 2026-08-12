import { supabaseAdmin } from '@/lib/supabase';

export type JobName = 'cron_ingest' | 'notifications' | 'manual_ingest' | string;
export type JobTrigger = 'cron' | 'manual' | 'api' | string;
export type JobStatus = 'running' | 'success' | 'error';

export interface JobRun {
  id: string;
  job_name: JobName;
  trigger: JobTrigger;
  status: JobStatus | string;
  started_at: string;
  finished_at?: string | null;
  duration_ms?: number | null;
  message?: string | null;
  error?: string | null;
  details?: Record<string, unknown> | null;
}

/** How long a job may stay "running" before we treat it as abandoned. */
export function staleThresholdMs(jobName: string): number {
  switch (jobName) {
    case 'cron_ingest':
      // Vercel maxDuration 300s — allow a little headroom
      return 12 * 60 * 1000;
    case 'manual_ingest':
      // Long scrapes; still shouldn't hang forever
      return 25 * 60 * 1000;
    case 'notifications':
      return 10 * 60 * 1000;
    case 'cron_health':
      return 2 * 60 * 1000;
    default:
      return 15 * 60 * 1000;
  }
}

/**
 * Insert a "running" row when a background job starts.
 * Returns the row id (or null if Supabase is unavailable / table missing).
 */
export async function startJobRun(opts: {
  jobName: JobName;
  trigger?: JobTrigger;
  details?: Record<string, unknown>;
}): Promise<string | null> {
  if (!supabaseAdmin) {
    console.warn('[jobRuns] supabaseAdmin not configured — skip start log');
    return null;
  }

  // Close out abandoned runs so "last status" isn't stuck forever
  try {
    await markStaleRunningJobs({ jobName: opts.jobName });
  } catch {
    /* non-fatal */
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('job_runs')
      .insert({
        job_name: opts.jobName,
        trigger: opts.trigger || 'api',
        status: 'running',
        started_at: new Date().toISOString(),
        details: opts.details || null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[jobRuns] start failed:', error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (e: unknown) {
    console.error('[jobRuns] start exception:', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Mark a job run finished (success or error) with optional summary.
 */
export async function finishJobRun(
  runId: string | null,
  opts: {
    status: 'success' | 'error';
    message?: string;
    error?: string;
    details?: Record<string, unknown>;
    startedAt?: number;
  },
): Promise<void> {
  if (!runId || !supabaseAdmin) return;

  const finishedAt = new Date();
  let durationMs: number | null =
    typeof opts.startedAt === 'number' && opts.startedAt > 0
      ? Math.max(0, finishedAt.getTime() - opts.startedAt)
      : null;

  try {
    // If caller didn't pass startedAt, derive duration from the row
    if (durationMs == null) {
      const { data: row } = await supabaseAdmin
        .from('job_runs')
        .select('started_at')
        .eq('id', runId)
        .maybeSingle();
      if (row?.started_at) {
        const start = new Date(row.started_at).getTime();
        if (!Number.isNaN(start)) durationMs = Math.max(0, finishedAt.getTime() - start);
      }
    }

    // Only update if still running (avoid clobbering a completed row)
    const { error } = await supabaseAdmin
      .from('job_runs')
      .update({
        status: opts.status,
        finished_at: finishedAt.toISOString(),
        duration_ms: durationMs,
        message: opts.message ?? null,
        error: opts.error ?? null,
        details: opts.details ?? null,
      })
      .eq('id', runId)
      .eq('status', 'running');

    if (error) {
      console.error('[jobRuns] finish failed:', error.message);
    }
  } catch (e: unknown) {
    console.error('[jobRuns] finish exception:', e instanceof Error ? e.message : e);
  }
}

/**
 * Mark abandoned "running" jobs as errors.
 * Vercel kills long functions without running finally blocks — those rows stay running forever otherwise.
 */
export async function markStaleRunningJobs(opts?: {
  jobName?: string;
  /** Override threshold in ms (applied per matching job) */
  olderThanMs?: number;
}): Promise<number> {
  if (!supabaseAdmin) return 0;

  try {
    let query = supabaseAdmin
      .from('job_runs')
      .select('id, job_name, started_at, details')
      .eq('status', 'running')
      .order('started_at', { ascending: true })
      .limit(100);

    if (opts?.jobName) {
      query = query.eq('job_name', opts.jobName);
    }

    const { data, error } = await query;
    if (error || !data?.length) {
      if (error) console.error('[jobRuns] stale query failed:', error.message);
      return 0;
    }

    const now = Date.now();
    let closed = 0;

    for (const row of data) {
      const start = new Date(row.started_at).getTime();
      if (Number.isNaN(start)) continue;
      const age = now - start;
      const threshold = opts?.olderThanMs ?? staleThresholdMs(String(row.job_name));
      if (age < threshold) continue;

      const durationMs = Math.max(0, age);
      const mins = Math.round(durationMs / 60000);
      const finishedAt = new Date().toISOString();
      const prevDetails =
        row.details && typeof row.details === 'object' ? (row.details as Record<string, unknown>) : {};

      const { error: upErr } = await supabaseAdmin
        .from('job_runs')
        .update({
          status: 'error',
          finished_at: finishedAt,
          duration_ms: durationMs,
          message: `Timed out after ~${mins}m (process killed or never finished)`,
          error:
            'Job left in "running" past the expected limit. Common causes: Vercel maxDuration kill, fire-and-forget work stopped after response, or crash without finish log.',
          details: {
            ...prevDetails,
            stale: true,
            stale_threshold_ms: threshold,
            closed_at: finishedAt,
          },
        })
        .eq('id', row.id)
        .eq('status', 'running');

      if (!upErr) {
        closed++;
        console.warn(
          `[jobRuns] Marked stale run ${row.id} (${row.job_name}) as error after ${mins}m`,
        );
      }
    }

    return closed;
  } catch (e: unknown) {
    console.error('[jobRuns] markStale exception:', e instanceof Error ? e.message : e);
    return 0;
  }
}

/**
 * Convenience wrapper: start → run fn → finish with success/error.
 * Always rethrows so callers keep existing error handling.
 */
export async function withJobRun<T>(
  opts: {
    jobName: JobName;
    trigger?: JobTrigger;
    details?: Record<string, unknown>;
  },
  fn: () => Promise<T>,
  summarize?: (result: T) => { message?: string; details?: Record<string, unknown> },
): Promise<T> {
  const startedAt = Date.now();
  const runId = await startJobRun(opts);
  try {
    const result = await fn();
    const summary = summarize?.(result) || {};
    await finishJobRun(runId, {
      status: 'success',
      message: summary.message,
      details: summary.details,
      startedAt,
    });
    return result;
  } catch (e: unknown) {
    await finishJobRun(runId, {
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
      startedAt,
    });
    throw e;
  }
}

export function jobDisplayName(jobName: string): string {
  switch (jobName) {
    case 'cron_ingest':
      return 'Daily ingest (cron)';
    case 'notifications':
      return 'Alert digests';
    case 'manual_ingest':
      return 'Manual sync';
    default:
      return jobName;
  }
}
