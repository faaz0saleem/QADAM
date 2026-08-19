-- 20260818999900_lockdown.sql
--
-- THE LAST MIGRATION. It must stay last: everything below is "revoke the world,
-- then hand back exactly what the client needs", and anything created after it
-- would slip through.
--
-- Why this exists as a separate file rather than as part of the RLS migration:
--
--   * Postgres grants EXECUTE on a new function to PUBLIC by default. Every
--     function added after the RLS migration was therefore callable by anon.
--     record_courier_status was the sharp one — courier tracking numbers are
--     short and sequential, so an unauthenticated caller could mark a stranger's
--     order refused, which burns their coins and flags their account (§7.5).
--   * Supabase additionally sets default privileges granting on new TABLES to
--     anon and authenticated. Every view added after the RLS migration was
--     therefore readable, including coin_liability — which publishes a rupee
--     figure derived from COIN_VALUE_PKR, and §4 forbids publishing the rate.
--
-- Neither was visible locally, because a bare Postgres has no Supabase default
-- privileges. `db/test/grants.test.mjs` pins the whole surface so the next
-- object added has to be considered rather than defaulted.

-- ---------------------------------------------------------------------------
-- 1. Revoke everything.
-- ---------------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- Stop the defaults from re-opening this the next time a migration adds
-- something. Applies to objects created by the role running migrations.
alter default privileges in schema public
  revoke all on tables    from anon, authenticated;
alter default privileges in schema public
  revoke all on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Hand back exactly what a client needs. Anything not listed here is
--    server-side, reachable from an Edge Function as service_role and nowhere
--    else.
-- ---------------------------------------------------------------------------

-- your own row; name and city are yours to edit, status and device_hash are not
grant select              on users to authenticated;
grant update (name, city) on users to authenticated;

-- your own data, read-only; every write goes through a function
grant select on daily_steps   to authenticated;
grant select on coin_ledger   to authenticated;
grant select on orders        to authenticated;
grant select on ad_views      to authenticated;
grant select on notifications to authenticated;

-- cost_pkr is absent from both of these lists, deliberately
grant select (id, title, brand_id, category_id, price_pkr, stock, source,
              affiliate_url, images, created_at)
  on products to anon, authenticated;
grant select (id, order_id, product_id, qty, price_pkr, discount_pkr, coin_eligible)
  on order_items to authenticated;

-- the shop
grant select on brands     to anon, authenticated;
grant select on categories to anon, authenticated;
grant select on challenges to anon, authenticated;

-- social
grant select                         on teams        to authenticated;
grant select, delete                 on team_members to authenticated;
grant select, insert, update, delete on friendships  to authenticated;
grant select                         on leaderboard_snap to authenticated;
grant select, insert, update, delete on push_tokens  to authenticated;

-- Write-only: a client records its own events and can read none of them
-- (docs/METRICS.md §2). Reading the table would expose other people's habits.
grant insert on analytics_events to authenticated;
grant usage  on sequence analytics_events_id_seq to authenticated;

-- §1.5: a user may see what they have asked to be told about, and nothing else.
grant select on notify_me to authenticated;

-- views a client may read
grant select on coin_batches             to authenticated;
grant select on public_profiles          to authenticated;
grant select on product_discount_ceiling to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Functions. The short list.
-- ---------------------------------------------------------------------------
grant execute on function max_coin_discount_pkr(int, int)                 to anon, authenticated;
grant execute on function pkt_date(timestamptz)                           to anon, authenticated;
grant execute on function pkt_week_start(timestamptz)                     to anon, authenticated;

grant execute on function coin_balance(uuid)                              to authenticated;
grant execute on function affordable_discount_pkr(uuid, uuid, int)        to authenticated;
grant execute on function current_streak(uuid)                            to authenticated;
grant execute on function submit_steps(date, int, text)                    to authenticated;
grant execute on function place_order(jsonb, jsonb, text, text, int)      to authenticated;
grant execute on function leaderboard_page(uuid, text, text, int)         to authenticated;
grant execute on function leaderboard_friends(uuid, text)                 to authenticated;
grant execute on function create_team(text, text)                         to authenticated;
grant execute on function join_team(text)                                 to authenticated;
grant execute on function team_roster(uuid)                               to authenticated;
grant execute on function rewarded_ads_left_today()                        to authenticated;
grant execute on function my_referrals()                                  to authenticated;
grant execute on function shop_is_open()                                  to authenticated;
grant execute on function register_interest(uuid, text)                   to authenticated;
grant execute on function delete_my_account()                             to authenticated;

-- Everything else is server-side only, and the sharp ones are worth naming:
--   config_num, config_int        — would leak COIN_VALUE_PKR (§4)
--   award_steps                   — takes a user id; submit_steps is the door
--   credit_coins, spend_coins     — minting and debiting (§13.2)
--   refund_order_coins            — could un-burn a refused order (§7.5)
--   set_order_status              — could self-confirm a delivery
--   record_courier_status         — could burn a stranger's coins from a guessed
--                                   tracking number
--   respond_to_confirmation       — the WhatsApp webhook's entry point
--   grant_verified_ad_reward      — mints; only the AdMob SSV callback may call it
--   queue_order_confirmation      — could queue messages against any order
--   queue_expiry_warnings, queue_streak_warnings, refresh_leaderboards — cron only
--   gen_invite_code, gen_referral_code — cheap to call, no reason to expose
--   retention_curve, phase1_gates, phase2_is_unlocked — the Phase 1 decision;
--                                   an operator's numbers, not a user's
--   shop_interest_signals         — §1.5's demand read; same reason
--   assert_active                 — a guard, called from inside definer functions
