-- ═══════════════════════════════════════════════════════════════════════════
--  Work orders + visit log
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.work_orders (
  id            text primary key default gen_random_uuid()::text,
  wo_number     text unique,                              -- WO-2026-0007, assigned by trigger
  title         text not null,
  location      text not null default 'Other',
  type          text not null default 'Cold Call',
  priority      text not null default 'Normal',
  status        text not null default 'Open',
  details       text not null default '',
  photos        jsonb not null default '[]'::jsonb,       -- [{thumb, full}]
  created_by    text,
  source        text,                                     -- null | slack | slack-slash
  slack_channel text,
  slack_ts      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists work_orders_status_idx on public.work_orders (status);
create index if not exists work_orders_created_idx on public.work_orders (created_at desc);

create table if not exists public.work_order_visits (
  id            text primary key default gen_random_uuid()::text,
  work_order_id text not null references public.work_orders (id) on delete cascade,
  visit_date    date not null default current_date,
  tech          text not null default '',
  hours         numeric(6,2) not null default 0 check (hours >= 0),
  notes         text not null default '',
  photos        jsonb not null default '[]'::jsonb,
  logged_by     text,
  logged_at     timestamptz not null default now()
);
create index if not exists work_order_visits_wo_idx on public.work_order_visits (work_order_id, visit_date);

drop trigger if exists work_orders_set_updated_at on public.work_orders;
create trigger work_orders_set_updated_at before update on public.work_orders
  for each row execute function public.set_updated_at();

-- ── WO numbering: WO-<year>-<0001>, one counter per year, safe under concurrency ──
create table if not exists public.wo_counters (
  year integer primary key,
  last integer not null default 0
);

create or replace function public.assign_wo_number()
returns trigger language plpgsql security definer set search_path = public as $$
declare yr integer; n integer; m text[];
begin
  if new.wo_number is null or new.wo_number = '' then
    yr := extract(year from coalesce(new.created_at, now()))::integer;
    insert into public.wo_counters (year, last) values (yr, 1)
      on conflict (year) do update set last = public.wo_counters.last + 1
      returning last into n;
    new.wo_number := format('WO-%s-%s', yr, lpad(n::text, 4, '0'));
  else
    -- imported / explicit number: keep the counter ahead of it
    m := regexp_match(new.wo_number, '^WO-(\d{4})-(\d+)$');
    if m is not null then
      insert into public.wo_counters (year, last) values (m[1]::integer, m[2]::integer)
        on conflict (year) do update set last = greatest(public.wo_counters.last, excluded.last);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists work_orders_assign_number on public.work_orders;
create trigger work_orders_assign_number before insert on public.work_orders
  for each row execute function public.assign_wo_number();

-- ── Atomic update: patch fields and append photos in one statement ─────────
create or replace function public.update_work_order(p_id text, p_patch jsonb default '{}'::jsonb, p_new_photos jsonb default '[]'::jsonb)
returns public.work_orders
language plpgsql security invoker as $$
declare r public.work_orders;
begin
  update public.work_orders set
    title    = coalesce(p_patch->>'title', title),
    location = coalesce(p_patch->>'location', location),
    type     = coalesce(p_patch->>'type', type),
    priority = coalesce(p_patch->>'priority', priority),
    status   = coalesce(p_patch->>'status', status),
    details  = coalesce(p_patch->>'details', details),
    photos   = case when p_patch ? 'photos' then p_patch->'photos' else photos end || coalesce(p_new_photos, '[]'::jsonb)
  where id = p_id
  returning * into r;
  return r;
end $$;

-- ── Row Level Security: crew and admins read/write; only admins delete ──────
alter table public.work_orders enable row level security;
alter table public.work_order_visits enable row level security;
alter table public.wo_counters enable row level security;

drop policy if exists wo_select on public.work_orders;
create policy wo_select on public.work_orders for select to authenticated using (true);
drop policy if exists wo_insert on public.work_orders;
create policy wo_insert on public.work_orders for insert to authenticated with check (true);
drop policy if exists wo_update on public.work_orders;
create policy wo_update on public.work_orders for update to authenticated using (true) with check (true);
drop policy if exists wo_admin_delete on public.work_orders;
create policy wo_admin_delete on public.work_orders for delete to authenticated using (public.is_admin());

drop policy if exists wov_select on public.work_order_visits;
create policy wov_select on public.work_order_visits for select to authenticated using (true);
drop policy if exists wov_insert on public.work_order_visits;
create policy wov_insert on public.work_order_visits for insert to authenticated with check (true);
drop policy if exists wov_update on public.work_order_visits;
create policy wov_update on public.work_order_visits for update to authenticated using (true) with check (true);
drop policy if exists wov_delete on public.work_order_visits;
create policy wov_delete on public.work_order_visits for delete to authenticated using (true);

grant select, insert, update, delete on public.work_orders, public.work_order_visits to authenticated;
grant execute on function public.update_work_order(text, jsonb, jsonb) to authenticated;
revoke all on public.wo_counters from authenticated, anon;   -- only the definer trigger touches it

-- ── Realtime ────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.work_orders;
alter publication supabase_realtime add table public.work_order_visits;
alter table public.work_orders replica identity full;
alter table public.work_order_visits replica identity full;

-- ── Photos bucket for work orders and visits ───────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wo-photos', 'wo-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "wo photos are public" on storage.objects;
create policy "wo photos are public" on storage.objects for select using (bucket_id = 'wo-photos');
drop policy if exists "crew can upload wo photos" on storage.objects;
create policy "crew can upload wo photos" on storage.objects for insert to authenticated with check (bucket_id = 'wo-photos');
drop policy if exists "crew can replace wo photos" on storage.objects;
create policy "crew can replace wo photos" on storage.objects for update to authenticated using (bucket_id = 'wo-photos') with check (bucket_id = 'wo-photos');
drop policy if exists "crew can delete wo photos" on storage.objects;
create policy "crew can delete wo photos" on storage.objects for delete to authenticated using (bucket_id = 'wo-photos');

-- ── Include work orders in the hourly backups ──────────────────────────────
alter table public.backups add column if not exists work_orders jsonb not null default '[]'::jsonb;
alter table public.backups add column if not exists visits jsonb not null default '[]'::jsonb;
alter table public.backups add column if not exists wo_count integer not null default 0;

create or replace function public.take_backup(p_kind text default 'hourly', p_note text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_items jsonb; v_users jsonb; v_logs jsonb; v_wos jsonb; v_visits jsonb; v_id bigint;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(i) order by i."group", i.name), '[]'::jsonb) into v_items from public.inventory_items i;
  select coalesce(jsonb_agg(to_jsonb(u) order by u.username), '[]'::jsonb) into v_users from public.users u;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.ts desc), '[]'::jsonb) into v_logs
    from (select * from public.activity_logs order by ts desc limit 5000) l;
  select coalesce(jsonb_agg(to_jsonb(w) order by w.created_at desc), '[]'::jsonb) into v_wos from public.work_orders w;
  select coalesce(jsonb_agg(to_jsonb(v) order by v.logged_at), '[]'::jsonb) into v_visits from public.work_order_visits v;
  insert into public.backups (kind, note, item_count, user_count, log_count, items, users, logs, work_orders, visits, wo_count)
  values (p_kind, p_note, jsonb_array_length(v_items), jsonb_array_length(v_users), jsonb_array_length(v_logs), v_items, v_users, v_logs,
          v_wos, v_visits, jsonb_array_length(v_wos))
  returning id into v_id;
  return v_id;
