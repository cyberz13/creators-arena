-- ============================================================================
-- 0001_deny_by_default.sql — Supabase / PostgreSQL hardening (REVIEW BEFORE RUNNING)
-- ============================================================================
-- Context: the application talks to PostgreSQL only from the server with a
-- connection string. Supabase additionally exposes every table in `public`
-- through PostgREST (Data API) to the `anon` and `authenticated` roles, whose
-- keys are semi-public. Without this migration, anyone holding the anon key
-- could read `users.password_hash`, sessions, clicks, etc.
--
-- What this does (all reversible, no data touched, no DROP of anything):
--   1. revokes every privilege on application tables, sequences and functions
--      from `anon` and `authenticated`, and stops future objects from being
--      granted to them automatically;
--   2. enables Row Level Security on every application table WITHOUT creating
--      public policies (defence in depth: even a stray grant yields no rows);
--   3. creates a limited runtime role `app_runtime` for the application, with
--      exactly the DML it needs and role-scoped RLS policies, so the app no
--      longer runs as the table owner / superuser.
--
-- How to run: Supabase Dashboard → SQL editor (as the project owner), or
--   psql "$MIGRATION_DATABASE_URL" -f migrations/0001_deny_by_default.sql
-- Afterwards (manually, in the SQL editor only — never in a file):
--   ALTER ROLE app_runtime PASSWORD '<generate a long random password>';
-- then point Vercel's DATABASE_URL at the pooler with user
--   app_runtime.<project-ref>
-- and verify with:  node scripts/db-security-check.mjs   (read-only)
-- ============================================================================

BEGIN;

-- 1) Deny-by-default for the Data API roles -----------------------------------
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
REVOKE USAGE ON SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- 2) Row Level Security on every application table (no public policies) ------
ALTER TABLE public.users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prizes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_links       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clicks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ip_intel             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_daily_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_actions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenges           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_tokens          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_outbox          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfa_recovery_codes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tx_ledger            ENABLE ROW LEVEL SECURITY;

-- 3) Limited runtime role for the application ---------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime LOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.users, public.categories, public.creator_profiles, public.campaigns, public.prizes,
  public.campaign_participants, public.tracking_links, public.clicks, public.ip_intel,
  public.campaign_daily_stats, public.payouts, public.notifications, public.admin_actions,
  public.settings, public.challenges, public.sessions, public.rate_limits, public.auth_tokens,
  public.mail_outbox, public.mfa_recovery_codes, public.tx_ledger
TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
-- Advisory locks are built-in functions; no extra grant is needed.

-- Role-scoped RLS policies: the backend role sees every row, nobody else does.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','categories','creator_profiles','campaigns','prizes','campaign_participants',
    'tracking_links','clicks','ip_intel','campaign_daily_stats','payouts','notifications',
    'admin_actions','settings','challenges','sessions','rate_limits','auth_tokens',
    'mail_outbox','mfa_recovery_codes','tx_ledger'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS app_runtime_all ON public.%I', t);
    EXECUTE format('CREATE POLICY app_runtime_all ON public.%I FOR ALL TO app_runtime USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

COMMIT;

-- Rollback (if ever needed): the owner role keeps all privileges; disable RLS
-- with ALTER TABLE ... DISABLE ROW LEVEL SECURITY per table and re-grant the
-- Data API roles explicitly. Nothing above deletes data.
