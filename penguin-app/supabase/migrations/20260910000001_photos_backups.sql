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
