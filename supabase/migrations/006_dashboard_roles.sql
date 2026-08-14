-- Migration: 006_dashboard_roles.sql
-- Role-based access for Market Vantage (reply module restricted).
-- Run in Supabase → SQL Editor after 005_dashboard_auth.sql.

-- Roles:
--   viewer    — dashboard only (default for all @likewize.com logins)
--   responder — can use AI Reply draft + submit
--   admin     — responder + ops tools (job logs / sync when enabled)

ALTER TABLE public.dashboard_auth
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'viewer';

-- Backfill any nulls (if column existed without default)
UPDATE public.dashboard_auth SET role = 'viewer' WHERE role IS NULL OR role = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dashboard_auth_role_check'
  ) THEN
    ALTER TABLE public.dashboard_auth
      ADD CONSTRAINT dashboard_auth_role_check
      CHECK (role IN ('viewer', 'responder', 'admin'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dashboard_auth_role
  ON public.dashboard_auth (role);

COMMENT ON COLUMN public.dashboard_auth.role IS
  'viewer | responder | admin — only responder/admin may use AI Reply module';

-- Grant reply access to a user (example):
--   UPDATE public.dashboard_auth SET role = 'responder', updated_at = NOW()
--   WHERE email = 'name@likewize.com';
--
-- Promote to admin:
--   UPDATE public.dashboard_auth SET role = 'admin', updated_at = NOW()
--   WHERE email = 'boss@likewize.com';

NOTIFY pgrst, 'reload schema';
