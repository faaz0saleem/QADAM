-- Every private function, revoked from every client role — including the ones
-- added after the sweep that was supposed to do this.
--
-- 20260819010700 ran `revoke all on all functions in schema private from public,
-- anon, authenticated`. That covers the functions that existed AT THAT MOMENT.
-- Postgres grants EXECUTE on each new function to PUBLIC as it is created, so
-- every private function added in a later migration arrived world-callable
-- unless it was revoked by hand — and private.orders_settle_referral was not.
--
-- It is a trigger function, so calling it directly raises rather than doing
-- anything useful, and the practical exposure is nil. The habit is the problem:
-- "a blanket revoke ran once" is not a property of the schema, it is a fact
-- about one migration. So this sweeps again, and 13_function_grants_test.sql
-- pins the result rather than trusting the next sweep to be remembered.

do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.signature);
  end loop;
end $$;

comment on function public.max_coin_discount_pkr(int, int) is
  'README §0. The maximum coin discount, in whole PKR, fundable on one unit of an item '
  'priced p_price that cost us p_cost. Enforced as a CHECK on order_items — this is not '
  'application logic and must never be reimplemented in the app. '
  'Deliberately callable by clients: it is the published rule, and it reveals nothing, '
  'because calling it requires already knowing the cost.';
