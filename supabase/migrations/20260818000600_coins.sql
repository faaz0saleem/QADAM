-- 20260818000600_coins.sql
-- §5, §7.2: the coin ledger. Append-only. There is no balance column and there
-- never will be — a drifting balance in a system where coins have value is an
-- exploit waiting to happen.
--
-- EXPIRY MODEL. §5 defines balance as SUM(delta) WHERE expires_at > now(). For
-- that to stay true once coins are spent, every row — credit and debit alike —
-- carries the expiry of the batch it belongs to. A credit opens a batch. A debit
-- is allocated FIFO across live batches, earliest-expiring first, and is split
-- into one row per batch it draws from. Consequences:
--   * balance                = SUM(delta) WHERE expires_at > now()
--   * remaining in a batch   = SUM(delta) GROUP BY expires_at
--   * §7.2's "2,400 coins expiring in 11 days" is a straight GROUP BY, and
--     coins already spent correctly stop counting toward it
--   * expired coins simply fall out of the balance; no sweep job is needed for
--     correctness, and the history stays intact and auditable

create table coin_ledger (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete restrict,
  delta      integer not null check (delta <> 0),
  reason     text not null check (reason in (
               -- credits
               'steps','streak_bonus','rewarded_ad','referral_referrer',
               'referral_referee','challenge_prize','order_refund','admin_credit',
               -- debits
               'order_hold','admin_debit')),
  expires_at timestamptz not null,
  order_id   uuid references orders(id) on delete restrict,
  created_at timestamptz not null default now(),

  constraint delta_sign_matches_reason check (
    (reason in ('steps','streak_bonus','rewarded_ad','referral_referrer',
                'referral_referee','challenge_prize','order_refund','admin_credit')
     and delta > 0)
    or
    (reason in ('order_hold','admin_debit') and delta < 0)
  ),

  -- Order-linked reasons carry their order; nothing else may claim one.
  constraint order_reason_has_order check (
    (reason in ('order_hold','order_refund')) = (order_id is not null)
  )
);

create index coin_ledger_balance_idx on coin_ledger (user_id, expires_at);
create index coin_ledger_history_idx on coin_ledger (user_id, created_at desc);
create index coin_ledger_order_idx   on coin_ledger (order_id) where order_id is not null;

comment on table coin_ledger is
  '§5: append-only. Balance is SUM(delta) WHERE expires_at > now(). '
  'Never add a balance column. Never UPDATE or DELETE a row — the triggers below '
  'will refuse, including on behalf of a cascading delete.';

-- ---------------------------------------------------------------------------
-- Append-only, enforced by the database rather than by convention.
-- ---------------------------------------------------------------------------
create or replace function coin_ledger_append_only() returns trigger
language plpgsql as $$
begin
  raise exception
    'coin_ledger is append-only: % refused (§5). Write a compensating row instead.',
    tg_op
    using errcode = 'restrict_violation';
end
$$;

create trigger coin_ledger_no_update
  before update on coin_ledger
  for each row execute function coin_ledger_append_only();

create trigger coin_ledger_no_delete
  before delete on coin_ledger
  for each row execute function coin_ledger_append_only();

-- ---------------------------------------------------------------------------
-- No user, and no single expiry batch, may ever go negative.
-- ---------------------------------------------------------------------------
create or replace function coin_ledger_no_overdraft() returns trigger
language plpgsql as $$
declare
  v_batch int;
  v_total int;
begin
  select coalesce(sum(delta), 0)::int into v_batch
  from coin_ledger
  where user_id = new.user_id and expires_at = new.expires_at;

  if v_batch < 0 then
    raise exception
      'coin batch expiring % for user % would go negative (%)',
      new.expires_at, new.user_id, v_batch
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(delta), 0)::int into v_total
  from coin_ledger
  where user_id = new.user_id and expires_at > now();

  if v_total < 0 then
    raise exception
      'coin balance for user % would go negative (%)', new.user_id, v_total
      using errcode = 'check_violation';
  end if;

  return null;
end
$$;

create trigger coin_ledger_overdraft_guard
  after insert on coin_ledger
  for each row execute function coin_ledger_no_overdraft();

-- ---------------------------------------------------------------------------
-- Reading the ledger
-- ---------------------------------------------------------------------------
create or replace function coin_balance(p_user uuid) returns integer
language sql stable as $$
  select coalesce(sum(delta), 0)::int
  from coin_ledger
  where user_id = p_user and expires_at > now();
$$;

comment on function coin_balance(uuid) is
  '§5: the only correct way to read a balance. Cache it if performance demands, '
  'but the ledger is truth.';

