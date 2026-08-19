-- ============================================================================
-- The service-role RPC surface, and the attestation nonces it depends on.
--
-- Everything in this file is reachable only by the Edge Functions. If any of it
-- becomes callable by a device, attestation stops meaning anything.
-- ============================================================================
begin;
select plan(19);

create temporary table t (a uuid, b uuid, n text);
insert into t (a, b) values (
  tests.new_user(p_created_at => now() - interval '30 days'),
  tests.new_user(p_created_at => now() - interval '30 days'));

-- ── nonces are single use, short lived, and belong to one user ─────────────
update t set n = private.issue_attestation_nonce(a);

select ok((select n from t) is not null and length((select n from t)) > 20,
  'a nonce is issued, and is long enough not to be guessed');

select is(private.consume_attestation_nonce((select a from t), (select n from t)), true,
  'the owner can consume their nonce once');

select is(private.consume_attestation_nonce((select a from t), (select n from t)), false,
  'and the second attempt fails — this is what stops a captured token being replayed');

update t set n = private.issue_attestation_nonce(a);
select is(private.consume_attestation_nonce((select b from t), (select n from t)), false,
  'another user cannot consume it');
select is(private.consume_attestation_nonce((select a from t), (select n from t)), true,
  'and the rightful owner still can afterwards');

select is(private.consume_attestation_nonce((select a from t), 'made-up-nonce'), false,
  'an invented nonce is refused');

-- An expired nonce is dead even though it was never used.
insert into private.attestation_nonces (nonce, user_id, expires_at)
select 'stale-nonce', a, now() - interval '1 minute' from t;
select is(private.consume_attestation_nonce((select a from t), 'stale-nonce'), false,
  'an expired nonce is refused');

-- ── the service surface is not a client surface ────────────────────────────
select ok(tests.denied('authenticated', (select a from t),
       format('select public.issue_attestation_nonce(%L)', (select a from t))),
  'a client cannot mint itself a nonce');

select ok(tests.denied('authenticated', (select a from t),
       format('select public.consume_attestation_nonce(%L, ''x'')', (select a from t))),
  'nor consume one');

select ok(tests.denied('authenticated', (select a from t),
       format('select public.credit_rewarded_ad(%L, ''free-coins'')', (select a from t))),
  'nor credit itself a rewarded video — that is AdMob''s signed callback, verified server-side');

select ok(tests.denied('authenticated', (select a from t),
       'select * from public.coins_expiring_soon(7)'),
  'nor read everyone''s expiring coins and push tokens');

select ok(tests.denied('authenticated', (select a from t),
       'select * from public.streaks_at_risk()'),
  'nor read everyone''s streak state');

select ok(tests.denied('authenticated', (select a from t),
       'select public.rebuild_leaderboards()'),
  'nor trigger a leaderboard rebuild on demand');

select ok(tests.denied('anon', null,
       'select * from public.coins_expiring_soon(7)'),
  'and none of it is reachable anonymously');

-- ── push tokens are yours alone ────────────────────────────────────────────
insert into public.push_tokens (user_id, token, platform)
select a, 'ExponentPushToken[aaaa]', 'android' from t;
insert into public.push_tokens (user_id, token, platform)
select b, 'ExponentPushToken[bbbb]', 'ios' from t;

select is(
  tests.count_as('authenticated', (select a from t), 'select token from public.push_tokens'),
  1, 'a user sees only their own push token');

select ok(tests.denied('authenticated', (select a from t),
       'insert into public.push_tokens (user_id, token, platform) '
       || 'values (gen_random_uuid(), ''x'', ''ios'')'),
  'and cannot write a token onto someone else''s account');

-- ── the wrappers really do reach the private implementations ───────────────
select is(
  (select count(*)::int from public.coins_expiring_soon(7)), 0,
  'nobody has coins expiring within a week yet');

select private.mint_coins((select a from t), 400, 'adjustment_credit') \gset mint_
insert into public.coin_ledger (user_id, delta, reason, expires_at)
select a, 250, 'adjustment_credit', now() + interval '3 days' from t;

select is(
  (select coins from public.coins_expiring_soon(7)), 250,
  'a batch lapsing in three days is picked up, and the 90-day one is not');

select is(
  (select count(*)::int from public.coins_expiring_soon(7)), 1,
  'once per batch, not once per row of the ledger');

select * from finish();
rollback;
