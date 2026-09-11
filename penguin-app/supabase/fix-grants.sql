-- ═══════════════════════════════════════════════════════════════════════════
--  Penguin Maintenance — SERVICE ROLE GRANTS
--  Paste into Supabase → SQL Editor → Run. Safe to re-run.
--
--  The server-side routes (Slack intake, Slack events, user management, the
--  old-portal PM import) use the service-role key. The tables were created with
--  grants for signed-in users only, so those routes fail with
--  "permission denied for table work_orders". This grants the service role
--  full access to every table now and to any table added later.
-- ═══════════════════════════════════════════════════════════════════════════

grant usage on schema public to service_role;
grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;

alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;

-- postgres is the role the SQL editor runs as; keep it able to see everything too
grant all privileges on all tables in schema public to postgres;

select 'service_role grants applied: ' || count(*) || ' tables' as result
from information_schema.role_table_grants
where grantee = 'service_role' and table_schema = 'public' and privilege_type = 'SELECT';
