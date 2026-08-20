-- ============================================================================
-- Group orders: one basket, one team, everybody says yes.
--
-- The feature was asked for as "their credits can be pooled". §13.3 says coins
-- never move between users — ever — so this is the co-payment shape instead, and
-- the first four assertions in this file are the ones that matter: after five
-- people buy one thing together, every single debit in the ledger is a debit on
-- the person whose batch it came out of, and nobody's balance went up.
--
-- If a future change makes a coin cross from one user to another, this file goes
-- red before anything else does.
-- ============================================================================
begin;
select plan(43);

-- ── §13.2: the signature carries no numbers ────────────────────────────────
select is(
  (select coalesce(string_agg(a.arg || ' ' || format_type(t.oid, null), ', '), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral unnest(p.proargnames, p.proargtypes::oid[]) as a(arg, argtype)
     join pg_type t on t.oid = a.argtype
    where n.nspname = 'public'
      and p.proname in ('open_group_order', 'respond_to_group_order')
      and t.typname <> 'bool'
      and (a.arg ilike '%coin%' or a.arg ilike '%discount%' or a.arg ilike '%pledge%'
           or a.arg ilike '%share%' or a.arg ilike '%price%' or a.arg ilike '%total%'
           or a.arg ilike '%amount%')),
  '',
  'no group-order RPC takes a coin count, a pledge, a share or a total (§13.2)');

-- ── teams are five ─────────────────────────────────────────────────────────
create temporary table t (a uuid, b uuid, c uuid, d uuid, e uuid, f uuid,
                          item uuid, team uuid, code text, gid uuid, ord uuid);
insert into t (a, b, c, d, e, f) values (
  tests.new_user(p_created_at => now() - interval '90 days'),
  tests.new_user(p_created_at => now() - interval '90 days'),
  tests.new_user(p_created_at => now() - interval '90 days'),
  tests.new_user(p_created_at => now() - interval '90 days'),
  tests.new_user(p_created_at => now() - interval '90 days'),
  tests.new_user(p_created_at => now() - interval '90 days'));

select tests.act_as((select a from t));
update t set team = (public.create_team('The Fives', 'Lahore')).id;
update t set code = (select invite_code from public.teams where id = (select team from t));

select is((select member_max from public.teams where id = (select team from t)), 5,
  'a new team caps at five members, not thirty');

select tests.act_as((select b from t)); select public.join_team((select code from t));
select tests.act_as((select c from t)); select public.join_team((select code from t));
select tests.act_as((select d from t)); select public.join_team((select code from t));
select tests.act_as((select e from t)); select public.join_team((select code from t));

select is((select count(*)::int from public.team_members where team_id = (select team from t)), 5,
  'five of them are in');

select tests.act_as((select f from t));
select throws_ok(
  format('select public.join_team(%L)', (select code from t)),
  '23514',
  null,
  'the sixth is turned away');

-- ── a basket three people buy together ─────────────────────────────────────
-- price 2000 / cost 1200 → margin 800 → §0 cap = min(160, 200) = 160.
update t set item = tests.new_product(2000, 1200, 50);

-- Everyone leaves except a, b, c, so "unanimous" is three people.
select tests.act_as((select d from t)); select public.leave_team();
select tests.act_as((select e from t)); select public.leave_team();

-- 2,000 coins each. At the private rate that is 60 rupees of reach apiece:
-- 180 between them, which is more than the §0 cap of 160. The cap wins.
select private.mint_coins((select a from t), 2000, 'steps', public.pkt_date(now()) - 1) \gset a_
select private.mint_coins((select b from t), 2000, 'steps', public.pkt_date(now()) - 1) \gset b_
select private.mint_coins((select c from t), 2000, 'steps', public.pkt_date(now()) - 1) \gset c_

select tests.act_as((select a from t));
create temporary table g (r jsonb);
insert into g (r) select public.open_group_order(
  jsonb_build_array(jsonb_build_object('product_id', (select item from t), 'qty', 1)),
  'House 7, Model Town, Lahore', '+923009998877');
update t set gid = ((select r from g) ->> 'id')::uuid;

select is(((select r from g) ->> 'status'), 'open', 'the basket opens');
select is(((select r from g) ->> 'waiting_on')::int, 2,
  'and is waiting on the other two — opening it is approving it');
select is(((select r from g) ->> 'subtotal_pkr')::int, 2000, 'the subtotal comes from the products table');
select is(((select r from g) ->> 'max_discount_pkr')::int, 160,
  'the saving on offer is the §0 cap, not the sum of what three people could reach');
select is(((select r from g) ->> 'discount_pkr')::int, 60,
  'and what is committed so far is only what the one person who has said yes can fund');

-- ── who may see it, and what of it ─────────────────────────────────────────
select tests.act_as((select f from t));
select throws_ok(
  format('select public.group_order(%L)', (select gid from t)),
  'P0002',
  null,
  'someone outside the team cannot see the basket at all');

select tests.act_as((select b from t));
select is((public.group_order((select gid from t))) ->> 'address', null,
  'a teammate approving the basket is not shown the opener''s street');
select tests.act_as((select a from t));
select isnt((public.group_order((select gid from t))) ->> 'address', null,
  'the opener sees their own address');

-- No client role can go around the RPC and read the tables directly.
select ok(tests.denied('authenticated', (select a from t), 'select * from public.group_orders'),
  'group_orders is not readable by a signed-in client');
select ok(tests.denied('authenticated', (select a from t), 'select * from public.group_order_approvals'),
  'nor are the approvals');
select ok(tests.denied('authenticated', (select a from t), 'select * from public.group_order_items'),
  'nor the items');

-- ── one no ends it; but first, one yes does not ────────────────────────────
select tests.act_as((select b from t));
select is((public.respond_to_group_order((select gid from t), true)) ->> 'status', 'open',
  'two of three approvals is not unanimity, so it stays open');
select is((public.respond_to_group_order((select gid from t), true)) ->> 'waiting_on', '1',
  'one still to go');

select tests.act_as((select c from t));
insert into g (r) select public.respond_to_group_order((select gid from t), true);
update t set ord = ((select r from g order by r ->> 'status' desc limit 1) ->> 'order_id')::uuid;
update t set ord = (select order_id from public.group_orders where id = (select gid from t));

select is((select status from public.group_orders where id = (select gid from t)), 'placed',
  'the last yes places the order');
select isnt((select order_id from public.group_orders where id = (select gid from t)), null,
  'and it has a real order behind it');

-- ── §0 still binds, and the group did not buy a bigger one ─────────────────
select is((select discount_pkr from public.orders where id = (select ord from t)), 160,
  'the discount is exactly the §0 cap — three wallets do not raise it');
select is((select total_pkr from public.orders where id = (select ord from t)), 1840,
  'and the total is the subtotal less that cap');
select ok(
  (select bool_and(oi.discount_pkr <= oi.qty * public.max_coin_discount_pkr(oi.price_pkr, oi.cost_pkr))
     from public.order_items oi where oi.order_id = (select ord from t)),
  'every line is still inside §0 — the same CHECK, the same function');

-- ══════════════════════════════════════════════════════════════════════════
-- §13.3 — THE ASSERTIONS THIS FILE EXISTS FOR
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from public.coin_ledger l
    where l.order_id = (select ord from t) and l.delta > 0),
  0,
  'not one coin was CREDITED anywhere by a group purchase — no balance went up');

