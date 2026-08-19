-- private.notify() failed quietly when it was not configured.
--
-- It read app.functions_base_url with the missing_ok flag, which returns NULL,
-- concatenated NULL || '/expire-coins-notify' — still NULL — and handed that to
-- net.http_post. And it built an Authorization header out of an empty string
-- when the service key was unset, which reaches the function and gets a 401.
--
-- Either way the coin-expiry push, which §4 calls our single best reactivation
-- lever, simply never fires, and the only trace is a cron job that reports
-- success. The two settings are a P1 in HUMAN_TASKS.md precisely because they
-- are easy to forget; the failure has to be loud enough that forgetting is
-- noticed.

create or replace function private.notify(p_function text)
returns bigint
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_base text := current_setting('app.functions_base_url', true);
  v_key  text := current_setting('app.service_role_key', true);
  v_id   bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise warning 'pg_net unavailable — % not invoked', p_function;
    return null;
  end if;

  if coalesce(v_base, '') = '' or coalesce(v_key, '') = '' then
    raise warning
      'notify(%) skipped: app.functions_base_url and app.service_role_key must both '
      'be set on the database. See HUMAN_TASKS.md.', p_function;
    return null;
  end if;

  execute format(
    'select net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb)',
    v_base || '/' || p_function,
    jsonb_build_object('Content-Type', 'application/json',
                       'Authorization', 'Bearer ' || v_key),
    '{}'::jsonb)
  into v_id;
  return v_id;
end $$;

comment on function private.notify(text) is
  'Invoked from cron. Needs app.functions_base_url and app.service_role_key set as '
  'database settings — see HUMAN_TASKS.md. Warns loudly and does nothing rather than '
  'posting to a NULL url when they are missing.';

revoke all on function private.notify(text) from public, anon, authenticated;
