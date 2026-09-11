-- ═══════════════════════════════════════════════════════════════════════════
--  Penguin Maintenance — one-off clean-up after the first Slack import
--  Paste into Supabase → SQL Editor → Run. Safe to re-run.
--   1. Removes the test order "probe" (WO-2026-0005) created while checking the grants.
--   2. Moves every open work order to 900 Sylvan Ave (904 is closed); completed
--      orders keep their historical location.
-- ═══════════════════════════════════════════════════════════════════════════

delete from public.work_orders where wo_number = 'WO-2026-0005' and title = 'probe';

update public.work_orders
   set location = '900 Sylvan Ave'
 where location <> '900 Sylvan Ave'
   and status <> 'Completed';

insert into public.activity_logs (action, detail, user_name)
values ('WO Updated', 'Open work orders moved to 900 Sylvan Ave (904 closed); test order WO-2026-0005 removed', 'System');

select wo_number, title, location, status from public.work_orders order by created_at desc limit 12;
