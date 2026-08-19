-- The RPC surface the Edge Functions call.
--
-- PostgREST can only reach schemas listed in config.toml, and `private` is
-- deliberately not one of them — that is what keeps app_config off every device.
-- So the Edge Functions cannot call private.* directly, and the fix is NOT to
-- expose the schema. It is these thin wrappers: they live in `public` where
-- PostgREST can see them, and they are granted to service_role and nobody else.
--
-- The security boundary was never the schema name. It is the grant.

create or replace function public.issue_attestation_nonce(p_user_id uuid)
returns text
language sql
security definer
set search_path = public, private, pg_temp
as $$ select private.issue_attestation_nonce(p_user_id) $$;

create or replace function public.consume_attestation_nonce(p_user_id uuid, p_nonce text)
returns boolean
language sql
security definer
set search_path = public, private, pg_temp
as $$ select private.consume_attestation_nonce(p_user_id, p_nonce) $$;

create or replace function public.credit_rewarded_ad(
  p_user_id uuid, p_network_txn_id text, p_placement text default 'earn_home')
returns jsonb
language sql
security definer
set search_path = public, private, pg_temp
as $$ select private.credit_rewarded_ad(p_user_id, p_network_txn_id, p_placement) $$;

create or replace function public.coins_expiring_soon(p_days integer default 7)
returns table (user_id uuid, coins integer, expires_at timestamptz, batch_id uuid,
               token text, platform text, locale text)
language sql
security definer
set search_path = public, private, pg_temp
as $$ select * from private.coins_expiring_soon(p_days) $$;

create or replace function public.streaks_at_risk()
returns table (user_id uuid, streak_days integer, token text, platform text, locale text)
language sql
security definer
set search_path = public, private, pg_temp
as $$ select * from private.streaks_at_risk() $$;

create or replace function public.rebuild_leaderboards()
returns integer
language sql
security definer
set search_path = public, private, pg_temp
as $$ select private.rebuild_leaderboards() $$;

-- Every one of these is service_role only. A client calling any of them would be
-- reaching straight past attestation, the daily ad cap, or another user's data.
revoke all on function
  public.issue_attestation_nonce(uuid),
  public.consume_attestation_nonce(uuid, text),
  public.credit_rewarded_ad(uuid, text, text),
  public.coins_expiring_soon(integer),
  public.streaks_at_risk(),
  public.rebuild_leaderboards()
from public, anon, authenticated;

grant execute on function
  public.issue_attestation_nonce(uuid),
  public.consume_attestation_nonce(uuid, text),
  public.credit_rewarded_ad(uuid, text, text),
  public.coins_expiring_soon(integer),
  public.streaks_at_risk(),
  public.rebuild_leaderboards()
to service_role;

-- service_role runs the ingestion, the notifications and the admin dashboard, so
-- it needs the tables outright. It bypasses RLS by design; the append-only
-- trigger on coin_ledger still applies to it, which is the point of that trigger
-- being a trigger and not a policy.
grant usage on schema private to service_role;
grant all on all tables    in schema public  to service_role;
grant all on all tables    in schema private to service_role;
grant all on all sequences in schema public  to service_role;
alter default privileges in schema public  grant all on tables to service_role;
alter default privileges in schema private grant all on tables to service_role;
