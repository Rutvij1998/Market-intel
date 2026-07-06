import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const v = value.toLowerCase();
  return (
    v.includes('your_project') ||
    v.includes('your-project') ||
    v.includes('full_anon') ||
    v.includes('full_service') ||
    v.includes('...') ||
    v.length < 20
  );
}

const usingPlaceholders = isPlaceholder(supabaseUrl) || isPlaceholder(supabaseAnonKey);

if (usingPlaceholders) {
  console.warn(
    '[Supabase] Using placeholder or missing values in NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
    'Dashboard will load empty. Edit market-intel/.env.local with your real Supabase project URL + anon key (from Supabase Dashboard → Project Settings → API), then restart the dev server.'
  );
}

export const supabase = (supabaseUrl && supabaseAnonKey && !usingPlaceholders)
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Server-side (with service role for writes). Falls back to anon only if placeholders are present (still won't work for writes).
export const supabaseAdmin = (supabaseUrl && serviceRoleKey && !isPlaceholder(serviceRoleKey))
  ? createClient(supabaseUrl, serviceRoleKey)
  : supabase;

/*
Supabase SQL schema (run in Supabase SQL editor or via migration):

See supabase/migrations/001_create_mentions_table.sql for the full migration script.

IMPORTANT: You MUST run the SQL below (or the migration file) in the Supabase SQL Editor 
BEFORE the first ingestion. The code does NOT auto-create tables.

Quick copy of main table (copy-paste this into Supabase SQL Editor and click Run):

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS mentions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source TEXT NOT NULL,                    -- e.g. 'reddit'
  retailer TEXT,                           -- e.g. 'Newegg', 'Rogers', 'Best Buy' (seller / retailer_context)
  company TEXT,                            -- 'Likewize' | 'Asurion' | 'SquareTrade' (protection provider)
  competitor TEXT,                         -- same as company for tab queries
  product_type TEXT,                       -- 'electronic_device_protection' or 'other'
  retailer_context TEXT,                   -- retailer where plan purchased
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

-- Recommended indexes
CREATE INDEX IF NOT EXISTS idx_mentions_created_at ON mentions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mentions_retailer ON mentions (retailer);
CREATE INDEX IF NOT EXISTS idx_mentions_subreddit ON mentions (subreddit);
CREATE INDEX IF NOT EXISTS idx_mentions_source ON mentions (source);
CREATE INDEX IF NOT EXISTS idx_mentions_sentiment ON mentions (sentiment);
CREATE INDEX IF NOT EXISTS idx_mentions_pillar ON mentions (pillar);

-- Optional supporting table for aggregated stats
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

-- Optional view
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
*/

export interface Mention {
  id: string; // UUID as string
  source: string; // e.g. 'reddit'
  retailer?: string; // e.g. 'Newegg', 'Rogers', 'Best Buy'
  subreddit?: string;
  title?: string;
  content: string;
  url?: string;
  author?: string;
  created_at: string; // ISO timestamp
  sentiment?: 'positive' | 'neutral' | 'negative';
  pillar?: string;
  confidence?: number;
  raw_data?: Record<string, any>; // original Reddit data
  created_at_db?: string;
}

// Optional supporting type for future aggregated stats
export interface RetailerDailyStat {
  id: string;
  date: string;
  retailer: string;
  total_mentions: number;
  positive_count: number;
  neutral_count: number;
  negative_count: number;
  avg_confidence?: number;
}
