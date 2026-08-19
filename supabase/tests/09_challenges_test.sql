-- ============================================================================
-- README §7.6 — challenges, as the app sees them.
--
-- The rule being defended here is §13.4, and it is defended by absence: there is
-- no join, no entry, no accept, and nowhere for a stake to live. A user is in
-- their city's challenge by being in that city.
-- ============================================================================
begin;
select plan(13);

create temporary table t (lahore uuid, karachi uuid);
insert into t (lahore, karachi) values (
  tests.new_user(p_city => 'Lahore'),
  tests.new_user(p_city => 'Karachi'));

insert into public.challenges (title, scope, scope_key, starts_at, ends_at,
                               prize_type, prize_value, prize_funded_by, sponsor_name)
values
  ('Lahore week',   'city',     'Lahore', now() - interval '1 day', now() + interval '5 days',
   'coins', 5000, 'house', null),
  ('All Pakistan',  'national', '',       now() - interval '2 days', now() + interval '10 days',
   'voucher', 3000, 'sponsor', 'A Sponsor'),
  ('Finished last week', 'national', '',  now() - interval '20 days', now() - interval '13 days',
   'coins', 1000, 'house', null),
  ('Starts next month',  'national', '',  now() + interval '30 days', now() + interval '37 days',
   'coins', 1000, 'house', null);

select tests.act_as((select lahore from t));

-- ── only what is live ──────────────────────────────────────────────────────
select is((select count(*)::int from public.active_challenges()), 2,
  'only challenges that have started and not ended are listed');

select is((select count(*)::int from public.active_challenges() where title = 'Finished last week'), 0,
  'a finished challenge is gone');
select is((select count(*)::int from public.active_challenges() where title = 'Starts next month'), 0,
  'one that has not started is not listed early');

select is((select title from public.active_challenges() order by ends_at limit 1), 'Lahore week',
  'the one ending soonest comes first');

select ok((select days_left from public.active_challenges() where title = 'Lahore week') between 4 and 5,
  'days_left counts down in PKT days');

-- ── scope resolves from who is asking ──────────────────────────────────────
select is((select applies_to_me from public.active_challenges() where title = 'Lahore week'), true,
  'a Lahore user is in the Lahore challenge — by being in Lahore, not by joining');

select tests.act_as((select karachi from t));
select is((select applies_to_me from public.active_challenges() where title = 'Lahore week'), false,
  'a Karachi user is not');
select is((select applies_to_me from public.active_challenges() where title = 'All Pakistan'), true,
  'but everyone is in the national one');

-- ── §13.4, defended by absence ─────────────────────────────────────────────
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname ~* 'challenge'
      and p.proname ~* '(join|enter|entry|pay|stake|buy)'),
  0,
  'there is no function to enter, join or pay into a challenge');

select is(
  (select count(*)::int from information_schema.columns
    where table_name = 'challenges'
      and column_name ~* '(fee|stake|entry|pot|buyin)'),
  0,
  'and no column on challenges where a stake could be recorded');

select throws_ok($$
  insert into public.challenges (title, scope, starts_at, ends_at, prize_type, prize_value, prize_funded_by)
  values ('Pooled', 'city', now(), now() + interval '1 day', 'coins', 1000, 'users')
$$, '23514', null, 'a prize funded out of users is still rejected');

-- ── the client cannot write challenges ─────────────────────────────────────
select ok(tests.denied('authenticated', (select karachi from t),
       'insert into public.challenges (title, scope, starts_at, ends_at, prize_type, '
       || 'prize_value, prize_funded_by) values (''Mine'', ''city'', now(), '
       || 'now() + interval ''1 day'', ''coins'', 999999, ''house'')'),
  'a client cannot create a challenge with its own prize');

select ok(tests.denied('anon', null, 'select * from public.active_challenges()'),
  'and an anonymous caller cannot list them');

select * from finish();
rollback;