select is(
  (select count(*)::int
     from public.coin_ledger l
     join public.coin_ledger b on b.id = l.consumes_id
    where l.order_id = (select ord from t) and b.user_id <> l.user_id),
  0,
  'every debit came out of a batch belonging to the person being debited — '
  'no coin crossed from one user to another (§13.3)');

select is(
  (select count(distinct l.user_id)::int from public.coin_ledger l
    where l.order_id = (select ord from t)),
  3,
  'all three of them paid, out of three separate ledgers');

select is(
  (select count(*)::int from public.coin_ledger l
    where l.order_id = (select ord from t)
      and l.user_id not in (select a from t union select b from t union select c from t)),
  0,
  'and nobody outside the three is in the ledger for this order');

-- The arithmetic: 160 rupees of discount at the private rate is 5,334 coins,
-- spread across three people. Each paid for their own share and no more.
select is(
  (select -sum(l.delta)::int from public.coin_ledger l where l.order_id = (select ord from t)),
  5334,
  'the coins taken are exactly what 160 rupees of discount costs, to the coin');

select is(
  (select sum(a.coins_spent)::int from public.group_order_approvals a
    where a.group_order_id = (select gid from t)),
  5334,
  'and the receipt each member sees adds up to the same number');

select ok(
  (select bool_and(bal < 2000) from (
     select public.coin_balance(u) as bal
       from (select a as u from t union select b from t union select c from t) x) y),
  'every contributor is poorer than they were, and none of them richer');

-- ── the ones who are in but not paying ─────────────────────────────────────
-- A member who says "yes, but not my coins" still gives permission. A member
-- inside the §6.1 redemption hold likewise: they can approve, they cannot fund.
select tests.act_as((select a from t));
update t set gid = (public.open_group_order(
  jsonb_build_array(jsonb_build_object('product_id', (select item from t), 'qty', 1)),
  'House 7, Model Town, Lahore', '+923009998877') ->> 'id')::uuid;

select tests.act_as((select b from t));
select public.respond_to_group_order((select gid from t), true, false);
select tests.act_as((select c from t));
select public.respond_to_group_order((select gid from t), true, false);

select is(
  (select count(*)::int from public.coin_ledger l
     join public.group_orders g on g.order_id = l.order_id
    where g.id = (select gid from t) and l.user_id in (select b from t union select c from t)),
  0,
  'a member who approved without offering coins funded nothing');

select is((select status from public.group_orders where id = (select gid from t)), 'placed',
  'their approval still counted — permission and funding are different things');

-- ── a group that cannot reach the cap gets what it can reach ───────────────
select tests.act_as((select b from t)); select public.leave_team();
select tests.act_as((select c from t)); select public.leave_team();

