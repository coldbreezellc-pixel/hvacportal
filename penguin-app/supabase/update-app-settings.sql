-- Paste into Supabase → SQL Editor → Run. Safe to re-run. Needed only if the Slack token rotates (SLACK_CLIENT_ID / SLACK_CLIENT_SECRET / SLACK_REFRESH_TOKEN are set).
-- ═══════════════════════════════════════════════════════════════════════════
--  Server-only key/value settings (e.g. the rotating Slack user token).
--  Readable and writable by the service role only — never by app users.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
grant all privileges on public.app_settings to service_role;
-- no policies on purpose: with RLS on and no policies, anon/authenticated can do nothing;
-- service_role bypasses RLS.
