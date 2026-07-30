-- Alert subscriptions: email digests when new threads match client / business-line filters.
-- Run in Supabase SQL Editor.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.alert_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL,
  -- Filters: empty array + all_* false means "nothing" — UI should set all_* or lists
  all_clients BOOLEAN NOT NULL DEFAULT false,
  clients TEXT[] NOT NULL DEFAULT '{}',
  all_business_lines BOOLEAN NOT NULL DEFAULT false,
  business_lines TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  unsubscribe_token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  last_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active subscription per email (upsert by email)
CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_subscriptions_email
  ON public.alert_subscriptions (lower(email));

CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_active
  ON public.alert_subscriptions (active)
  WHERE active = true;

COMMENT ON TABLE public.alert_subscriptions IS 'User enrollment for email PDF digests on matching new mentions.';

ALTER TABLE public.alert_subscriptions ENABLE ROW LEVEL SECURITY;

-- Service role (API) bypasses RLS. Optional anon insert not needed — API uses service role.

DROP POLICY IF EXISTS "Service role full access alerts" ON public.alert_subscriptions;
-- No anon policies: only server with service role writes/reads.

NOTIFY pgrst, 'reload schema';