end $$;

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

  -- Work orders (only when the snapshot carries them — older snapshots predate the table)
  if jsonb_array_length(v_snapshot.work_orders) > 0 then
    delete from public.work_orders
     where id not in (select x->>'id' from jsonb_array_elements(v_snapshot.work_orders) x);
    insert into public.work_orders
      select * from jsonb_populate_recordset(null::public.work_orders, v_snapshot.work_orders)
    on conflict (id) do update set
      wo_number = excluded.wo_number, title = excluded.title, location = excluded.location, type = excluded.type,
      priority = excluded.priority, status = excluded.status, details = excluded.details, photos = excluded.photos,
      created_by = excluded.created_by, source = excluded.source, slack_channel = excluded.slack_channel,
      slack_ts = excluded.slack_ts, created_at = excluded.created_at, updated_at = excluded.updated_at;
    delete from public.work_order_visits
     where id not in (select x->>'id' from jsonb_array_elements(v_snapshot.visits) x);
    insert into public.work_order_visits
      select * from jsonb_populate_recordset(null::public.work_order_visits, v_snapshot.visits)
    on conflict (id) do update set
      work_order_id = excluded.work_order_id, visit_date = excluded.visit_date, tech = excluded.tech,
      hours = excluded.hours, notes = excluded.notes, photos = excluded.photos,
      logged_by = excluded.logged_by, logged_at = excluded.logged_at;
  end if;

  insert into public.activity_logs
    select * from jsonb_populate_recordset(null::public.activity_logs, v_snapshot.logs)
  on conflict (id) do nothing;

  insert into public.activity_logs (action, detail, user_name, user_id)
  values ('Backup Restored', 'Restored from backup #' || p_id || ' (' || to_char(v_snapshot.taken_at, 'YYYY-MM-DD HH24:MI') || ')',
          coalesce((select display_name from public.users where id = auth.uid()), 'System'), auth.uid());
  return v_safety;
end $$;
