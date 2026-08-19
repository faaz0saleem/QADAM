-- Scheduled jobs. Run this once against the hosted project, after `db push`.
--
--   Supabase Dashboard -> Database -> Extensions -> enable `pg_cron`
--   then run this file in the SQL editor.
--
-- All times are UTC. Pakistan is UTC+5 with no daylight saving, so 09:00 PKT is
-- 04:00 UTC year-round.

create extension if not exists pg_cron;

-- §7.3: recompute the boards every 15 minutes. Never rank on read.
select cron.schedule(
  'refresh-leaderboards',
  '*/15 * * * *',
  $$select refresh_leaderboards();$$
);

-- §4, §12: warn about expiring coins once a day at 09:00 PKT.
select cron.schedule(
  'queue-expiry-warnings',
  '0 4 * * *',
  $$select queue_expiry_warnings();$$
);

-- §7.1: streak-break reminders at 19:00 PKT, while there is still an evening
-- left to walk in.
select cron.schedule(
  'queue-streak-warnings',
  '0 14 * * *',
  $$select queue_streak_warnings();$$
);

-- To inspect or remove:
--   select * from cron.job;
--   select cron.unschedule('refresh-leaderboards');
