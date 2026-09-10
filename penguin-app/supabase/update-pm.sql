-- ═══════════════════════════════════════════════════════════════════════════
--  Penguin Maintenance — PM SHEET / PM RECORDS UPDATE
--  Paste into Supabase → SQL Editor → Run. Adds the pm_records table, the
--  pm-files storage bucket and includes PM records in hourly backups.
--  Safe to re-run. The old portal's archived PMs are imported afterwards from
--  the app: PM Records → "Import old records" (admin only).
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
--  PM Sheet records (completed preventive-maintenance / repair work orders)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.pm_records (
  id               text primary key default gen_random_uuid()::text,
  pm_date          date not null default current_date,
  facility         text not null,
  technician       text not null,                        -- "Ray Sinnott, Brian Scudder"
  technicians      jsonb not null default '[]'::jsonb,   -- ["Ray Sinnott", "Brian Scudder"]
  equipment        text not null,                        -- "Liebert Unit #7a, Cooling Tower 1"
  frequency        text not null,                        -- Monthly | Quarterly | Semi-Annual | Annual | Repair
  follow_up        boolean not null default false,
  follow_up_notes  text not null default '',
  tasks_completed  text not null default '',
  general_comments text not null default '',
  safety_data      jsonb not null default '[]'::jsonb,   -- [[{task, done, na, condition}], …] PPE / pre-job / electrical / gas
  post_job_data    jsonb not null default '[]'::jsonb,   -- [{task, done, na}]
  checklist_data   jsonb not null default '[]'::jsonb,   -- [{header, tasks:[{text, done}], findings, readings:{label:value}}]
  signature_data   jsonb not null default '[]'::jsonb,   -- [{type: safety|completion, name, url}]
  photos           jsonb not null default '[]'::jsonb,   -- [{caption, url, kind: loto|photo}]
  pdf_url          text,
  email_subject    text,
  email_to         jsonb not null default '[]'::jsonb,
  email_sent_at    timestamptz,
  email_html       text,                                 -- kept for resend / legacy records
  created_by       text,
  legacy_path      text unique,                          -- pm-records/2026/06-June/… for imported files
  created_at       timestamptz not null default now()
);
create index if not exists pm_records_date_idx on public.pm_records (pm_date desc, created_at desc);
create index if not exists pm_records_followup_idx on public.pm_records (follow_up) where follow_up;

alter table public.pm_records enable row level security;

drop policy if exists pm_select on public.pm_records;
create policy pm_select on public.pm_records for select to authenticated using (true);
drop policy if exists pm_insert on public.pm_records;
create policy pm_insert on public.pm_records for insert to authenticated with check (true);
drop policy if exists pm_update on public.pm_records;
create policy pm_update on public.pm_records for update to authenticated using (true) with check (true);
drop policy if exists pm_admin_delete on public.pm_records;
create policy pm_admin_delete on public.pm_records for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on public.pm_records to authenticated;

alter publication supabase_realtime add table public.pm_records;

-- ── Files: photos, signatures and the PDF for each record ──────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pm-files', 'pm-files', true, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = true, file_size_limit = 26214400,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

drop policy if exists "pm files are public" on storage.objects;
create policy "pm files are public" on storage.objects for select using (bucket_id = 'pm-files');
drop policy if exists "crew can upload pm files" on storage.objects;
create policy "crew can upload pm files" on storage.objects for insert to authenticated with check (bucket_id = 'pm-files');
drop policy if exists "crew can replace pm files" on storage.objects;
create policy "crew can replace pm files" on storage.objects for update to authenticated using (bucket_id = 'pm-files') with check (bucket_id = 'pm-files');
drop policy if exists "admins can delete pm files" on storage.objects;
create policy "admins can delete pm files" on storage.objects for delete to authenticated using (bucket_id = 'pm-files' and public.is_admin());

-- ── Include PM records in the hourly backups (metadata only; files live in Storage) ──
alter table public.backups add column if not exists pm_records jsonb not null default '[]'::jsonb;
alter table public.backups add column if not exists pm_count integer not null default 0;

create or replace function public.take_backup(p_kind text default 'hourly', p_note text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_items jsonb; v_users jsonb; v_logs jsonb; v_wos jsonb; v_visits jsonb; v_pms jsonb; v_id bigint;
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
  -- email_html can be large and is derivable; leave it out of the snapshot
  select coalesce(jsonb_agg(to_jsonb(p) - 'email_html' order by p.pm_date desc), '[]'::jsonb) into v_pms from public.pm_records p;
  insert into public.backups (kind, note, item_count, user_count, log_count, items, users, logs, work_orders, visits, wo_count, pm_records, pm_count)
  values (p_kind, p_note, jsonb_array_length(v_items), jsonb_array_length(v_users), jsonb_array_length(v_logs), v_items, v_users, v_logs,
          v_wos, v_visits, jsonb_array_length(v_wos), v_pms, jsonb_array_length(v_pms))
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

  -- PM records: re-create any that were deleted; never overwrite existing ones (they are immutable)
  if jsonb_array_length(v_snapshot.pm_records) > 0 then
    insert into public.pm_records
      select * from jsonb_populate_recordset(null::public.pm_records, v_snapshot.pm_records)
    on conflict (id) do nothing;
  end if;

  insert into public.activity_logs
    select * from jsonb_populate_recordset(null::public.activity_logs, v_snapshot.logs)
  on conflict (id) do nothing;

  insert into public.activity_logs (action, detail, user_name, user_id)
  values ('Backup Restored', 'Restored from backup #' || p_id || ' (' || to_char(v_snapshot.taken_at, 'YYYY-MM-DD HH24:MI') || ')',
          coalesce((select display_name from public.users where id = auth.uid()), 'System'), auth.uid());
  return v_safety;
end $$;

select 'PM update complete: ' || (select count(*) from public.pm_records) || ' PM record(s) in the table' as result;
