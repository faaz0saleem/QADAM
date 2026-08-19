-- README §5 — the coin ledger.
--
-- Append-only, and there is no balance column anywhere in this database. A balance
-- column will drift, and a drifting balance in a system where coins have value is an
-- exploit waiting to happen. Balance is derived, always.
--
-- HOW EXPIRY WORKS, because it is the one subtle thing here.
--
-- Credits are minted in batches, each with its own expires_at. Every debit names the
-- batch it draws from (consumes_id) and there is one debit row per batch touched, so
-- a 500-coin spend that straddles three batches is three rows. A row counts toward
-- the balance only while ITS BATCH is unexpired.
--
-- That is what makes plain arithmetic correct. The naive reading — sum every delta,
-- ignore expiry on the debits — double-subtracts a spend once its batch expires and
-- walks users into negative balances. The naive fix — a cron that writes compensating
-- expiry rows — leaves the balance wrong in the window before the cron runs. Pinning
-- each debit to a batch makes expiry exact and instantaneous, with no cron in the
-- correctness path at all.

create table public.coin_ledger (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  delta       integer not null check (delta <> 0),
  reason      text not null,
  expires_at  timestamptz,                                    -- credits only
  consumes_id uuid references public.coin_ledger(id),          -- debits only
  order_id    uuid references public.orders(id) on delete restrict,
  step_date   date,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),

  -- A credit is a dated batch. A debit is a draw against one named batch.
  constraint credit_is_a_dated_batch
    check ((delta > 0) = (expires_at is not null)),
  constraint debit_names_its_batch
    check ((delta < 0) = (consumes_id is not null)),

  -- The sign and the reason must agree, so a mislabelled row cannot hide in reporting.
  constraint reason_matches_sign check (
    (delta > 0 and reason in ('steps','rewarded_ad','referral_referrer','referral_referee',
                              'challenge_prize','order_reversal','adjustment_credit'))
    or
    (delta < 0 and reason in ('order_pending','adjustment_debit'))
  ),

  constraint steps_credit_has_a_date
    check (reason <> 'steps' or step_date is not null),
  constraint order_rows_name_their_order
    check (reason not in ('order_pending','order_reversal') or order_id is not null)
);

comment on table public.coin_ledger is
  'README §5. APPEND-ONLY — UPDATE and DELETE are blocked by trigger. There is no '
  'balance column in this schema and there must never be one; balance is SUM(delta) '
  'over rows whose batch has not expired.';
comment on column public.coin_ledger.consumes_id is
  'The credit batch this debit draws from. One debit row per batch touched, FIFO by '
  'soonest expiry, so the coins a user is about to lose are the ones they spend first.';

create index coin_ledger_user_idx     on public.coin_ledger (user_id, created_at desc);
create index coin_ledger_consumes_idx on public.coin_ledger (consumes_id) where consumes_id is not null;
create index coin_ledger_batches_idx  on public.coin_ledger (user_id, expires_at) where delta > 0;
create index coin_ledger_order_idx    on public.coin_ledger (order_id) where order_id is not null;

-- Steps are minted incrementally through the day, one row per top-up, because the
-- ledger is append-only and a running total cannot be edited into an existing row.
-- daily_steps.coins_awarded holds the day's cumulative figure; these rows are the
-- increments that produced it.
create index coin_ledger_step_date_idx
  on public.coin_ledger (user_id, step_date) where step_date is not null;

-- ---------------------------------------------------------------------------
-- Append-only, enforced. Not a convention, not a code review rule.
-- ---------------------------------------------------------------------------
create or replace function private.coin_ledger_is_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'coin_ledger is append-only (README §5): % is not permitted. Correct a mistake by '
    'appending an adjustment row, never by rewriting history.', tg_op
    using errcode = 'restrict_violation';
end $$;

create trigger coin_ledger_no_update
  before update on public.coin_ledger
  for each row execute function private.coin_ledger_is_append_only();

create trigger coin_ledger_no_delete
  before delete on public.coin_ledger
  for each row execute function private.coin_ledger_is_append_only();

-- ---------------------------------------------------------------------------
-- A batch can never be overdrawn, and an expired batch can never be drawn on.
--
-- The row lock serialises concurrent debits against the same batch: two parallel
-- checkouts cannot both read "60 remaining" and both spend it.
-- ---------------------------------------------------------------------------
create or replace function private.coin_debit_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  b         record;
  v_drawn   integer;
  v_left    integer;
begin
  if new.delta > 0 then return new; end if;

  select * into b from public.coin_ledger where id = new.consumes_id for update;
  if not found then
    raise exception 'debit names a batch that does not exist' using errcode = 'foreign_key_violation';
  end if;
  if b.delta <= 0 then
    raise exception 'a debit can only draw on a credit batch' using errcode = 'check_violation';
  end if;
  if b.user_id <> new.user_id then
    raise exception 'a debit cannot draw on another user''s batch — coins never move between users (README §13.3)'
      using errcode = 'check_violation';
  end if;
  if b.expires_at <= now() then
    raise exception 'batch % expired at %; expired coins cannot be spent', b.id, b.expires_at
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(delta), 0) into v_drawn
    from public.coin_ledger where consumes_id = b.id;

  v_left := b.delta + v_drawn;
  if (v_left + new.delta) < 0 then
    raise exception 'batch % has % coins left; cannot draw %', b.id, v_left, -new.delta
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger coin_ledger_debit_guard
  before insert on public.coin_ledger
  for each row execute function private.coin_debit_guard();