create temporary table poor (x uuid, y uuid);
insert into poor (x, y) values (
  tests.new_user(p_created_at => now() - interval '90 days'),
  tests.new_user(p_created_at => now() - interval '90 days'));
select tests.act_as((select x from poor)); select public.join_team((select code from t));
select tests.act_as((select y from poor)); select public.join_team((select code from t));

-- 500 coins each is 15 rupees of reach apiece. a is spent out from the first
-- basket, so the three of them can reach well under the 160 rupee cap.
select private.mint_coins((select x from poor), 500, 'steps', public.pkt_date(now()) - 1) \gset x_
select private.mint_coins((select y from poor), 500, 'steps', public.pkt_date(now()) - 1) \gset y_

select tests.act_as((select x from poor));
update t set gid = (public.open_group_order(
  jsonb_build_array(jsonb_build_object('product_id', (select item from t), 'qty', 1)),
  'House 3, Johar Town, Lahore', '+923005554433') ->> 'id')::uuid;
select tests.act_as((select y from poor));
select public.respond_to_group_order((select gid from t), true);
select tests.act_as((select a from t));
select public.respond_to_group_order((select gid from t), true);

update t set ord = (select order_id from public.group_orders where id = (select gid from t));
select cmp_ok((select discount_pkr from public.orders where id = (select ord from t)),
  '<', 160,
  'a group that cannot reach the cap gets what it can reach, not the cap');
select cmp_ok((select discount_pkr from public.orders where id = (select ord from t)),
  '>', 0,
  'but it does get something — three small purses still buy a saving');
select is(
  (select count(*)::int
     from public.coin_ledger l join public.coin_ledger b on b.id = l.consumes_id
    where l.order_id = (select ord from t) and b.user_id <> l.user_id),
  0,
  'and still nobody spent anybody else''s coins');

-- ── refusing, and cancelling ───────────────────────────────────────────────
-- Two statements, not one: pgTAP evaluates both arguments of is() inside a
-- single SELECT, and "what was debited" has to be read before the cancellation
-- that reverses it, not alongside.
create temporary table owed (coins integer);
insert into owed select (-sum(l.delta))::integer from public.coin_ledger l
  where l.order_id = (select ord from t) and l.reason = 'order_pending';

select is((private.set_order_status((select ord from t), 'cancelled')) ->> 'coins_returned',
  (select coins from owed)::text,
  'cancelling a group order hands every contributor their own coins back');

select is(
  (select count(*)::int
     from public.coin_ledger l
    where l.order_id = (select ord from t) and l.reason = 'order_reversal'
      and l.expires_at <> (select b.expires_at from public.coin_ledger b
                            where b.id = (select l2.consumes_id from public.coin_ledger l2
                                           where l2.order_id = l.order_id and l2.user_id = l.user_id
                                             and l2.reason = 'order_pending' limit 1))),
  0,
  'returned with their original expiry — a group order is not a way to relife coins');

-- ── the rules around the edges ─────────────────────────────────────────────
select tests.act_as((select a from t));
update t set gid = (public.open_group_order(
  jsonb_build_array(jsonb_build_object('product_id', (select item from t), 'qty', 1)),
  'House 7, Model Town, Lahore', '+923009998877') ->> 'id')::uuid;

select throws_ok(
  format('select public.open_group_order(jsonb_build_array(jsonb_build_object(''product_id'', %L, ''qty'', 1)), ''House 7, Model Town, Lahore'', ''+923009998877'')',
         (select item from t)),
  '23514', null,
  'a team may only have one basket open at a time');

select tests.act_as((select x from poor));
select throws_ok(
  format('select public.cancel_group_order(%L)', (select gid from t)),
  '42501', null,
  'only the person who opened a basket can call it off');

select tests.act_as((select a from t));
select is((public.cancel_group_order((select gid from t))) ->> 'status', 'cancelled',
  'and they can');

-- Declining ends it outright. No quorum, no majority.
update t set gid = (public.open_group_order(
  jsonb_build_array(jsonb_build_object('product_id', (select item from t), 'qty', 1)),
  'House 7, Model Town, Lahore', '+923009998877') ->> 'id')::uuid;
select tests.act_as((select x from poor));
select is((public.respond_to_group_order((select gid from t), false)) ->> 'status', 'declined',
  'one no ends the basket — every other person in the group has to agree');
select is((select order_id from public.group_orders where id = (select gid from t)), null,
  'and nothing was ordered');

-- An expired basket is not a basket.
select tests.act_as((select a from t));
update t set gid = (public.open_group_order(
  jsonb_build_array(jsonb_build_object('product_id', (select item from t), 'qty', 1)),
  'House 7, Model Town, Lahore', '+923009998877') ->> 'id')::uuid;
update public.group_orders set expires_at = now() - interval '1 minute' where id = (select gid from t);

select tests.act_as((select x from poor));
select throws_ok(
  format('select public.respond_to_group_order(%L, true)', (select gid from t)),
  '23514', null,
  'nobody can approve a basket that has expired');

select is((select private.expire_group_orders() >= 0), true,
  'and the sweep closes them out');

select * from finish();
rollback;