-- §7.2: "2,400 coins expiring in 11 days" as a dated, visible thing.
create view coin_batches with (security_invoker = true) as
select
  user_id,
  expires_at,
  sum(delta)::int                                                as remaining,
  greatest(0, extract(day from expires_at - now()))::int          as days_left
from coin_ledger
where expires_at > now()
group by user_id, expires_at
having sum(delta) > 0;

-- ---------------------------------------------------------------------------
-- Writing the ledger. Application code calls these; it never INSERTs directly.
-- ---------------------------------------------------------------------------
create or replace function credit_coins(
  p_user        uuid,
  p_coins       int,
  p_reason      text,
  p_order       uuid default null,
  p_expiry_days int  default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_days int := coalesce(p_expiry_days, config_int('COIN_EXPIRY_DAYS'));
  v_id   uuid;
begin
  if p_coins <= 0 then
    raise exception 'credit_coins: coins must be positive, got %', p_coins
      using errcode = 'check_violation';
  end if;

  insert into coin_ledger (user_id, delta, reason, expires_at, order_id)
  values (p_user, p_coins, p_reason,
          date_trunc('day', now()) + make_interval(days => v_days), p_order)
  returning id into v_id;

  return v_id;
end
$$;

-- FIFO across expiry batches: always spend the coins that die soonest.
create or replace function spend_coins(
  p_user   uuid,
  p_coins  int,
  p_reason text,
  p_order  uuid
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_left    int := p_coins;
  v_take    int;
  v_created timestamptz;
  b         record;
begin
  if p_coins <= 0 then
    raise exception 'spend_coins: coins must be positive, got %', p_coins
      using errcode = 'check_violation';
  end if;

  -- Serialise all coin movement for this user. Without this, two concurrent
  -- spends could each see the same balance and both succeed.
  select created_at into v_created from users where id = p_user for update;
  if not found then
    raise exception 'spend_coins: no such user %', p_user using errcode = 'no_data_found';
  end if;

  -- §6.1 new-account velocity: no redemption in an account's first N days.
  if v_created > now() - make_interval(days => config_int('REDEMPTION_LOCK_DAYS')) then
    insert into fraud_events (user_id, kind, detail)
    values (p_user, 'redemption_lock',
            jsonb_build_object('coins', p_coins, 'account_created_at', v_created));
    raise exception
      'coins cannot be redeemed in the first % days of an account (§6.1)',
      config_int('REDEMPTION_LOCK_DAYS')
      using errcode = 'check_violation';
  end if;

  for b in
    select expires_at, sum(delta)::int as remaining
    from coin_ledger
    where user_id = p_user and expires_at > now()
    group by expires_at
    having sum(delta) > 0
    order by expires_at asc
  loop
    exit when v_left = 0;
    v_take := least(v_left, b.remaining);
    insert into coin_ledger (user_id, delta, reason, expires_at, order_id)
    values (p_user, -v_take, p_reason, b.expires_at, p_order);
    v_left := v_left - v_take;
  end loop;

  if v_left > 0 then
    raise exception
      'insufficient coins: % requested, short by %', p_coins, v_left
      using errcode = 'check_violation';
  end if;

  return p_coins;
end
$$;

-- Undo a hold that was never consumed — cancellation before dispatch, or a
-- stock-out on our side. NOT for a refused delivery: §7.5 burns those coins,
-- and the burn is simply never calling this.
create or replace function refund_order_coins(p_order uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid;
  v_held  int;
  b       record;
begin
  select user_id into v_user from orders where id = p_order;
  if v_user is null then
    raise exception 'refund_order_coins: no such order %', p_order
      using errcode = 'no_data_found';
  end if;

  perform 1 from users where id = v_user for update;

  select coalesce(-sum(delta), 0)::int into v_held
  from coin_ledger where order_id = p_order and reason = 'order_hold';

  if coalesce((select sum(delta) from coin_ledger
               where order_id = p_order and reason = 'order_refund'), 0) > 0 then
    raise exception 'order % has already been refunded', p_order
      using errcode = 'check_violation';
  end if;

  if v_held = 0 then
    return 0;
  end if;

  -- Restore each batch to its own expiry so a refund never extends a coin's life.
  for b in
    select expires_at, -sum(delta)::int as coins
    from coin_ledger
    where order_id = p_order and reason = 'order_hold'
    group by expires_at
  loop
    if b.expires_at > now() then
      insert into coin_ledger (user_id, delta, reason, expires_at, order_id)
      values (v_user, b.coins, 'order_refund', b.expires_at, p_order);
    end if;
  end loop;

  return v_held;
end
$$;
