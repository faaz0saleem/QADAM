-- ============================================================================
-- README §7.5 — the WhatsApp confirmation queue.
--
-- The dispatch gate is tested in 15_checkout_test.sql. This is about who gets
-- asked, and how often — which is where a well-meant automation turns into the
-- reason a new customer blocks the number.
-- ============================================================================
begin;
select plan(11);

select has_table('public', 'order_confirmations', 'the record of who was asked exists');

create temporary table t (buyer uuid, big uuid, small uuid);
insert into t (buyer) values (tests.new_user(p_created_at => now() - interval '90 days'));
-- Over the PKR 3,000 threshold, and well under it.
update t set big = tests.new_product(9000, 5000, 20);
update t set small = tests.new_product(900, 400, 20);

select tests.act_as((select buyer from t));
create temporary table o (big_order uuid, small_order uuid);
insert into o (big_order) select (public.place_order(
  jsonb_build_array(jsonb_build_object('product_id', (select big from t), 'qty', 1)),
  'House 1', '+923001234567') ->> 'order_id')::uuid;
update o set small_order = (public.place_order(
  jsonb_build_array(jsonb_build_object('product_id', (select small from t), 'qty', 1)),
  'House 1', '+923001234567') ->> 'order_id')::uuid;

-- ── only the orders the threshold actually stops ───────────────────────────
select is((select count(*)::int from private.orders_awaiting_confirmation()), 1,
  'only the order over the confirmation threshold is queued');

select is((select id from private.orders_awaiting_confirmation()), (select big_order from o),
  'and it is the PKR 9,000 one — asking about a PKR 900 order spends a paid '
  'template to prevent nothing');

select is((select item_count from private.orders_awaiting_confirmation()), 1,
  'the message has the item count it needs');
select is((select locale from private.orders_awaiting_confirmation()), 'en',
  'and the language to send it in — a confirmation nobody can read is a parcel that comes back');

-- ── not twice in an hour ───────────────────────────────────────────────────
select private.record_confirmation_attempt((select big_order from o), true, 'ok') \gset a1_
select is((select count(*)::int from private.orders_awaiting_confirmation()), 0,
  'once asked, it is not asked again within the hour');

-- Age the attempt so the queue can consider it afresh.
update public.order_confirmations set attempted_at = now() - interval '2 hours'
 where order_id = (select big_order from o);
select is((select count(*)::int from private.orders_awaiting_confirmation()), 1,
  'an hour later it comes back round');

-- ── and never more than three times ────────────────────────────────────────
insert into public.order_confirmations (order_id, attempted_at, sent)
select big_order, now() - interval '3 hours', false from o;
insert into public.order_confirmations (order_id, attempted_at, sent)
select big_order, now() - interval '4 hours', false from o;

select is((select count(*)::int from private.orders_awaiting_confirmation()), 0,
  'after three attempts it stops — a request that keeps arriving is how someone '
  'learns to block the number');

-- ── a confirmed order leaves the queue ─────────────────────────────────────
select private.set_order_status((select small_order from o), 'confirmed') \gset c_
select is((select count(*)::int from private.orders_awaiting_confirmation()
            where id = (select small_order from o)), 0,
  'a confirmed order is not asked about again');

-- ── failures are recorded, because a silent parcel is worse than a loud one ─
select private.record_confirmation_attempt((select small_order from o), false, 'whatsapp not configured') \gset f_
select is(
  (select detail from public.order_confirmations
    where order_id = (select small_order from o) order by attempted_at desc limit 1),
  'whatsapp not configured',
  'a failed attempt is recorded with its reason');

-- ── none of it is reachable from a device ──────────────────────────────────
select ok(tests.denied('authenticated', (select buyer from t),
       'select public.orders_awaiting_confirmation()'),
  'a client cannot read the confirmation queue — it carries other people''s phone numbers');

select * from finish();
rollback;
