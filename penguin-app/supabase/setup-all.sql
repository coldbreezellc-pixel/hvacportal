-- ═══════════════════════════════════════════════════════════════════════════
--  Penguin Maintenance — ONE-SHOT SETUP
--  Paste this whole file into Supabase → SQL Editor → Run.
--  It is the three files below concatenated, in order. Safe to re-run.
--    1. migrations/20260910000000_init.sql
--    2. migrations/20260910000001_photos_backups.sql
--    3. seed.sql
-- ═══════════════════════════════════════════════════════════════════════════

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


-- ═══════════════════════════════════════════════════════════════════════════
--  Photos (Supabase Storage) + hourly backups (pg_cron) + restore
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Full-size photo URL alongside the thumbnail ─────────────────────────────
alter table public.inventory_items add column if not exists photo_full text;

-- ── Storage bucket for part photos ──────────────────────────────────────────
-- Public-read so <img> tags work without signed URLs; only signed-in users can
-- upload/replace/delete. Paths look like items/<item id>/<thumb|full>-<ts>.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-photos', 'item-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "item photos are public" on storage.objects;
create policy "item photos are public" on storage.objects
  for select using (bucket_id = 'item-photos');

drop policy if exists "crew can upload item photos" on storage.objects;
create policy "crew can upload item photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'item-photos');

drop policy if exists "crew can replace item photos" on storage.objects;
create policy "crew can replace item photos" on storage.objects
  for update to authenticated using (bucket_id = 'item-photos') with check (bucket_id = 'item-photos');

drop policy if exists "crew can delete item photos" on storage.objects;
create policy "crew can delete item photos" on storage.objects
  for delete to authenticated using (bucket_id = 'item-photos');

-- ── Backups: full JSON snapshots kept inside Postgres ──────────────────────
create table if not exists public.backups (
  id          bigserial primary key,
  taken_at    timestamptz not null default now(),
  kind        text not null default 'hourly',          -- hourly | manual | pre-restore
  note        text,
  item_count  integer not null default 0,
  user_count  integer not null default 0,
  log_count   integer not null default 0,
  items       jsonb not null,
  users       jsonb not null,
  logs        jsonb not null
);
create index if not exists backups_taken_at_idx on public.backups (taken_at desc);

alter table public.backups enable row level security;

-- Admins may list/read snapshots (the JSON columns are only fetched on download)
drop policy if exists backups_admin_select on public.backups;
create policy backups_admin_select on public.backups
  for select to authenticated using (public.is_admin());

grant select on public.backups to authenticated;
grant usage, select on sequence public.backups_id_seq to authenticated;

-- Take a snapshot. Runs as definer so pg_cron (no session user) can call it.
create or replace function public.take_backup(p_kind text default 'hourly', p_note text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_items jsonb; v_users jsonb; v_logs jsonb; v_id bigint;
begin
  -- from the app, only admins may trigger a manual backup
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(i) order by i."group", i.name), '[]'::jsonb) into v_items from public.inventory_items i;
  select coalesce(jsonb_agg(to_jsonb(u) order by u.username), '[]'::jsonb) into v_users from public.users u;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.ts desc), '[]'::jsonb) into v_logs
    from (select * from public.activity_logs order by ts desc limit 5000) l;
  insert into public.backups (kind, note, item_count, user_count, log_count, items, users, logs)
  values (p_kind, p_note, jsonb_array_length(v_items), jsonb_array_length(v_users), jsonb_array_length(v_logs), v_items, v_users, v_logs)
  returning id into v_id;
  return v_id;
end $$;

-- Restore inventory (and the activity log) from a snapshot. Takes a safety
-- snapshot first so a restore can itself be undone. User profiles are NOT
-- overwritten (logins live in auth.users); they're kept in the snapshot for reference.
create or replace function public.restore_backup(p_id bigint)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_snapshot public.backups%rowtype;
  v_safety bigint;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select * into v_snapshot from public.backups where id = p_id;
  if not found then raise exception 'backup % not found', p_id; end if;

  v_safety := public.take_backup('pre-restore', 'Automatic snapshot before restoring #' || p_id);

  -- Inventory: make the table match the snapshot exactly
  delete from public.inventory_items
   where id not in (select x->>'id' from jsonb_array_elements(v_snapshot.items) x);
  insert into public.inventory_items
    select * from jsonb_populate_recordset(null::public.inventory_items, v_snapshot.items)
  on conflict (id) do update set
    "group" = excluded."group", name = excluded.name, part_number = excluded.part_number,
    qty = excluded.qty, min_qty = excluded.min_qty, notes = excluded.notes, location = excluded.location,
    category = excluded.category, photo = excluded.photo, photo_full = excluded.photo_full,
    photo_failed = excluded.photo_failed, unit_id = excluded.unit_id, qty_units = excluded.qty_units,
    qty_per_unit = excluded.qty_per_unit, total_needed = excluded.total_needed,
    created_by = excluded.created_by, updated_by = excluded.updated_by,
    created_at = excluded.created_at, updated_at = excluded.updated_at;

  -- Logs: only fill in entries that are missing (never delete history)
  insert into public.activity_logs
    select * from jsonb_populate_recordset(null::public.activity_logs, v_snapshot.logs)
  on conflict (id) do nothing;

  insert into public.activity_logs (action, detail, user_name, user_id)
  values ('Backup Restored', 'Restored inventory from backup #' || p_id || ' (' || to_char(v_snapshot.taken_at, 'YYYY-MM-DD HH24:MI') || ')',
          coalesce((select display_name from public.users where id = auth.uid()), 'System'), auth.uid());
  return v_safety;
end $$;

-- Retention: keep every hourly for 7 days, one per day for 180 days, manual and
-- pre-restore snapshots for a year.
create or replace function public.prune_backups()
returns integer
language plpgsql security definer set search_path = public as $$
declare v_deleted integer;
begin
  with ranked as (
    select id, kind, taken_at,
           row_number() over (partition by kind, date_trunc('day', taken_at) order by taken_at) as day_rank
      from public.backups
  ), doomed as (
    select id from ranked
     where (kind = 'hourly' and taken_at < now() - interval '7 days' and day_rank > 1)
        or (kind = 'hourly' and taken_at < now() - interval '180 days')
        or (kind in ('manual', 'pre-restore') and taken_at < now() - interval '365 days')
  )
  delete from public.backups where id in (select id from doomed);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

grant execute on function public.take_backup(text, text) to authenticated;
grant execute on function public.restore_backup(bigint) to authenticated;
revoke execute on function public.prune_backups() from public;

-- ── Schedule with pg_cron (available on every Supabase project) ────────────
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron not available here (%). Schedule backups another way.', sqlerrm;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('penguin-hourly-backup', 'penguin-prune-backups');
    perform cron.schedule('penguin-hourly-backup', '0 * * * *', $cron$ select public.take_backup('hourly') $cron$);
    perform cron.schedule('penguin-prune-backups', '30 3 * * *', $cron$ select public.prune_backups() $cron$);
  end if;
end $$;


-- Generated by scripts/gen-seed-sql.mjs — do not edit by hand.
-- 398 inventory items from the original SEED_DATA.
-- Safe to re-run: existing ids are left untouched.
insert into public.inventory_items
  (id, "group", name, part_number, qty, min_qty, notes, location, unit_id, qty_units, qty_per_unit, total_needed, created_by)
