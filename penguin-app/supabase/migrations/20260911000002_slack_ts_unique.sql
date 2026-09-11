-- One work order per Slack message: the intake paths (hourly pull, pull-on-open
-- from several phones, the Events API push) can race between "is it there yet?"
-- and "insert"; this index makes the database the guard (the code treats a
-- 23505 on insert as "already imported").
create unique index if not exists work_orders_slack_msg_uidx
  on public.work_orders (slack_channel, slack_ts)
  where slack_ts is not null;
