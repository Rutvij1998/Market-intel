-- Migration: 001_create_mentions_table.sql
-- Run this in Supabase SQL Editor to create the necessary tables for Market Intel dashboard.

-- Enable UUID extension if not already (usually enabled by default in Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Main table for storing individual Reddit posts/comments (and future sources)
CREATE TABLE IF NOT EXISTS mentions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source TEXT NOT NULL,                    -- e.g. 'reddit'
  retailer TEXT,                           -- e.g. 'Newegg', 'Rogers', 'Best Buy' (the seller / retailer_context)
  company TEXT,                            -- 'Likewize' | 'Asurion' | 'SquareTrade' (the protection provider / competitor)
  competitor TEXT,                         -- alias for company for competitor tab queries
  product_type TEXT,                       -- 'electronic_device_protection' (strict filter) or 'other'
  retailer_context TEXT,                   -- the retailer where plan was purchased (e.g. Newegg for Asurion plan)
  subreddit TEXT,                          -- e.g. 'Newegg', 'laptops'
  title TEXT,
  content TEXT NOT NULL,                   -- the text or full thread content
  url TEXT,
  author TEXT,
  reddit_id TEXT NOT NULL UNIQUE,          -- unique Reddit post id for dedup (e.g. 'reddit-abc123')
  created_at TIMESTAMPTZ NOT NULL,
  sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  pillar TEXT,                             -- e.g. 'Claims', 'Repair', 'Replacement', 'Customer Service', 'Other'
  confidence NUMERIC,
  raw_data JSONB,                          -- original Reddit post data + metadata
  created_at_db TIMESTAMPTZ DEFAULT NOW()  -- when inserted into DB
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_mentions_created_at ON mentions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mentions_retailer ON mentions (retailer);
CREATE INDEX IF NOT EXISTS idx_mentions_subreddit ON mentions (subreddit);
CREATE INDEX IF NOT EXISTS idx_mentions_source ON mentions (source);
CREATE INDEX IF NOT EXISTS idx_mentions_sentiment ON mentions (sentiment);
CREATE INDEX IF NOT EXISTS idx_mentions_pillar ON mentions (pillar);

-- Optional: unique constraint to avoid duplicates on reddit posts (using reddit id inside raw_data or url)
-- For reddit, we can rely on upsert logic in code using raw_data->>'id' or url

-- Supporting table example for future aggregated stats (optional for now)
CREATE TABLE IF NOT EXISTS retailer_daily_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date DATE NOT NULL,
  retailer TEXT NOT NULL,
  total_mentions INTEGER DEFAULT 0,
  positive_count INTEGER DEFAULT 0,
  neutral_count INTEGER DEFAULT 0,
  negative_count INTEGER DEFAULT 0,
  avg_confidence NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_retailer_daily_stats_unique ON retailer_daily_stats (date, retailer);
CREATE INDEX IF NOT EXISTS idx_retailer_daily_stats_date ON retailer_daily_stats (date DESC);
CREATE INDEX IF NOT EXISTS idx_retailer_daily_stats_retailer ON retailer_daily_stats (retailer);

-- Optional view for quick retailer breakdown (can be used by dashboard if needed)
CREATE OR REPLACE VIEW retailer_breakdown AS
SELECT 
  retailer,
  COUNT(*) AS total_mentions,
  COUNT(*) FILTER (WHERE sentiment = 'positive') AS positive_count,
  COUNT(*) FILTER (WHERE sentiment = 'neutral') AS neutral_count,
  COUNT(*) FILTER (WHERE sentiment = 'negative') AS negative_count,
  ROUND(100.0 * COUNT(*) FILTER (WHERE sentiment = 'positive') / NULLIF(COUNT(*), 0), 1) AS positive_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE sentiment = 'neutral') / NULLIF(COUNT(*), 0), 1) AS neutral_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE sentiment = 'negative') / NULLIF(COUNT(*), 0), 1) AS negative_pct
FROM mentions
WHERE retailer IS NOT NULL
GROUP BY retailer
ORDER BY total_mentions DESC;

COMMENT ON TABLE mentions IS 'Stores individual mentions/posts from various sources (primarily Reddit) with sentiment and categorization.';
COMMENT ON COLUMN mentions.raw_data IS 'Full original data from the source (e.g. Reddit post JSON including comments).';
COMMENT ON VIEW retailer_breakdown IS 'Pre-aggregated view for dashboard retailer/client breakdown.';

-- Enable RLS and allow public read access (important for dashboard to load data with anon key)
ALTER TABLE mentions ENABLE ROW LEVEL SECURITY;

-- Policy to allow anyone (anon and authenticated) to SELECT
CREATE POLICY "Enable read access for all users" ON mentions
FOR SELECT
USING (true);

-- Note: For writes, the service_role key (used in API routes) bypasses RLS automatically.
-- If you want to restrict further, adjust policies accordingly (e.g. only service role for insert/update).

-- Run this ALTER if you have an existing table (for competitor analysis fields):
-- ALTER TABLE mentions ADD COLUMN IF NOT EXISTS company TEXT;
-- ALTER TABLE mentions ADD COLUMN IF NOT EXISTS competitor TEXT;
-- ALTER TABLE mentions ADD COLUMN IF NOT EXISTS product_type TEXT;
-- ALTER TABLE mentions ADD COLUMN IF NOT EXISTS retailer_context TEXT;
