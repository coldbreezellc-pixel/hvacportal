-- ═══════════════════════════════════════════════════════════════════════════
--  Penguin Maintenance @ Versant Media — initial schema
--  Tables: users, inventory_items, activity_logs
--  Run with `supabase db push` (CLI) or paste into the SQL editor.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Roles ──────────────────────────────────────────────────────────────────
do $$ begin
  create type public.user_role as enum ('admin', 'crew');
exception when duplicate_object then null; end $$;

-- ── users (profile row per auth.users row) ─────────────────────────────────
create table if not exists public.users (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text not null unique,
  display_name  text not null,
  email         text not null,
  role          public.user_role not null default 'crew',
  must_reset_pw boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists users_username_lower_idx on public.users (lower(username));

-- ── inventory_items ────────────────────────────────────────────────────────
create table if not exists public.inventory_items (
  id            text primary key default gen_random_uuid()::text,
  "group"       text not null,
  name          text not null,
  part_number   text not null default '',
  qty           integer not null default 0 check (qty >= 0),
  min_qty       integer not null default 0 check (min_qty >= 0),
  notes         text not null default '',
  location      text not null default '',
  category      text not null default '',
  photo         text,
  photo_failed  boolean not null default false,
  -- air-filter spreadsheet columns
  unit_id       text,
  qty_units     integer,
  qty_per_unit  text,
  total_needed  integer,
  created_by    text,
  updated_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists inventory_items_group_idx on public.inventory_items ("group");

-- ── activity_logs ──────────────────────────────────────────────────────────
create table if not exists public.activity_logs (
  id        text primary key default gen_random_uuid()::text,
  action    text not null,
  detail    text not null,
  user_name text not null,
  user_id   uuid references auth.users (id) on delete set null,
  ts        timestamptz not null default now()
);
create index if not exists activity_logs_ts_idx on public.activity_logs (ts desc);

-- ── updated_at trigger ─────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at before update on public.users
  for each row execute function public.set_updated_at();

drop trigger if exists inventory_items_set_updated_at on public.inventory_items;
create trigger inventory_items_set_updated_at before update on public.inventory_items
  for each row execute function public.set_updated_at();

-- ── Helper: is the current caller an admin? (security definer avoids RLS recursion)
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role = 'admin'
  );
$$;

-- ── Username → email lookup so people can sign in with their username ─────
-- Callable before sign-in (anon). Returns null when unknown.
create or replace function public.email_for_username(p_username text)
returns text
language sql stable security definer set search_path = public as $$
  select email from public.users where lower(username) = lower(trim(p_username)) limit 1;
$$;

-- ── Atomic quantity adjustment (delta based, so offline edits merge) ──────
create or replace function public.adjust_qty(p_id text, p_delta integer, p_by text default null)
returns integer
language plpgsql security invoker as $$
declare new_qty integer;
begin
  update public.inventory_items
     set qty = greatest(0, qty + p_delta),
         updated_by = coalesce(p_by, updated_by)
   where id = p_id
   returning qty into new_qty;
  return new_qty;
end $$;

-- ── Called by a user after they change their own password ─────────────────
create or replace function public.clear_must_reset_pw()
returns void
language sql security definer set search_path = public as $$
  update public.users set must_reset_pw = false where id = auth.uid();
$$;

-- ── Create the profile row automatically when an auth user is created ─────
-- The admin API passes username/display_name/role/must_reset_pw in user_metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  uname text := coalesce(nullif(meta->>'username', ''), split_part(new.email, '@', 1));
begin
  insert into public.users (id, username, display_name, email, role, must_reset_pw)
  values (
    new.id,
    uname,
    coalesce(nullif(meta->>'display_name', ''), uname),
    new.email,
    coalesce((meta->>'role')::public.user_role, 'crew'),
    coalesce((meta->>'must_reset_pw')::boolean, true)
  )
  on conflict (id) do update
    set username = excluded.username,
        display_name = excluded.display_name,
        email = excluded.email,
        role = excluded.role,
        must_reset_pw = excluded.must_reset_pw;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profile email in sync if the auth email changes
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update public.users set email = new.email where id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- ── Row Level Security ────────────────────────────────────────────────────
alter table public.users            enable row level security;
alter table public.inventory_items  enable row level security;
alter table public.activity_logs    enable row level security;

-- users: everyone signed in can read the roster; only admins can manage it
drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select to authenticated using (true);

drop policy if exists users_admin_insert on public.users;
create policy users_admin_insert on public.users
  for insert to authenticated with check (public.is_admin());

drop policy if exists users_admin_update on public.users;
create policy users_admin_update on public.users
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists users_admin_delete on public.users;
create policy users_admin_delete on public.users
  for delete to authenticated using (public.is_admin());

-- inventory_items: all signed-in users (admin + crew) can read and write
drop policy if exists inventory_select on public.inventory_items;
create policy inventory_select on public.inventory_items
  for select to authenticated using (true);

drop policy if exists inventory_insert on public.inventory_items;
create policy inventory_insert on public.inventory_items
  for insert to authenticated with check (true);

drop policy if exists inventory_update on public.inventory_items;
create policy inventory_update on public.inventory_items
  for update to authenticated using (true) with check (true);

drop policy if exists inventory_delete on public.inventory_items;
create policy inventory_delete on public.inventory_items
  for delete to authenticated using (true);

-- activity_logs: anyone signed in can append (as themselves); only admins can read/purge
drop policy if exists logs_insert on public.activity_logs;
create policy logs_insert on public.activity_logs
  for insert to authenticated with check (user_id is null or user_id = auth.uid());

drop policy if exists logs_admin_select on public.activity_logs;
create policy logs_admin_select on public.activity_logs
  for select to authenticated using (public.is_admin());

drop policy if exists logs_admin_delete on public.activity_logs;
create policy logs_admin_delete on public.activity_logs
  for delete to authenticated using (public.is_admin());

-- ── Grants ────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.users, public.inventory_items, public.activity_logs to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.email_for_username(text) to anon, authenticated;
grant execute on function public.adjust_qty(text, integer, text) to authenticated;
grant execute on function public.clear_must_reset_pw() to authenticated;
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_user_email_change() from public;

-- ── Realtime: broadcast row changes so every phone updates instantly ──────
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
alter publication supabase_realtime add table public.inventory_items;
alter publication supabase_realtime add table public.users;
alter publication supabase_realtime add table public.activity_logs;

-- Old-row data in UPDATE/DELETE events
alter table public.inventory_items replica identity full;
alter table public.users replica identity full;
