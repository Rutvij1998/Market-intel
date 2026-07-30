-- Migration: 002_thread_feedback.sql
-- Stores per-viewer star rating + comment/feedback on insight threads.
-- Run ALL of this in Supabase → SQL Editor → New query → Run.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.thread_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Thread identity
  mention_id TEXT,
  reddit_id TEXT,
  thread_url TEXT NOT NULL,
  source TEXT,
  title TEXT,
  -- Classification snapshot at feedback time
  company TEXT,
  client TEXT,
  pillar TEXT,
  business_line TEXT,
  sentiment TEXT,
  -- Feedback
  useful BOOLEAN NOT NULL,                 -- true when rating >= 4 (or explicit yes)
  rating SMALLINT CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  comment TEXT,                            -- yes: comment · no/low stars: why not useful
  -- Who / context
  viewer_key TEXT NOT NULL,                -- anonymous browser id (localStorage)
  active_filters JSONB,                    -- client / business line / pillar at submit time
  why_reasons JSONB,                       -- optional "why this thread" chips snapshot
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One response per viewer per thread URL
CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_feedback_viewer_url
  ON public.thread_feedback (viewer_key, thread_url);

CREATE INDEX IF NOT EXISTS idx_thread_feedback_created_at ON public.thread_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_thread_feedback_useful ON public.thread_feedback (useful);
CREATE INDEX IF NOT EXISTS idx_thread_feedback_rating ON public.thread_feedback (rating);
CREATE INDEX IF NOT EXISTS idx_thread_feedback_thread_url ON public.thread_feedback (thread_url);
CREATE INDEX IF NOT EXISTS idx_thread_feedback_mention_id ON public.thread_feedback (mention_id);

COMMENT ON TABLE public.thread_feedback IS 'User star rating + feedback on insight threads (once per viewer per thread).';

ALTER TABLE public.thread_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable insert for anon feedback" ON public.thread_feedback;
CREATE POLICY "Enable insert for anon feedback" ON public.thread_feedback
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Enable read access for feedback" ON public.thread_feedback;
CREATE POLICY "Enable read access for feedback" ON public.thread_feedback
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- If the table already existed without rating, add it safely:
ALTER TABLE public.thread_feedback
  ADD COLUMN IF NOT EXISTS rating SMALLINT;

-- Notify PostgREST to reload schema (avoids "schema cache" errors)
NOTIFY pgrst, 'reload schema';
