-- Migration: 004_job_runs.sql
-- Tracks cron + manual background job runs so admin can see "last ran at".
-- Run in Supabase → SQL Editor → New query → Run.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.job_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_name TEXT NOT NULL,                 -- e.g. 'cron_ingest' | 'notifications' | 'manual_ingest'
  trigger TEXT NOT NULL DEFAULT 'api',    -- 'cron' | 'manual' | 'api'
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'error')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  message TEXT,
  error TEXT,
  details JSONB                           -- counts, sources, alert summary, etc.
);

CREATE INDEX IF NOT EXISTS idx_job_runs_started_at
  ON public.job_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_runs_job_name_started
  ON public.job_runs (job_name, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_runs_status
  ON public.job_runs (status);

COMMENT ON TABLE public.job_runs IS 'Background job run log (cron ingest, notifications, manual sync).';

ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;

-- Dashboard (anon key) can read; only service role writes (bypasses RLS).
DROP POLICY IF EXISTS "Enable read access for job runs" ON public.job_runs;
CREATE POLICY "Enable read access for job runs" ON public.job_runs
  FOR SELECT
  TO anon, authenticated
  USING (true);

NOTIFY pgrst, 'reload schema';
