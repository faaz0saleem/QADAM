-- 20260818001000_rls.sql
-- Row-level security and privileges for the two API roles.
--
-- Posture: deny everything, then grant back the narrowest useful surface.
-- Two things in particular must never reach a client:
--   * products.cost_pkr and order_items.cost_pkr — our buying price
--   * app_config — it holds COIN_VALUE_PKR, and §4 forbids publishing the rate
--
-- Supabase grants broadly to anon/authenticated by default, so this file starts
-- by taking that back. Any table added later needs its own explicit grants.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

alter table users            enable row level security;
alter table daily_steps      enable row level security;
alter table coin_ledger      enable row level security;
alter table brands           enable row level security;
alter table categories       enable row level security;
alter table products         enable row level security;
alter table orders           enable row level security;
alter table order_items      enable row level security;
alter table teams            enable row level security;
alter table team_members     enable row level security;
alter table friendships      enable row level security;
alter table challenges       enable row level security;
alter table leaderboard_snap enable row level security;
alter table fraud_events     enable row level security;

-- ---------------------------------------------------------------------------
-- users: your own row only. Phone numbers are not leaderboard data, so the
-- table stays self-scoped and a narrow view carries what a board needs.
-- status, device_hash and referred_by are ours, not the user's, and are
-- withheld at the column level.
-- ---------------------------------------------------------------------------
create policy users_select_self on users
  for select to authenticated using (id = auth.uid());
create policy users_update_self on users
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

grant select              on users to authenticated;
grant update (name, city) on users to authenticated;

-- Owner's rights on purpose: publishes exactly the three fields a leaderboard
-- row or a team roster needs, and nothing else.
create view public_profiles as
  select id, name, city from users where status <> 'deleted';
grant select on public_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- daily_steps: yours, read-only. Writes go through submit_steps() (§6.1).
-- ---------------------------------------------------------------------------
create policy steps_select_self on daily_steps
  for select to authenticated using (user_id = auth.uid());
grant select on daily_steps to authenticated;

-- ---------------------------------------------------------------------------
-- coin_ledger: yours, read-only, forever. No client INSERT/UPDATE/DELETE
-- policy exists, so §13.2 cannot be violated through the API at all.
-- ---------------------------------------------------------------------------
create policy ledger_select_self on coin_ledger
  for select to authenticated using (user_id = auth.uid());
grant select on coin_ledger to authenticated;

-- ---------------------------------------------------------------------------
-- catalogue: readable by everyone, EXCEPT cost_pkr.
-- ---------------------------------------------------------------------------
create policy brands_public on brands
  for select to anon, authenticated using (status in ('signed','live'));
grant select on brands to anon, authenticated;

create policy categories_public on categories
  for select to anon, authenticated using (true);
grant select on categories to anon, authenticated;

create policy products_public on products
  for select to anon, authenticated using (true);
grant select (id, title, brand_id, category_id, price_pkr, stock, source,
              affiliate_url, images, created_at)
  on products to anon, authenticated;

grant select on product_discount_ceiling to anon, authenticated;

-- ---------------------------------------------------------------------------
-- orders: yours, read-only. Writes go through place_order() / set_order_status().
-- ---------------------------------------------------------------------------
create policy orders_select_self on orders
  for select to authenticated using (user_id = auth.uid());
grant select on orders to authenticated;

create policy order_items_select_self on order_items
  for select to authenticated
  using (exists (select 1 from orders o where o.id = order_items.order_id and o.user_id = auth.uid()));
grant select (id, order_id, product_id, qty, price_pkr, discount_pkr, coin_eligible)
  on order_items to authenticated;

grant select on coin_batches to authenticated;

-- ---------------------------------------------------------------------------
-- social: teams are public so a leaderboard and an invite link both work.
-- ---------------------------------------------------------------------------
create policy teams_public on teams
  for select to authenticated using (true);
create policy teams_insert_own on teams
  for insert to authenticated with check (captain_id = auth.uid());
grant select, insert on teams to authenticated;

create policy team_members_public on team_members
  for select to authenticated using (true);
create policy team_members_join_self on team_members
  for insert to authenticated with check (user_id = auth.uid());
create policy team_members_leave_self on team_members
  for delete to authenticated using (user_id = auth.uid());
grant select, insert, delete on team_members to authenticated;

create policy friendships_own on friendships
  for select to authenticated using (user_id = auth.uid() or friend_id = auth.uid());
create policy friendships_request on friendships
  for insert to authenticated with check (user_id = auth.uid());
create policy friendships_respond on friendships
  for update to authenticated using (friend_id = auth.uid());
create policy friendships_remove on friendships
  for delete to authenticated using (user_id = auth.uid() or friend_id = auth.uid());
grant select, insert, update, delete on friendships to authenticated;

create policy challenges_public on challenges
  for select to anon, authenticated using (true);
grant select on challenges to anon, authenticated;

create policy leaderboard_public on leaderboard_snap
  for select to authenticated using (true);
grant select on leaderboard_snap to authenticated;

-- fraud_events and app_config get no policy and no grant: service_role only.

-- ---------------------------------------------------------------------------
-- Function privileges.
--
-- The client-callable list is short on purpose. Everything that mints, moves or
-- prices coins is server-side only, reachable from an Edge Function running as
-- service_role and from nowhere else.
-- ---------------------------------------------------------------------------
grant execute on function max_coin_discount_pkr(int, int)                 to anon, authenticated;
grant execute on function coin_balance(uuid)                              to authenticated;
grant execute on function affordable_discount_pkr(uuid, uuid, int)        to authenticated;
grant execute on function submit_steps(date, int, text, boolean, text[])  to authenticated;
grant execute on function current_streak(uuid)                            to authenticated;
grant execute on function place_order(jsonb, jsonb, text, text, int)      to authenticated;
grant execute on function leaderboard_page(uuid, text, text, int)         to authenticated;
grant execute on function leaderboard_friends(uuid, text)                 to authenticated;
grant execute on function pkt_date(timestamptz)                           to authenticated;
grant execute on function pkt_week_start(timestamptz)                     to authenticated;
grant execute on function gen_invite_code()                               to authenticated;

-- Explicitly server-side only. Listed rather than merely omitted so that a
-- future migration adding a grant here has to argue with this comment first.
--   config_num, config_int          — would leak COIN_VALUE_PKR (§4)
--   award_steps                     — takes a user id; submit_steps is the door
--   credit_coins, spend_coins       — minting and debiting (§13.2)
--   refund_order_coins              — could un-burn a refused order (§7.5)
--   set_order_status                — could self-confirm a delivery
--   refresh_leaderboards            — expensive; cron only
