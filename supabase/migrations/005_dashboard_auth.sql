-- Migration: 005_dashboard_auth.sql
-- Tracks which @likewize.com emails signed into Market Vantage and current auth state.
-- Run in Supabase → SQL Editor → New query → Run.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.dashboard_auth (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL,
  authenticated BOOLEAN NOT NULL DEFAULT false,
  last_login_at TIMESTAMPTZ,
  last_logout_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dashboard_auth_email_unique UNIQUE (email),
  CONSTRAINT dashboard_auth_email_format CHECK (email = lower(email) AND email LIKE '%@likewize.com')
);

CREATE INDEX IF NOT EXISTS idx_dashboard_auth_authenticated
  ON public.dashboard_auth (authenticated);

CREATE INDEX IF NOT EXISTS idx_dashboard_auth_last_login
  ON public.dashboard_auth (last_login_at DESC NULLS LAST);

COMMENT ON TABLE public.dashboard_auth IS
  'Dashboard OTP users: email + whether currently authenticated (session issued).';

ALTER TABLE public.dashboard_auth ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policies — only service role (bypasses RLS) reads/writes emails.

NOTIFY pgrst, 'reload schema';