-- ---------------------------------------------------------------------------
-- Reading the ledger
-- ---------------------------------------------------------------------------

-- Every row, tagged with the expiry of the batch it belongs to. Debits inherit
-- their batch's expiry; credits are their own batch.
create view private.coin_ledger_dated as
select l.*,
       coalesce(b.expires_at, l.expires_at) as batch_expires_at,
       coalesce(l.consumes_id, l.id)        as batch_id
  from public.coin_ledger l
  left join public.coin_ledger b on b.id = l.consumes_id;

create or replace function public.coin_balance(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select coalesce(sum(delta), 0)::integer
    from private.coin_ledger_dated
   where user_id = p_user_id
     and batch_expires_at > now()
$$;

comment on function public.coin_balance(uuid) is
  'README §5: balance is SUM(delta) over unexpired batches, never a stored column.';

-- §7.2 — the wallet, grouped by expiry batch, so "2,400 coins expiring in 11 days"
-- is a visible dated thing and not a surprise.
create or replace function public.coin_batches(p_user_id uuid)
returns table (
  batch_id      uuid,
  minted_at     timestamptz,
  reason        text,
  minted        integer,
  remaining     integer,
  expires_at    timestamptz,
  days_left     integer
)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select b.id,
         b.created_at,
         b.reason,
         b.delta,
         (b.delta + coalesce((select sum(d.delta) from public.coin_ledger d
                               where d.consumes_id = b.id), 0))::integer,
         b.expires_at,
         greatest(0, (public.pkt_date(b.expires_at) - public.pkt_date(now())))::integer
    from public.coin_ledger b
   where b.user_id = p_user_id
     and b.delta > 0
     and b.expires_at > now()
     and (b.delta + coalesce((select sum(d.delta) from public.coin_ledger d
                               where d.consumes_id = b.id), 0)) > 0
   order by b.expires_at
$$;

create or replace function public.coins_expiring_within(p_user_id uuid, p_days integer)
returns integer
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select coalesce(sum(remaining), 0)::integer
    from public.coin_batches(p_user_id)
   where expires_at <= now() + (p_days || ' days')::interval
$$;

comment on function public.coins_expiring_within(uuid, integer) is
  'Drives the single best reactivation lever we have (§4): the user about to lose their '
  'coins is exactly the user who finally has enough to want to spend them.';

-- ---------------------------------------------------------------------------
-- Writing the ledger. Server-side only — nothing here is callable by a client,
-- and none of it accepts a coin amount that originated on a device (§13.2).
-- ---------------------------------------------------------------------------
create or replace function private.mint_coins(
  p_user_id   uuid,
  p_coins     integer,
  p_reason    text,
  p_step_date date default null,
  p_meta      jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare v_id uuid;
begin
  if p_coins <= 0 then
    raise exception 'mint_coins requires a positive amount, got %', p_coins
      using errcode = 'check_violation';
  end if;

  insert into public.coin_ledger (user_id, delta, reason, expires_at, step_date, meta)
  values (p_user_id, p_coins, p_reason,
          now() + (private.cfg_int('COIN_EXPIRY_DAYS') || ' days')::interval,
          p_step_date, p_meta)
  returning id into v_id;

  return v_id;
end $$;

-- FIFO by soonest expiry: the coins a user is closest to losing are the ones they
-- spend first. Returns the rows written so the caller can report the burn.
create or replace function private.spend_coins(
  p_user_id  uuid,
  p_coins    integer,
  p_reason   text,
  p_order_id uuid default null
) returns integer
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  b          record;
  v_left     integer := p_coins;
  v_take     integer;
  v_rows     integer := 0;
begin
  if p_coins <= 0 then
    raise exception 'spend_coins requires a positive amount, got %', p_coins
      using errcode = 'check_violation';
  end if;

  if not public.can_redeem(p_user_id) then
    raise exception 'user % cannot redeem yet (§6.1: no redemption in an account''s first % days)',
      p_user_id, private.cfg_int('REDEMPTION_HOLD_DAYS')
      using errcode = 'check_violation';
  end if;

  for b in
    select id, delta,
           delta + coalesce((select sum(d.delta) from public.coin_ledger d
                              where d.consumes_id = public.coin_ledger.id), 0) as remaining
      from public.coin_ledger
     where user_id = p_user_id and delta > 0 and expires_at > now()
     order by expires_at, created_at
     for update
  loop
    exit when v_left <= 0;
    continue when b.remaining <= 0;

    v_take := least(v_left, b.remaining);
    insert into public.coin_ledger (user_id, delta, reason, consumes_id, order_id)
    values (p_user_id, -v_take, p_reason, b.id, p_order_id);

    v_left := v_left - v_take;
    v_rows := v_rows + 1;
  end loop;

  if v_left > 0 then
    raise exception 'insufficient coins: % short of %', v_left, p_coins
      using errcode = 'check_violation';
  end if;

  return v_rows;
end $$;

comment on function private.spend_coins(uuid, integer, text, uuid) is
  'Debits FIFO by soonest expiry. Callers pass a coin count the SERVER computed — never '
  'a number that arrived from a device (README §13.2).';
