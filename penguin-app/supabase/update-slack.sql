-- Paste into Supabase → SQL Editor → Run. Safe to re-run.
-- 1) server-only settings table (rotating Slack token)  2) one-work-order-per-Slack-message index

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

-- One work order per Slack message: the intake paths (hourly pull, pull-on-open
-- from several phones, the Events API push) can race between "is it there yet?"
-- and "insert"; this index makes the database the guard (the code treats a
-- 23505 on insert as "already imported").
create unique index if not exists work_orders_slack_msg_uidx
  on public.work_orders (slack_channel, slack_ts)
  where slack_ts is not null;

select 'Slack update applied' as result;