values
('pl-0', 'Plumbing', 'Sloan WC-1.6', 'A - 41 - A', 1, 0, 'Flushometer repair kit 1.6 GPF', '', null, null, null, null, 'Import'),
('pl-1', 'Plumbing', 'Sloan', 'EBV1023A', 2, 0, 'Flushometer repair kit .5 GPF', '', null, null, null, null, 'Import'),
('pl-2', 'Plumbing', 'Sloan URINAL', 'A - 42 - A', 6, 0, 'Flushometer repair kit 1.0 GPF', '', null, null, null, null, 'Import'),
('pl-3', 'Plumbing', 'Sloan', 'EBV1020A', 3, 0, 'Flushometer repair kit', '', null, null, null, null, 'Import'),
('pl-4', 'Plumbing', 'Oately', '49K218', 0, 0, '"2 Urinal Flange Kit', '', null, null, null, null, 'Import'),
('pl-5', 'Plumbing', 'Sloan', '2XU18', 3, 0, 'electronic module', '', null, null, null, null, 'Import'),
('pl-6', 'Plumbing', 'Sloan VACUUM BREAKER', 'V - 551 - A', 7, 0, '', '', null, null, null, null, 'Import'),
('pl-7', 'Plumbing', 'Sloan', '2XU17', 3, 0, 'electroinc module', '', null, null, null, null, 'Import'),
('pl-8', 'Plumbing', 'Sloan HANDLE KIT', 'B - 50 - A', 5, 0, 'WC handle repair kit', '', null, null, null, null, 'Import'),
('pl-9', 'Plumbing', 'Sloan', 'EBV129A-C', 6, 0, 'electronic module', '', null, null, null, null, 'Import'),
('pl-10', 'Plumbing', 'Sloan Stop repair kit', 'H541AWH', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-11', 'Plumbing', 'Sloan Faucets', 'EAF-100-P', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-12', 'Plumbing', 'Sloan Power Packs', 'EAF-11', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-13', 'Plumbing', 'Sloan Solenoid', 'EAF-2', 2, 0, '', '', null, null, null, null, 'Import'),
('pl-14', 'Plumbing', 'Sloan', 'EBV129aA-U', 5, 0, 'electronic module', '', null, null, null, null, 'Import'),
('pl-15', 'Plumbing', 'Sloan Royal Flushometer Body', '115-1.6', 2, 0, '', '', null, null, null, null, 'Import'),
('pl-16', 'Plumbing', 'Sloan optima plus', '8111-1.28', 3, 0, '', '', null, null, null, null, 'Import'),
('pl-17', 'Plumbing', 'Sloan Mouting Kit', 'EAF-1', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-18', 'Plumbing', 'Sloan button cover', 'EBV130A', 3, 0, '', '', null, null, null, null, 'Import'),
('pl-19', 'Plumbing', 'Sloan 1" Stop Repair Kit', 'H-541-ASD', 6, 0, '', '', null, null, null, null, 'Import'),
('pl-20', 'Plumbing', 'Sloan Solenoid', 'EBV136A', 11, 0, '', '', null, null, null, null, 'Import'),
('pl-21', 'Plumbing', 'Sloan 3/4" Stop Repair Kit', 'H-543-ASD', 3, 0, '', '', null, null, null, null, 'Import'),
('pl-22', 'Plumbing', 'Sloan sweat solder 3/4"', 'H-636-AA', 2, 0, '', '', null, null, null, null, 'Import'),
('pl-23', 'Plumbing', 'Sloan Fauct Trim Plates', 'ETF-607-A', 20, 0, '', '', null, null, null, null, 'Import'),
('pl-24', 'Plumbing', 'Sloan 3/4" caps', 'H-1009A', 2, 0, '', '', null, null, null, null, 'Import'),
('pl-25', 'Plumbing', 'Sloan Vandal Resistant Cap', 'H-1010A', 9, 0, '', '', null, null, null, null, 'Import'),
('pl-26', 'Plumbing', 'Sloan Sweat Solder Kit', 'H634AA1', 7, 0, '', '', null, null, null, null, 'Import'),
('pl-27', 'Plumbing', 'Sloan', '4LW59', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-28', 'Plumbing', 'Sloan 1" Gasket', 'F5', 47, 0, '', '', null, null, null, null, 'Import'),
('pl-29', 'Plumbing', 'Sloan 1 1/4" Gasket', 'F5', 17, 0, '', '', null, null, null, null, 'Import'),
('pl-30', 'Plumbing', 'Sloan 1" Gasket', 'F3', 50, 0, '', '', null, null, null, null, 'Import'),
('pl-31', 'Plumbing', 'Sloan 1 1/4" Gasket', 'F3', 34, 0, '', '', null, null, null, null, 'Import'),
('pl-32', 'Plumbing', 'Sloan 1 1/2" Gasket', 'F3', 48, 0, '', '', null, null, null, null, 'Import'),
('pl-33', 'Plumbing', 'Sloan Round 1" Gasket', 'G44', 14, 0, '', '', null, null, null, null, 'Import'),
('pl-34', 'Plumbing', 'Sloan Round 1" Gasket', 'H553', 92, 0, '', '', null, null, null, null, 'Import'),
('pl-35', 'Plumbing', 'Sloan', '4LW58', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-36', 'Plumbing', 'FAUCET KIT', 'T&S 50-2063-H', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-37', 'Plumbing', 'FAUCET KIT', 'T&S 50-2063-C', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-38', 'Plumbing', 'Sloan Flushmate 503 series 1.6GPF', 'M101526-F3B', 1, 0, '', '', null, null, null, null, 'Import'),
('pl-39', 'Plumbing', 'Elkay hot cartrige', 'A155157-R', 0, 0, 'Fitness center faucets', '', null, null, null, null, 'Import'),
('pl-40', 'Plumbing', 'Elkay cold cartrige', 'A155158-R', 0, 0, 'Fitness center faucets', '', null, null, null, null, 'Import'),
('pl-41', 'Plumbing', 'Zurn Auto FLUSH O METER', 'ZERK - CPM', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-42', 'Plumbing', 'Zurn E-Z Flush Rapair Kit - Green Tip Light', '', 7, 0, '', '', null, null, null, null, 'Import'),
('pl-43', 'Plumbing', 'Zurn E-Z Flush Rapair Kit - Blue Tim Light', '', 12, 0, '', '', null, null, null, null, 'Import'),
('pl-44', 'Plumbing', 'PLUMBERS CLOTH', '9171', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-45', 'Plumbing', 'Elkay Sink Drain Fitting', 'LKVR-18B', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-46', 'Plumbing', 'Kohler Faucet Tempering Valve', '13601-NA', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-47', 'Plumbing', 'Therm. Mixing Valve (GPS)', 'AM101C1070-US-ILF', 8, 0, '', '', null, null, null, null, 'Import'),
('pl-48', 'Plumbing', 'Part Description', 'Part Number', 0, 0, 'Used for', '', null, null, null, null, 'Import'),
('pl-49', 'Plumbing', 'Kingston Elongated Bowl', '4330-0', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-50', 'Plumbing', 'KOHLER Toilet Seats', '4760-D-0', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-51', 'Plumbing', 'KOHLER Toilet Seats', '4653-96', 1, 0, '', '', null, null, null, null, 'Import'),
('pl-52', 'Plumbing', 'Kohler Faucet Mixer Pressure Balance Kit', 'GP76851', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-53', 'Plumbing', 'Kohler Screen Inlet', 'K77478', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-54', 'Plumbing', 'Kohler Faucet Gasket', 'K50507', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-55', 'Plumbing', 'Kohler Solenoids', 'ESCRS-73708', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-56', 'Plumbing', 'Kohler Sensors', 'ECNNC-60104', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-57', 'Plumbing', 'Kohler Faucet No Touch', '13666', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-58', 'Plumbing', 'Kohler Accesory Kit', '9459-CP', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-59', 'Plumbing', 'Kohler Mixer Cap for Valve', 'GP77759', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-60', 'Plumbing', 'Kohler Trim &Lever Handle', 'K-T6910-4A', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-61', 'Plumbing', 'Kohler shower drain', '9132-CP', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-62', 'Plumbing', 'Kohler Trim Cover', '77971-47', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-63', 'Plumbing', 'Kohler Power Pack', '13667', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-64', 'Plumbing', 'Watts Angle Stops', '894001', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-65', 'Plumbing', 'Watts Angle Stop Duel Handle', 'DV389400', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-66', 'Plumbing', 'Watts Angle Stops 3 way', '3894001', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-67', 'Plumbing', 'Dishwasher Tail - Brass', '', 6, 0, '', '', null, null, null, null, 'Import'),
('pl-68', 'Plumbing', 'Moen Shower Pressure Balance', '3175', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-69', 'Plumbing', 'Water Works Cartrige', '29-47297-79011', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-70', 'Plumbing', 'Water Works Cartrige', '29-35156-38046', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-71', 'Plumbing', 'Bemis Toilet Seat', '2P888', 4, 0, '', '', null, null, null, null, 'Import'),
('pl-72', 'Plumbing', 'Hercules Johni-Ring for urinals', '90-260', 4, 0, '', '', null, null, null, null, 'Import'),
('pl-73', 'Plumbing', 'Hercules Johni-Ring for back outlet toilets', '90-270', 4, 0, '', '', null, null, null, null, 'Import'),
('pl-74', 'Plumbing', 'Danco Aerator', '36084B', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-75', 'Plumbing', 'IPS Drain Grids', 'ABA1736', 1, 0, '', '', null, null, null, null, 'Import'),
('pl-76', 'Plumbing', 'Kohler Plastic F and C Plate', '1731610', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-77', 'Plumbing', 'Keeny Branch Tail Piece', '51SRB', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-78', 'Plumbing', 'Keeny P-Traps', '305CP', 2, 0, '', '', null, null, null, null, 'Import'),
('pl-79', 'Plumbing', 'Proflo 3/8" Compression Braided Hose', 'PF146322', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-80', 'Plumbing', 'Washing Machine Hose Black Rubber', '', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-81', 'Plumbing', 'Watts 72" Braided Hose', '298236', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-82', 'Plumbing', 'Brasscraft  72" Washing Machine Hose', 'BL12-72WA', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-83', 'Plumbing', 'Moen Cartridge Hot', '52000', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-84', 'Plumbing', 'Moen Cartridge Cold', '52001', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-85', 'Plumbing', 'Plumbshop Sink Hole Cover', 'P52335', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-86', 'Plumbing', 'Danco - sink repair pull rod  3/16x12', '', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-87', 'Plumbing', 'Kohler Gaskets', '38820', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-88', 'Plumbing', 'Part Description', 'Part Number', 0, 0, 'Used for', '', null, null, null, null, 'Import'),
('pl-89', 'Plumbing', 'Proflo P-Trap', 'PF8622J', 2, 0, '', '', null, null, null, null, 'Import'),
('pl-90', 'Plumbing', 'Proflo P-Trap', 'PF8617J', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-91', 'Plumbing', 'W and R Faucet aerators', '', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-92', 'Plumbing', 'Watts P-Trap', '503173', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-93', 'Plumbing', 'Watts Pressure/Temperature Relief Valve', '140x', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-94', 'Plumbing', 'Watts Pressure/Temperature Relief Valve', '40xl', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-95', 'Plumbing', 'Watts Quick Fit Strainer', '644003', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-96', 'Plumbing', 'Conbraco Gasket 1" round', '', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-97', 'Plumbing', 'WHAM', 'Gallons', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-98', 'Plumbing', 'moen faucet', '8225', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-99', 'Plumbing', 'Apollo series 10', '', 1, 0, 'safety relief valve', '', null, null, null, null, 'Import'),
('pl-100', 'Plumbing', 'Brasscraft', 'B1-72DW6D', 3, 0, '', '', null, null, null, null, 'Import'),
('pl-101', 'Plumbing', 'Fluid Master', 'PRO6F16', 9, 0, '', '', null, null, null, null, 'Import'),
('pl-102', 'Plumbing', 'Sloan Flush Handles', '', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-103', 'Plumbing', 'Fluid Master Braided Hose', 'B1F16', 19, 0, '', '', null, null, null, null, 'Import'),
('pl-104', 'Plumbing', 'Fluid Master Braided Hose', 'BGW72', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-105', 'Plumbing', 'Fluid Master Braided Hose', 'B1F12', 4, 0, '', '', null, null, null, null, 'Import'),
('pl-106', 'Plumbing', 'Fluid Master Braided Hose', 'B8F12', 1, 0, '', '', null, null, null, null, 'Import'),
('pl-107', 'Plumbing', 'Fluid Master Braided Hose', 'B6F12', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-108', 'Plumbing', 'Urinal Spud', '', 4, 0, '', '', null, null, null, null, 'Import'),
('pl-109', 'Plumbing', 'Toilet Spud', '', 6, 0, '', '', null, null, null, null, 'Import'),
('pl-110', 'Plumbing', 'BALL VALVES', '1/4" sweat', 5, 0, '', '', null, null, null, null, 'Import'),
('pl-111', 'Plumbing', 'BALL VALVES Lead Free', '1/4" sweat', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-112', 'Plumbing', 'LEAD FREE BALL VALVES', '1" sweat', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-113', 'Plumbing', 'Part Description', 'Part Number', 0, 0, 'Used for', '', null, null, null, null, 'Import'),
('pl-114', 'Plumbing', 'Nipples/Fittings', '', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-115', 'Plumbing', 'Black', '1/4" x close', 3, 0, 'quantity', '', null, null, null, null, 'Import'),
('pl-116', 'Plumbing', '2"x6"', '1/4 x sholder', 0, 0, '3', '', null, null, null, null, 'Import'),
('pl-117', 'Plumbing', '2"x5"', '1/4 x1 1/2"', 0, 0, '3', '', null, null, null, null, 'Import'),
('pl-118', 'Plumbing', '2"x4"', '1/4 x 2"', 0, 0, '6', '', null, null, null, null, 'Import'),
('pl-119', 'Plumbing', '2"xshoulder', '1/4 x 3"', 0, 0, '1', '', null, null, null, null, 'Import'),
('pl-120', 'Plumbing', '1-1/2"x4"', '1/4 x 4"', 0, 0, '2', '', null, null, null, null, 'Import'),
('pl-121', 'Plumbing', 'Brass', '1/4"x 5"', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-122', 'Plumbing', '1/2"x6"', '1/2" x close', 3, 0, '5', '', null, null, null, null, 'Import'),
('pl-123', 'Plumbing', '1/2"x5"', '1/2" x sholder', 8, 0, '1', '', null, null, null, null, 'Import'),
('pl-124', 'Plumbing', '1/8"x3"', '1/2" x 1 1/2"', 1, 0, '8', '', null, null, null, null, 'Import'),
('pl-125', 'Plumbing', '1/8"x2-1/2"', '1/2" x 2"', 6, 0, '4', '', null, null, null, null, 'Import'),
('pl-126', 'Plumbing', '1/8"x2"', '1/2" x 3"', 2, 0, '3', '', null, null, null, null, 'Import'),
('pl-127', 'Plumbing', '1/8"x1-1/2"', '1/2" x 4"', 3, 0, '1', '', null, null, null, null, 'Import'),
('pl-128', 'Plumbing', '1/8"xclose', '1 1/2" x6"', 0, 0, '1', '', null, null, null, null, 'Import'),
('pl-129', 'Plumbing', '1"x2-1/2"', '1/2"x7"', 1, 0, '3', '', null, null, null, null, 'Import'),
('pl-130', 'Plumbing', '1"xclose', '3/4" x close', 4, 0, '1', '', null, null, null, null, 'Import'),
('pl-131', 'Plumbing', '3/4" mix Galvanized', '3/4" x sholder', 1, 0, '38', '', null, null, null, null, 'Import'),
('pl-132', 'Plumbing', '2-1/2 mix Galvanized', '3/4" x 1 1/2"', 0, 0, '15', '', null, null, null, null, 'Import'),
('pl-133', 'Plumbing', '1-1/4" mix Galvanized', '3/4" x 2"', 0, 0, '5', '', null, null, null, null, 'Import'),
('pl-134', 'Plumbing', '1-1/2" mix Galvanized', '3/4" x 3"', 2, 0, '2', '', null, null, null, null, 'Import'),
('pl-135', 'Plumbing', '1/2" mix Galvanized', '3/4" x 4"', 0, 0, '10', '', null, null, null, null, 'Import'),
('pl-136', 'Plumbing', '3/8" mix Galvanized', '3/4" x 6"', 6, 0, '25', '', null, null, null, null, 'Import'),
('pl-137', 'Plumbing', '1/4" mix Galvanized', '', 0, 0, '47', '', null, null, null, null, 'Import'),
('pl-138', 'Plumbing', 'COUPLINGS', '1/4"NPT', 5, 0, '', '', null, null, null, null, 'Import'),
('pl-139', 'Plumbing', 'Unions', '1/4"NPT', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-140', 'Plumbing', 'ELS 90°', '1/4"NPT', 10, 0, '', '', null, null, null, null, 'Import'),
('pl-141', 'Plumbing', '1/4" CAPS', '1/4"NPT', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-142', 'Plumbing', 'BUSHINGS', '1/4" X 1/2"', 4, 0, '', '', null, null, null, null, 'Import'),
('pl-143', 'Plumbing', 'PLUGS NPT', '1 1/2"', 5, 0, '', '', null, null, null, null, 'Import'),
('pl-144', 'Plumbing', '904 building', '', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-145', 'Plumbing', 'Part Description', 'Part Number', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-146', 'Plumbing', 'Flushometer WC', 'A-41-A', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-147', 'Plumbing', 'Flushometer URINAL', 'A-42A', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-148', 'Plumbing', 'VACUUM BREAKER', 'V-551-A', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-149', 'Plumbing', 'HANDLE KIT', 'B-50-A', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-150', 'Plumbing', 'Sloan Faucets', 'EAF-150-ISM', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-151', 'Plumbing', 'diverter rebuild kit', 'DV50A', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-152', 'Plumbing', 'Sloan solenoid Rebuild kit', 'ETF1009A', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-153', 'Plumbing', 'Sloan Battery', 'EAF-1000', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-154', 'Plumbing', 'Toilet Seats', '1966ct-000', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-155', 'Plumbing', 'BALL VALVES', '1/4" sweat', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-156', 'Plumbing', 'Part Description', 'Part Number', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-157', 'Plumbing', 'BALL VALVES Lead Free', '1/4"', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-158', 'Plumbing', 'Updated Parts', '', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-159', 'Plumbing', 'PVC Parts', '', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-160', 'Plumbing', 'Caps', '1/2"', 7, 0, '', '', null, null, null, null, 'Import'),
('pl-161', 'Plumbing', 'Tees', '1/2"', 6, 0, '', '', null, null, null, null, 'Import'),
('pl-162', 'Plumbing', '45 degree elbow', '1/2"', 3, 0, '', '', null, null, null, null, 'Import'),
('pl-163', 'Plumbing', '90 degree elbow', '1/2"', 19, 0, '', '', null, null, null, null, 'Import'),
('pl-164', 'Plumbing', 'Unions', '1/2"', 4, 0, '', '', null, null, null, null, 'Import'),
('pl-165', 'Plumbing', 'Coupling', '1/2"', 5, 0, '', '', null, null, null, null, 'Import'),
('pl-166', 'Plumbing', 'Plugs', '1/2"', 6, 0, '', '', null, null, null, null, 'Import'),
('pl-167', 'Plumbing', 'WYE', '1-1/2"', 8, 0, '', '', null, null, null, null, 'Import'),
('pl-168', 'Plumbing', 'Assorted nipples', '', 8, 0, '', '', null, null, null, null, 'Import'),
('pl-169', 'Plumbing', 'Adapters', '3/4" male', 63, 0, '', '', null, null, null, null, 'Import'),
('pl-170', 'Plumbing', 'George Fisher PVC Flange', '2" Flange', 5, 0, '', '', null, null, null, null, 'Import'),
('pl-171', 'Plumbing', 'Ball valves', '3/4"', 13, 0, '', '', null, null, null, null, 'Import'),
('pl-172', 'Plumbing', 'Union Ball valve', '3/4" UNION', 3, 0, '', '', null, null, null, null, 'Import'),
('pl-173', 'Plumbing', 'Cash Acme', '38EG45', 5, 0, 'Pressure/Temp Relief Valve', '', null, null, null, null, 'Import'),
('pl-174', 'Plumbing', 'Sloan', 'F-5-AT', 1, 0, 'spud coup flange kit', '', null, null, null, null, 'Import'),
('pl-175', 'Plumbing', 'Sloan', 'F-5-AW', 7, 0, 'spud coup flange kit', '', null, null, null, null, 'Import'),
('pl-176', 'Plumbing', 'Sloan', 'F-5-AU', 2, 0, 'spud coup flange kit', '', null, null, null, null, 'Import'),
('pl-177', 'Plumbing', 'Dishawasher tailpiece', '444J25', 4, 0, 'Chrome', '', null, null, null, null, 'Import'),
('pl-178', 'Plumbing', 'Gasket', '20RG71', 5, 0, '', '', null, null, null, null, 'Import'),
('pl-179', 'Plumbing', 'Gasket', '444K81', 1, 0, 'Tank to bowl for AM STND', '', null, null, null, null, 'Import'),
('pl-180', 'Plumbing', 'Urinal strainers', '', 11, 0, '', '', null, null, null, null, 'Import'),
('pl-181', 'Plumbing', 'American STND flange kit', '4THK6', 2, 0, '', '', null, null, null, null, 'Import'),
('pl-182', 'Plumbing', 'American Standard', '3KTE1', 11, 0, 'gasket', '', null, null, null, null, 'Import'),
('pl-183', 'Plumbing', 'Watts', '29HZ37', 2, 0, 'thermostatic mixin valve', '', null, null, null, null, 'Import'),
('pl-184', 'Plumbing', 'Braided Hose', 'BFC30', 15, 0, '', '', null, null, null, null, 'Import'),
('pl-185', 'Plumbing', 'Braided Hose', 'PN-48005N', 7, 0, '', '', null, null, null, null, 'Import'),
('pl-186', 'Plumbing', 'Sloan', 'EAF1008', 4, 0, 'flexible hose', '', null, null, null, null, 'Import'),
('pl-187', 'Plumbing', 'Braided Hose', 'LBLKSPC20-88CP', 2, 0, '', '', null, null, null, null, 'Import'),
('pl-188', 'Plumbing', 'Compressor tank', '097-1756-0418', 4, 0, 'drain valve', '', null, null, null, null, 'Import'),
('pl-189', 'Plumbing', 'Flex Hose CAFÉ', '5WMx4', 3, 0, '', '', null, null, null, null, 'Import'),
('pl-190', 'Plumbing', 'Fluid master hose', '12IM72', 2, 0, '', '', null, null, null, null, 'Import'),
('pl-191', 'Plumbing', 'Fluid master hose', 'C6LT02', 1, 0, '', '', null, null, null, null, 'Import'),
('pl-192', 'Plumbing', 'Braided Hose', '1004650242', 3, 0, 'Ice Maker', '', null, null, null, null, 'Import'),
('pl-193', 'Plumbing', 'T&S', '2WMF8', 1, 0, 'pre rinse spring', '', null, null, null, null, 'Import'),
('pl-194', 'Plumbing', 'T&S', '06X', 1, 0, '8" swing nozzle', '', null, null, null, null, 'Import'),
('pl-195', 'Plumbing', 'AB&A', 'ABA8549', 2, 0, 'Urinal spigot adj flange', '', null, null, null, null, 'Import'),
('pl-196', 'Plumbing', '2"PVC horizontal flange kit', '49K218', 3, 0, 'Urinal flange kit pvc', '', null, null, null, null, 'Import'),
('pl-197', 'Plumbing', 'Sloan', 'used', 6, 0, 'Control Stop Assembly', '', null, null, null, null, 'Import'),
('pl-198', 'Plumbing', 'Eye wash station caps', '1FBE8', 15, 0, 'Cover Caps', '', null, null, null, null, 'Import'),
('pl-199', 'Plumbing', 'Pro Press Fittings', '', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-200', 'Plumbing', '90 degree elbow', '1/2"', 5, 0, '', '', null, null, null, null, 'Import'),
('pl-201', 'Plumbing', '45 degree elbow', '3/4"', 10, 0, '', '', null, null, null, null, 'Import'),
('pl-202', 'Plumbing', '90 degree street elbow', '3/4"', 10, 0, '', '', null, null, null, null, 'Import'),
('pl-203', 'Plumbing', '45 degree street elbow', '3/4"', 10, 0, '', '', null, null, null, null, 'Import'),
('pl-204', 'Plumbing', 'Tees', '1/2"', 2, 0, '', '', null, null, null, null, 'Import'),
('pl-205', 'Plumbing', 'Couplings', '1-1/2"x1-1/2"', 26, 0, '', '', null, null, null, null, 'Import'),
('pl-206', 'Plumbing', 'Unions', '1/2"x1/2"', 1, 0, '', '', null, null, null, null, 'Import'),
('pl-207', 'Plumbing', 'Caps', '1/2"', 3, 0, '', '', null, null, null, null, 'Import'),
('pl-208', 'Plumbing', 'Pro Press', '1/2"', 1, 0, 'Ball Valves', '', null, null, null, null, 'Import'),
('pl-209', 'Plumbing', 'Assorted used ball valve handles', 'used', 38, 0, '', '', null, null, null, null, 'Import'),
('pl-210', 'Plumbing', '1-1/2"x1-1/4" FTG', '901-2-7', 9, 0, 'Trap Adapter', '', null, null, null, null, 'Import'),
('pl-211', 'Plumbing', 'Assorted Black Nipples', '', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-212', 'Plumbing', '3/4" mix', '', 21, 0, '', '', null, null, null, null, 'Import'),
('pl-213', 'Plumbing', '1" mix', '', 6, 0, '', '', null, null, null, null, 'Import'),
('pl-214', 'Plumbing', '1/2" mix', '', 11, 0, '', '', null, null, null, null, 'Import'),
('pl-215', 'Plumbing', 'Assorted Brass Nipples 2"', '', 15, 0, '', '', null, null, null, null, 'Import'),
('pl-216', 'Plumbing', 'No Hub Couplings', '', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-217', 'Plumbing', '2"', '', 90, 0, '', '', null, null, null, null, 'Import'),
('pl-218', 'Plumbing', '1-1/2"', '', 3, 0, '', '', null, null, null, null, 'Import'),
('pl-219', 'Plumbing', '3"', '', 12, 0, '', '', null, null, null, null, 'Import'),
('pl-220', 'Plumbing', '4"', '', 22, 0, '', '', null, null, null, null, 'Import'),
('pl-221', 'Plumbing', '3"x4"', '', 3, 0, '', '', null, null, null, null, 'Import'),
('pl-222', 'Plumbing', '2"x2" Fernco', '', 3, 0, '', '', null, null, null, null, 'Import'),
('pl-223', 'Plumbing', '4"x2" Fernco', '', 1, 0, '', '', null, null, null, null, 'Import'),
('pl-224', 'Plumbing', 'Cast Iron No Hub Fittings', '', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-225', 'Plumbing', '2" Test Tee', '', 11, 0, '', '', null, null, null, null, 'Import'),
('pl-226', 'Plumbing', '2" P Trap', '', 13, 0, '', '', null, null, null, null, 'Import'),
('pl-227', 'Plumbing', '2" End Cap', '', 0, 0, '', '', null, null, null, null, 'Import'),
('pl-228', 'Plumbing', '3" End Cap', '', 1, 0, '', '', null, null, null, null, 'Import'),
('pl-229', 'Plumbing', '2" short sweep wye', '', 6, 0, '', '', null, null, null, null, 'Import'),
('pl-230', 'Plumbing', '2" long sweep wye', '', 9, 0, '', '', null, null, null, null, 'Import'),
('pl-231', 'Plumbing', '2"wye', '', 7, 0, '', '', null, null, null, null, 'Import'),
('pl-232', 'Plumbing', '3"x3"x2" short sweep wye', '', 2, 0, '', '', null, null, null, null, 'Import'),
('pl-233', 'Plumbing', '2" 90 long sweep elbow', '', 4, 0, '', '', null, null, null, null, 'Import'),
('pl-234', 'Plumbing', '2" 90 degree elbow', '', 8, 0, '', '', null, null, null, null, 'Import'),
('pl-235', 'Plumbing', '2" 22-1/2 degree elbow', '', 10, 0, '', '', null, null, null, null, 'Import'),
('pl-236', 'Plumbing', '2" 45 degree elbow', '', 12, 0, '', '', null, null, null, null, 'Import'),
('pl-237', 'Plumbing', '2" 90 degree long bend elbow', '', 8, 0, '', '', null, null, null, null, 'Import'),
('fa-0', 'Faucet Parts', 'Dorn Bracht entrie faucet', '33815888', 0, 0, 'Pantry Faucet (new)Elkay', '', null, null, null, null, 'Import'),
('fa-1', 'Faucet Parts', 'Dorn Bracht Cartrige', '9015050300090', 0, 0, 'Pantry Faucet (new)Elkay', '', null, null, null, null, 'Import'),
('fa-2', 'Faucet Parts', 'Sloan Faucet Complete', 'EAF-150-ISM', 0, 0, 'Sloan Bathroom Sink Faucets', '', null, null, null, null, 'Import'),
('fa-3', 'Faucet Parts', 'Motion Sensor for battery model', 'EAF-3-A', 0, 0, 'Sloan Bathroom Sink Faucets', '', null, null, null, null, 'Import'),
('fa-4', 'Faucet Parts', 'Diverter Rebuild Kit', 'DV50A', 0, 0, 'Sloan Bathroom Sink Faucets', '', null, null, null, null, 'Import'),
('fa-5', 'Faucet Parts', 'Sloan solenoid', 'EAF-2', 0, 0, 'Sloan Bathroom Sink Faucets', '', null, null, null, null, 'Import'),
('fa-6', 'Faucet Parts', 'Sloan Battery', 'EAF-1000', 0, 0, 'Sloan Bathroom Sink Faucets', '', null, null, null, null, 'Import'),
('fa-7', 'Faucet Parts', 'Sloan Faucets', 'EAF-100-P', 0, 0, 'Sloan Bathroom Sink Faucets', '', null, null, null, null, 'Import'),
('fa-8', 'Faucet Parts', 'Supply Hoses', 'EAF-1008', 0, 0, 'Sloan Bathroom Sink Faucets', '', null, null, null, null, 'Import'),
('fa-9', 'Faucet Parts', 'Sloan Power Packs', 'EAF-11', 0, 0, 'Sloan Bathroom Sink Faucets', '', null, null, null, null, 'Import'),
('fa-10', 'Faucet Parts', 'Sloan Solenoid', 'EAF-2', 0, 0, 'Sloan Bathroom Sink Faucets', '', null, null, null, null, 'Import'),
('fa-11', 'Faucet Parts', 'Sloan Faucet Trim Plates', 'ETF-607-A', 18, 0, 'Sloan Bathroom Sink Faucets', '', null, null, null, null, 'Import'),
('fa-12', 'Faucet Parts', 'Motion Sensor for power pack model', 'EAF-6-A', 0, 0, 'Sloan Bathroom Sink Faucets', '', null, null, null, null, 'Import'),
('fa-13', 'Faucet Parts', 'Stainer Filter Screen', 'EAF-9', 38, 0, 'Sloan Bathroom Sink Faucets', '', null, null, null, null, 'Import'),
('fa-14', 'Faucet Parts', 'Honeywell Mixing Valve', 'AM101C1070-US-1LF', 0, 0, 'Sloan Bathroom Sink Faucets', '', null, null, null, null, 'Import'),
('fa-15', 'Faucet Parts', 'Diverter Rebuild Kit', 'DV50A', 1, 0, 'Sloan Bathroom Sink Faucets', '', null, null, null, null, 'Import'),
('fa-16', 'Faucet Parts', 'Elkay (with hose connection)', 'LK69CH', 4, 0, 'Janitors Closet Faucets ( Elkay )', '', null, null, null, null, 'Import'),
('fa-17', 'Faucet Parts', 'Elkay (without hose connection )', 'LK69CP', 10, 0, 'Janitors Closet Faucets ( Elkay )', '', null, null, null, null, 'Import'),
('fa-18', 'Faucet Parts', 'Sloan 8" trim plate', 'ETF-608A', 1, 0, 'Janitors Closet Faucets ( Elkay )', '', null, null, null, null, 'Import'),
('fa-19', 'Faucet Parts', 'Kohler', 'K-7443-5A', 0, 0, 'Fitness Center Sink Facuets', '', null, null, null, null, 'Import'),
('fa-20', 'Faucet Parts', 'Wristblade lever handles', 'K-16012-5', 0, 0, 'Fitness Center Sink Facuets', '', null, null, null, null, 'Import'),
('fa-21', 'Faucet Parts', 'Hot Cartridge', '29-35156-38046', 7, 0, 'Fitness Center Sink Facuets', '', null, null, null, null, 'Import'),
('fa-22', 'Faucet Parts', 'Cold Cartridge', '29-47297-79011', 8, 0, 'Fitness Center Sink Facuets', '', null, null, null, null, 'Import'),
('fa-23', 'Faucet Parts', 'Moen Shower Kit', '3175', 1, 0, 'Fitness Center Shower Parts', '', null, null, null, null, 'Import'),
('fa-24', 'Faucet Parts', 'Trim Kohler "Forte"', 'K-T10276', 1, 0, 'Fitness Center Shower Parts', '', null, null, null, null, 'Import'),
('fa-25', 'Faucet Parts', 'Drain JR Smith', '-', 0, 0, 'Fitness Center Shower Parts', '', null, null, null, null, 'Import'),
('fa-26', 'Faucet Parts', 'Shower Pressure balance with Regulator', 'GP76851', 2, 0, 'Fitness Center Shower Parts', '', null, null, null, null, 'Import'),
('fa-27', 'Faucet Parts', 'Shower Shower Cartrige only', 'GP77759', 5, 0, 'Fitness Center Shower Parts', '', null, null, null, null, 'Import'),
('fa-28', 'Faucet Parts', 'Shower Valve Rebuild Kit', 'GP500520', 2, 0, 'Fitness Center Shower Parts', '', null, null, null, null, 'Import'),
('fa-29', 'Faucet Parts', 'Kholer shower faucet trim', 'TS14423-4-BL', 2, 0, 'Fitness Center Shower Parts', '', null, null, null, null, 'Import'),
('fa-30', 'Faucet Parts', 'Elkay Complete Facuet', 'LK2432BH', 0, 0, 'Pantry Faucets Old', '', null, null, null, null, 'Import'),
('fa-31', 'Faucet Parts', 'Elkay hot cartrige', 'A155157-R', 4, 0, 'Pantry Faucets Old', '', null, null, null, null, 'Import'),
('fa-32', 'Faucet Parts', 'Elkay cold cartrige', 'A155158-R', 3, 0, 'Pantry Faucets Old', '', null, null, null, null, 'Import'),
('fa-33', 'Faucet Parts', 'Moen Complete Facuet', '8255', 1, 0, 'Pantry Faucets Old', '', null, null, null, null, 'Import'),
('fa-34', 'Faucet Parts', 'Moen Cartridge Hot (Grainger-4NEF5)', '52000', 11, 0, 'Pantry Faucets Old', '', null, null, null, null, 'Import'),
('fa-35', 'Faucet Parts', 'Moen Cartridge Cold (Grainger-4NEF6)', '52001', 6, 0, 'Pantry Faucets Old', '', null, null, null, null, 'Import'),
('fa-36', 'Faucet Parts', 'Complete Faucet', 'LK500AT08T4', 0, 0, 'Pantry Faucet (new)Elkay', '', null, null, null, null, 'Import'),
('fa-37', 'Faucet Parts', '4" Handles "Pair "', '45919C', 3, 0, 'Pantry Faucet (new)Elkay', '', null, null, null, null, 'Import'),
('fa-38', 'Faucet Parts', 'Left Hot Cartridge', '45924C', 12, 0, 'Pantry Faucet (new)Elkay', '', null, null, null, null, 'Import'),
('fa-39', 'Faucet Parts', 'Right Cold Cartridge', '45923C', 13, 0, 'Pantry Faucet (new)Elkay', '', null, null, null, null, 'Import'),
('fa-40', 'Faucet Parts', 'Spout', 'A55393', 0, 0, 'Pantry Faucet (new)Elkay', '', null, null, null, null, 'Import'),
('fa-41', 'Faucet Parts', 'Body', '45915C', 0, 0, 'Pantry Faucet (new)Elkay', '', null, null, null, null, 'Import'),
('fa-42', 'Faucet Parts', 'Aerator Assembly', 'LK734', 1, 0, 'Pantry Faucet (new)Elkay', '', null, null, null, null, 'Import'),
('fa-43', 'Faucet Parts', 'Aerator Assembly', 'LK733', 6, 0, 'Pantry Faucet (new)Elkay', '', null, null, null, null, 'Import'),
('fa-44', 'Faucet Parts', '"Eemax" Heater', 'SP4277', 0, 0, 'Pantry Accessories', '', null, null, null, null, 'Import'),
('fa-45', 'Faucet Parts', '"Emax"Aeretor', 'EX0061-0.5AER', 10, 0, 'Pantry Accessories', '', null, null, null, null, 'Import'),
('fa-46', 'Faucet Parts', '"Floodstop"', 'FS 3/4 NPT', 6, 0, 'Pantry Accessories', '', null, null, null, null, 'Import'),
('fa-47', 'Faucet Parts', '"Floodstop" Sensor', 'ES-01', 10, 0, 'Pantry Accessories', '', null, null, null, null, 'Import'),
('fa-48', 'Faucet Parts', '(NEW) Sink Drain tamper Proof "Elkay"', 'LKVR18B', 6, 0, 'Pantry Accessories', '', null, null, null, null, 'Import'),
('fa-49', 'Faucet Parts', '(OLD) Watts Kwik-Fit Sink Strainer', '644003', 0, 0, 'Pantry Accessories', '', null, null, null, null, 'Import'),
('fa-50', 'Faucet Parts', 'T&S Triple Wash Sink - Cold Water', '002711-40', 19, 0, 'Kitchen Faucets', '', null, null, null, null, 'Import'),
('fa-51', 'Faucet Parts', 'T&S Triple Wash Sink - Hot Water', '002712-40', 23, 0, 'Kitchen Faucets', '', null, null, null, null, 'Import'),
('fa-52', 'Faucet Parts', 'T&S Triple Wash Sink Sprayer Head', 'B-0107', 4, 0, 'Kitchen Faucets', '', null, null, null, null, 'Import'),
('fa-53', 'Faucet Parts', 'T&S Triple Wash Sink Sprayer Hose', 'B-0044-H', 0, 0, 'Kitchen Faucets', '', null, null, null, null, 'Import'),
('fa-54', 'Faucet Parts', 'T&S Triple Wash Sink Sprayer Bonnet', '002856-40M', 2, 0, 'Kitchen Faucets', '', null, null, null, null, 'Import'),
('fa-55', 'Faucet Parts', 'T&S Wall Bracket Holidng Goose Neck', 'B-0109-01', 6, 0, 'Kitchen Faucets', '', null, null, null, null, 'Import'),
('fa-56', 'Faucet Parts', 'T&S Tripple Wash Sink Retro Kit', 'EZ-K', 3, 0, 'Kitchen Faucets', '', null, null, null, null, 'Import'),
('fa-57', 'Faucet Parts', 'T&S Tripple Wash Sink  Overflow drain', '011356-45', 5, 0, 'Kitchen Faucets', '', null, null, null, null, 'Import'),
('fa-58', 'Faucet Parts', 'T&S Triple Sink Foot Valve', 'B-3942', 5, 0, 'Kitchen Faucets', '', null, null, null, null, 'Import'),
('fa-59', 'Faucet Parts', 'T&S Lavatory Rebuild Kit Hot', '50-2063-H', 1, 0, 'Kitchen Faucets', '', null, null, null, null, 'Import'),
('fa-60', 'Faucet Parts', 'T&S Lavatory Rebuild Kit Cold', '50-2063-C', 0, 0, 'Kitchen Faucets', '', null, null, null, null, 'Import'),
('fa-61', 'Faucet Parts', 'Faucet Cartrige Set "Advance Tabco"', 'K-00', 5, 0, 'Kitchen Samll Hand Sinks', '', null, null, null, null, 'Import'),
('fa-62', 'Faucet Parts', 'T&S Spindle Assembly (LTC)', '009754-25', 3, 0, 'Penthouse Hand Sink', '', null, null, null, null, 'Import'),
('fa-63', 'Faucet Parts', 'T&S Spindle Assembly (RTC)', '009753-25', 3, 0, 'Penthouse Hand Sink', '', null, null, null, null, 'Import'),
('fa-64', 'Faucet Parts', 'Entire Vent', 'EA79A1004', 7, 0, 'Honeywell 3/4 "Air Vents', '', null, null, null, null, 'Import'),
('fa-65', 'Faucet Parts', 'Rebuild Kit', 'P79B1003', 15, 0, 'Honeywell 3/4 "Air Vents', '', null, null, null, null, 'Import'),
('fa-66', 'Faucet Parts', 'Part #', 'In stock', 0, 0, 'Honeywell 3/4 "Air Vents', '', null, null, null, null, 'Import'),
('fa-67', 'Faucet Parts', 'Honeywell 1/8" Air Vents', 'FV180', 16, 0, 'Honeywell 3/4 "Air Vents', '', null, null, null, null, 'Import'),
('fa-68', 'Faucet Parts', '1/2 O.D. Tubing', '', 0, 0, 'Honeywell 3/4 "Air Vents', '', null, null, null, null, 'Import'),
('fa-69', 'Faucet Parts', 'Taco 400 HY-Vent', '1', 0, 0, 'Honeywell 3/4 "Air Vents', '', null, null, null, null, 'Import'),
('fa-70', 'Faucet Parts', 'Bell&Gosset #79 water vent', '4', 0, 0, 'Honeywell 3/4 "Air Vents', '', null, null, null, null, 'Import'),
('fa-71', 'Faucet Parts', 'Chicago Faucet handles', '97-4123', 5, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-72', 'Faucet Parts', 'TOTO Brass nozzle assy', 'TH559EDV567', 2, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-73', 'Faucet Parts', '403 vacuum Breaker Kit', '5001228', 1, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-74', 'Faucet Parts', 'Aerator 2.0 GPM', 'A112.18.1M', 4, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-75', 'Faucet Parts', 'Blue Fin Ptrap 1-1/2"', 'TB120-150-BLCO', 5, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-76', 'Faucet Parts', 'Blue Fin Ptrap 1-1/4"', 'TB122-125-LCO', 5, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-77', 'Faucet Parts', '4" Guardian DrainLock', 'DGDL-4000', 1, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-78', 'Faucet Parts', 'Blue fin 1-1/2" flanged tailpiece', 'TB217-150-12F', 10, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-79', 'Faucet Parts', 'Grainger drain extension', '1PNP6A', 6, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-80', 'Faucet Parts', 'Blue fin 1-1/4x12 tailpiece', 'TB217-125-12T', 1, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-81', 'Faucet Parts', 'Blue fin 1-1/2x6 tailpiece', 'TB217-150-6F', 10, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-82', 'Faucet Parts', 'T&S 14" swing nozzle', '063X', 1, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-83', 'Faucet Parts', 'Plastic drain extension', '1PN25A', 2, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-84', 'Faucet Parts', 'Grainger shower strainers', '20RG72', 3, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-85', 'Faucet Parts', 'Escutcheons', '1PPE4B', 4, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-86', 'Faucet Parts', 'Kissler grid strainer pop-up', '08-1005', 5, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-87', 'Faucet Parts', 'Escutcheons 1" plastic', '38VP21', 12, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-88', 'Faucet Parts', 'Watts Angle supply stop 1/2"', 'LF890003', 3, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-89', 'Faucet Parts', 'Watts Angle supply stop 5/8"', 'LF894151', 1, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-90', 'Faucet Parts', 'Brass craft 1/4 turn angle stop', 'G2CR19XC', 12, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-91', 'Faucet Parts', 'Brass craft 1/4 turn angle ball stop', 'KTR17XC', 10, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-92', 'Faucet Parts', 'T&S Double pantry Faucet', 'B-0300', 1, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-93', 'Faucet Parts', 'T&S Double pantry Faucet', 'B-0231', 1, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-94', 'Faucet Parts', 'T&S Sill Faucet self closing', 'B-0706', 1, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-95', 'Faucet Parts', 'Used Restroom Escutcheons', 'used', 9, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-96', 'Faucet Parts', 'Used Assorted Escutcheons', 'used', 21, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('fa-97', 'Faucet Parts', 'Quadtro wash machine outlet box', '38529', 1, 0, 'Common Parts 900 and 904', '', null, null, null, null, 'Import'),
('f900-0', 'Air Filters 900', 'Merv 13 24x24x4', '', 227, 0, '', '', 'AHU #1–#4', 4, '15', 60, 'Import'),
('f900-1', 'Air Filters 900', 'Merv 13 12x24x4', '', 20, 0, '', '', 'AHU #1–#4', 4, '5', 20, 'Import'),
('f900-2', 'Air Filters 900', 'Merv 13 12x24x4 Gasket', '', 0, 0, '', '', 'AHU #1–#4', 4, '0', 0, 'Import'),
('f900-3', 'Air Filters 900', 'Merv 11 24x24x4', '', 0, 0, '', '', 'AHU #5 (×8), #6 (×8), #7 (×12), G1 Mammoth (×6)', 4, '8/8/12/6', 34, 'Import'),
('f900-4', 'Air Filters 900', 'Merv 11 12x24x4', '', 59, 0, '', '', 'AHU #7', 1, '4', 4, 'Import'),
('f900-5', 'Air Filters 900', 'Plt 16x20x2', '', 12, 0, '', '', 'FCU B-1 (×1), B-2 (×2), G-5 (×1)', 3, '1/2/1', 4, 'Import'),
('f900-6', 'Air Filters 900', 'Plt 16x25x2', '', 13, 0, '', '', 'FCU B-1', 1, '1', 1, 'Import'),
('f900-7', 'Air Filters 900', 'RP 14x54x1', '', 18, 0, '', '', 'FCU G-1', 1, '1', 1, 'Import'),
('f900-8', 'Air Filters 900', 'RP 12x36x1', '', 7, 0, '', '', 'FCU G-2, G-3, G-4, 1-1, 1-2, 1-3, 2-4, 2-5', 8, '1', 8, 'Import'),
('f900-9', 'Air Filters 900', 'RP 20½x44', '', 11, 0, '', '', 'FCU 1-1A', 1, '1', 1, 'Import'),
('f900-10', 'Air Filters 900', 'Plt 29x29x2', '', 12, 0, '', '', 'FCU 2-1, 2-2', 2, '2', 4, 'Import'),
('f900-11', 'Air Filters 900', 'Plt 20x20x1', '', 0, 0, '', '', 'FCU Penthouse, AC-B1 Trane', 2, '1', 2, 'Import'),
('f900-12', 'Air Filters 900', 'RP 24x48', '', 26, 0, '', '', 'HV #1, #3 (×2 ea), #2, #2A (×1 ea)', 4, '2/2/1/1', 6, 'Import'),
('f900-13', 'Air Filters 900', 'RP 12x48', '', 18, 0, '', '', 'HV #1, #3, #2, #2A Ring Panel', 4, '1', 4, 'Import'),
('f900-14', 'Air Filters 900', 'Plastic 24x24x4', '', 24, 0, '', '', 'HV #1, #3 (×4 ea), #2, #2A (×2 ea)', 4, '4/4/2/2', 12, 'Import'),
('f900-15', 'Air Filters 900', 'Plastic 12x24x4', '', 15, 0, '', '', 'HV #1, #3 (×2 ea), #2, #2A (×2 ea)', 4, '2', 8, 'Import'),
('f900-16', 'Air Filters 900', 'Merv 13 24x24x4 Diecut', '', 249, 0, '', '', 'Diecut Frame Stock', 0, '0', 0, 'Import'),
('f900-17', 'Air Filters 900', 'Merv 13 12x24x4 Diecut', '', 89, 0, '', '', 'Diecut Frame Stock', 0, '0', 0, 'Import'),
('f900-18', 'Air Filters 900', 'Merv 11 24x24x4 Diecut', '', 0, 0, '', '', 'Diecut Frame Stock', 0, '0', 0, 'Import'),
('f900-19', 'Air Filters 900', '20x20x1 (Carbon)', '', 23, 0, '', '', 'Make-Up Carbon', 3, '2', 6, 'Import'),
('f900-20', 'Air Filters 900', '20x20x2 (Carbon)', '', 0, 0, '', '', 'Make-Up Carbon', 3, '0', 0, 'Import'),
('f900-21', 'Air Filters 900', '20x20x1 (Media)', '', 28, 0, '', '', 'Make-Up Media', 3, '4', 12, 'Import'),
('f900-22', 'Air Filters 900', '20x20x4 (Mini Pleat)', '', 29, 0, '', '', 'Make-Up Box', 3, '2', 6, 'Import'),
('f900-23', 'Air Filters 900', 'Merv 11 24x24x4', '', 0, 0, '', '', 'CAC CER RM + 3A–5A (×3), 6A–9A (×4), 1A (×4), 2A (×4), NOC #1,#2,#2A (×3)', 26, '3/4/4/4/3', 84, 'Import'),
('f900-24', 'Air Filters 900', '28x29x4', '', 32, 0, '', '', 'CAC NOC #3 + North, Challengers #15–18', 6, '1', 6, 'Import'),
('f900-25', 'Air Filters 900', 'Merv 11 20x25x4', '', 6, 0, '', '', 'CAC Challengers #15–18', 4, '0', 0, 'Import'),
('f900-26', 'Air Filters 900', 'Merv 11 20x24x4', '', 0, 0, '', '', 'CAC Challengers #15–18', 4, '0', 0, 'Import'),
('f900-27', 'Air Filters 900', '18x24x4', '', 138, 0, '', '', 'CAC B-1–4 (×6), B-5–8 (×4), B-9–12 (×6)', 12, '6/4/6', 64, 'Import'),
('f900-28', 'Air Filters 900', 'Merv 13 Pre 24x24x2', '', 223, 0, '', '', 'AHU Buffalo (Pre)', 18, '12', 216, 'Import'),
('f900-29', 'Air Filters 900', 'Merv 13 Pre 12x24x2', '', 36, 0, '', '', 'AHU Buffalo (Pre)', 18, '4', 72, 'Import'),
('f900-30', 'Air Filters 900', 'HEPA 24x24x4', '', 249, 0, '', '', 'AHU Buffalo (HEPA)', 18, '12', 216, 'Import'),
('f900-31', 'Air Filters 900', 'HEPA 12x24x4', '', 81, 0, '', '', 'AHU Buffalo (HEPA)', 18, '4', 72, 'Import'),
('f900-32', 'Air Filters 900', 'RP 19x19x1', '', 16, 0, '', '', 'Fan Powered Box', 0, '0', 24, 'Import'),
('f900-33', 'Air Filters 900', 'RP 19x30x1', '', 9, 0, '', '', 'Fan Powered Box 1224', 0, '0', 3, 'Import'),
('f900-34', 'Air Filters 900', 'RP 11x14x1', '', 76, 0, '', '', 'Fan Powered Box', 0, '0', 13, 'Import'),
('f900-35', 'Air Filters 900', 'RP 13x14x1', '', 39, 0, '', '', 'Fan Powered Box 1430', 0, '0', 25, 'Import'),
('f900-36', 'Air Filters 900', 'RP 15x17x1', '', 39, 0, '', '', 'Fan Powered Box', 0, '0', 39, 'Import'),
('f900-37', 'Air Filters 900', 'RP 17x18x1', '', 8, 0, '', '', 'Fan Powered Box 2-7A/2-7B', 0, '0', 2, 'Import'),
('f900-38', 'Air Filters 900', 'RP 20x30', '', 0, 0, '', '', 'Fan Powered Box', 0, '0', 0, 'Import'),
('f900-39', 'Air Filters 900', 'RP 30x44', '', 0, 0, '', '', 'Fan Powered Box', 0, '0', 0, 'Import'),
('f900-40', 'Air Filters 900', 'PLT 27.5x33.5x2', '', 25, 0, '', '', 'Fan Powered Box', 0, '0', 0, 'Import'),
('f900-41', 'Air Filters 900', 'Merv 11 20x25x2', '', 72, 0, '', '', 'Fan Powered Box', 0, '0', 0, 'Import'),
('f900-42', 'Air Filters 900', 'RP 8½x21', '', 12, 0, '', '', 'Cab Htrs Stair 1-5', 4, '1', 4, 'Import'),
('f900-43', 'Air Filters 900', 'Cleanable', '', 0, 0, '', '', 'West Lobby Cab Htrs', 4, '2', 8, 'Import'),
('f900-44', 'Air Filters 900', '9x31x1', '', 16, 0, '', '', 'West Lobby Cab Htrs', 4, '2', 8, 'Import'),
('f900-45', 'Air Filters 900', '9x22.25x1', '', 0, 0, '', '', 'West Lobby Cab Htrs', 4, '2', 8, 'Import'),
('f900-46', 'Air Filters 900', 'RP 25x40', '', 8, 0, '', '', 'RP 25x40', 0, '0', 0, 'Import'),
('f900-47', 'Air Filters 900', 'Ply 20x30', '', 22, 0, '', '', 'BARD Units', 7, '1', 11, 'Import'),
('f900-48', 'Air Filters 900', 'Charcoal CHW Filter', '', 12, 0, '', '', 'CHW System', 0, '3', 3, 'Import'),
('f900-49', 'Air Filters 900', 'CHW Filter', '', 41, 0, '', '', 'CHW System', 0, '4', 4, 'Import'),
('f900-50', 'Air Filters 900', 'SCW Filter (3P790)', '', 4, 0, '', '', 'SCW System', 0, '4', 4, 'Import'),
('f904-0', 'Air Filters 904', '20x20x2', '', 432, 0, '', '', 'AHU 1-1, 1-2, 2-1, 2-2', 4, '24', 96, 'Import'),
('f904-1', 'Air Filters 904', 'Mega Pleat 24x20x4', '', 0, 0, '', '', 'H+V #1, #2', 2, '1', 2, 'Import'),
('f904-2', 'Air Filters 904', 'Mega Pleat 12x24x4', '', 2, 0, '', '', 'H+V #1', 1, '1', 1, 'Import'),
('f904-3', 'Air Filters 904', 'Mega Pleat 24x24x4', '', 0, 0, '', '', 'H+V #1', 1, '1', 1, 'Import'),
('f904-4', 'Air Filters 904', '12x20x1', '', 22, 0, '', '', 'SAC B-1', 1, '1', 1, 'Import'),
('f904-5', 'Air Filters 904', 'Cleanable', '', 0, 0, '', '', 'SAC 1-1, 1-2, 1-3, 1-4, 2-3', 5, '1', 5, 'Import'),
('f904-6', 'Air Filters 904', '16x25x4', '', 26, 0, '', '', 'SAC 2-1', 1, '1', 1, 'Import'),
('f904-7', 'Air Filters 904', '28x34x2', '', 0, 0, '', '', 'SAC 2-2, 2-4 (New)', 2, '1', 2, 'Import'),
('f904-8', 'Air Filters 904', '9.5x32.5x1', '', 42, 0, '', '', 'Misc', 0, '0', 0, 'Import'),
('f904-9', 'Air Filters 904', '20x20x1', '', 3, 0, '', '', 'ACB1', 1, '1', 1, 'Import'),
('f904-10', 'Air Filters 904', '33x10x1', '', 33, 0, '', '', 'FCU 1–5', 5, '1', 5, 'Import')
on conflict (id) do nothing;

select 'Penguin setup complete: ' || count(*) || ' inventory items' as result from public.inventory_items;
