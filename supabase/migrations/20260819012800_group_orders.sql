-- ===========================================================================
-- Group orders — one basket, five people, everybody says yes.
--
-- WHAT WAS ASKED FOR, AND WHAT THIS IS
--
-- The request was "people can join teams and their credits can be pooled and
-- then they can buy things with the permission of every other person in the
-- group". Pooling credits, read literally, is coin transfer, and §13.3 is not
-- negotiable:
--
--     "Never add coin transfer, coin gifting, or cash-out. Ever."
--
-- It is also enforced structurally a layer below this file:
-- private.coin_debit_guard() raises if a debit draws on a batch belonging to
-- someone else, so a balance cannot move between two users even if a future
-- function tried. Nothing here weakens that, and nothing here could.
--
-- So this is the co-payment shape instead, which delivers the thing that was
-- actually wanted:
--
--   * One shared basket, opened by one member of a team.
--   * Every other member of that team must approve it. Unanimous, no quorum.
--   * On the last approval the order is placed, and each approving member's
--     coins are debited FROM THEIR OWN LEDGER, against their own batches,
--     for their own share of the discount.
--
-- No balance is ever added to. No coin changes owner. Every debit is a debit on
-- the person who earned it, at the same server-set discount value it would have
-- had if they had spent it alone. What is shared is the basket, not the wallet —
-- which is how five people chipping in for one thing has always worked.
--
-- §13.2 IS WHY THE SIGNATURES LOOK LIKE THIS
--
-- respond_to_group_order takes two booleans: do you approve, and are you willing
-- to spend coins. It does not take a coin count, a pledge, or a share. The
-- server decides how much each member contributes, from balances the client
-- cannot read, at a rate the client cannot read. A "pledge" field would be a
-- client naming a coin amount, which §13.2 calls a P0 bug, and it would be one.
--
-- §0 IS UNTOUCHED
--
-- The discount on this order is capped by private.line_discount_cap() exactly as
-- a solo order's is, and the order_items CHECK is still the backstop. Five people
-- funding one basket does not buy a bigger discount than one person funding it —
-- it buys the same discount, which more of them can afford to reach.
-- ===========================================================================

insert into private.app_config (key, value, unit, description) values
  ('GROUP_ORDER_EXPIRY_HOURS',      48, 'hours',
   'A group order that has not collected every approval in this long expires. Stock is not held.'),
  ('GROUP_ORDER_MAX_OPEN_PER_TEAM',  1, 'count',
   'Open group orders a team may have at once. One basket at a time keeps approvals meaningful.'),
  ('GROUP_ORDER_MAX_PER_USER_WEEK',  2, 'count',
   'Group orders one person may fund per PKT week. The farm-account ceiling: four helpers, twice a week, is not a business.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Tables
--
-- None of these are readable by a client role. There are no grants below and
-- there is no SELECT policy: everything a device sees comes back from a
-- security definer RPC that has already decided what this caller may know.
-- That is deliberate — a group order carries a teammate's delivery address.
-- ---------------------------------------------------------------------------
create table public.group_orders (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references public.teams(id) on delete cascade,
  opened_by      uuid not null references public.users(id) on delete restrict,
  status         text not null default 'open'
                   check (status in ('open','placed','declined','cancelled','expired')),
  address        text not null,
  phone          text not null,
  payment_method text not null check (payment_method in ('cod','card','wallet')),
  order_id       uuid references public.orders(id),
  expires_at     timestamptz not null,
  placed_at      timestamptz,
  closed_at      timestamptz,
  created_at     timestamptz not null default now(),

  constraint placed_orders_have_an_order
    check ((status = 'placed') = (order_id is not null))
);

comment on table public.group_orders is
  'A basket a team buys together. Every member approves; each one then spends their '
  'OWN coins on it. No coin moves between users — see the header of this migration '
  'and README §13.3.';
comment on column public.group_orders.address is
  'The opener''s delivery address. Returned only to the opener: the other four are '
  'approving a purchase, which does not require knowing someone''s street.';

create index group_orders_team_idx on public.group_orders (team_id, status);

create table public.group_order_items (
  id             uuid primary key default gen_random_uuid(),
  group_order_id uuid not null references public.group_orders(id) on delete cascade,
  product_id     uuid not null references public.products(id) on delete restrict,
  qty            integer not null check (qty between 1 and 10),

  unique (group_order_id, product_id)
);

create index group_order_items_parent_idx on public.group_order_items (group_order_id);

comment on table public.group_order_items is
  'Product ids and quantities. No price and no cost: those are read from products '
  'at placement, never carried on the draft, so a basket that sat open for a day '
  'cannot lock in yesterday''s margin.';

create table public.group_order_approvals (
  group_order_id uuid not null references public.group_orders(id) on delete cascade,
  user_id        uuid not null references public.users(id) on delete cascade,
  decision       text not null check (decision in ('approved','declined')),
  spend_coins    boolean not null default true,
  coins_spent    integer not null default 0 check (coins_spent >= 0),
  decided_at     timestamptz not null default now(),

  primary key (group_order_id, user_id)
);

comment on column public.group_order_approvals.spend_coins is
  'Whether this member is willing to put their own coins toward the basket. A '
  'boolean, not an amount: §13.2 — the client never names a coin figure.';
comment on column public.group_order_approvals.coins_spent is
  'Filled in by the server at placement, from what it actually debited. Never '
  'written by a client, and meaningless before status = placed.';

alter table public.group_orders          enable row level security;
alter table public.group_order_items     enable row level security;
alter table public.group_order_approvals enable row level security;

-- ---------------------------------------------------------------------------
-- Who is in the conversation
-- ---------------------------------------------------------------------------
create or replace function private.group_order_members(p_gid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select tm.user_id
    from public.group_orders g
    join public.team_members tm on tm.team_id = g.team_id
   where g.id = p_gid
$$;

-- ---------------------------------------------------------------------------
-- What each member could put in, in rupees.
--
-- This is the only place a group order looks at anyone's balance, it is private,
-- and it returns rupees rather than coins so that nothing downstream is tempted
-- to publish a rate (§4).
--
-- A member who has declined, who asked not to spend coins, or who is still
-- inside the §6.1 redemption hold contributes zero. They are not blocked from
-- approving — approving is permission, funding is separate.
-- ---------------------------------------------------------------------------
create or replace function private.group_order_funding(p_gid uuid)
returns table (user_id uuid, affordable_pkr integer)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select a.user_id,
         case when a.decision = 'approved'
               and a.spend_coins
               and public.can_redeem(a.user_id)
              then floor(public.coin_balance(a.user_id) * private.cfg('COIN_VALUE_PKR'))::integer
              else 0
         end
    from public.group_order_approvals a
   where a.group_order_id = p_gid
$$;

-- The §0 cap for this basket, from the live products table.
create or replace function private.group_order_cap(p_gid uuid)
returns integer
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select coalesce(sum(private.line_discount_cap(i.product_id, i.qty)), 0)::integer
    from public.group_order_items i
   where i.group_order_id = p_gid
$$;

create or replace function private.group_order_subtotal(p_gid uuid)
returns integer
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select coalesce(sum(i.qty * p.price_pkr), 0)::integer
    from public.group_order_items i
    join public.products p on p.id = i.product_id
   where i.group_order_id = p_gid
$$;

-- What the group can actually knock off, right now: the §0 cap or their combined
-- reach, whichever is smaller. One aggregate number — never a per-person figure,
-- which would publish four teammates' balances to each other.
create or replace function private.group_order_discount(p_gid uuid)
returns integer
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select case
           when private.group_order_subtotal(p_gid) < private.cfg_int('MIN_ORDER_FOR_COINS_PKR')
             then 0
           else least(
                  private.group_order_cap(p_gid),
                  coalesce((select sum(affordable_pkr) from private.group_order_funding(p_gid)), 0)::integer)
         end
$$;

-- ---------------------------------------------------------------------------
-- Opening one
-- ---------------------------------------------------------------------------
create or replace function public.open_group_order(
  p_items          jsonb,
  p_address        text,
  p_phone          text,
  p_payment_method text default 'cod'
) returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_me      uuid := auth.uid();
  v_team    uuid;
  v_gid     uuid;
  v_item    jsonb;
  v_qty     integer;
  v_product record;
  v_open    integer;
  v_count   integer;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  select team_id into v_team from public.team_members where user_id = v_me;
  if v_team is null then
    raise exception 'you are not in a team' using errcode = 'no_data_found';
  end if;

  select count(*) into v_count from public.team_members where team_id = v_team;
  if v_count < 2 then
    raise exception 'a group order needs someone to approve it — invite your team first'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_open
    from public.group_orders
   where team_id = v_team and status = 'open' and expires_at > now();
  if v_open >= private.cfg_int('GROUP_ORDER_MAX_OPEN_PER_TEAM') then
    raise exception 'your team already has a basket waiting for approvals'
      using errcode = 'check_violation';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'no items' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_items) > 40 then
    raise exception 'too many items in one order' using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(p_address, ''))) < 10 then
    raise exception 'a delivery address is required' using errcode = 'check_violation';
  end if;

  insert into public.group_orders (team_id, opened_by, address, phone, payment_method, expires_at)
  values (v_team, v_me, btrim(p_address), btrim(p_phone), p_payment_method,
          now() + (private.cfg_int('GROUP_ORDER_EXPIRY_HOURS') || ' hours')::interval)
  returning id into v_gid;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(1, coalesce((v_item ->> 'qty')::integer, 1));
    if v_qty > 10 then
      raise exception 'at most 10 of one item per order' using errcode = 'check_violation';
    end if;

    -- No row lock and no stock decrement here. A draft holds nothing: stock is
    -- taken at placement, and a basket whose last item sold out while the team
    -- was deciding fails then, loudly, rather than quietly reserving inventory
    -- for two days on the strength of one person's intention.
    select * into v_product from public.products where id = (v_item ->> 'product_id')::uuid and is_active;
    if not found then
      raise exception 'product % is not available', v_item ->> 'product_id'
        using errcode = 'check_violation';
    end if;

    insert into public.group_order_items (group_order_id, product_id, qty)
    values (v_gid, v_product.id, v_qty)
    on conflict (group_order_id, product_id)
      do update set qty = least(10, public.group_order_items.qty + excluded.qty);
  end loop;

  -- Opening it is approving it. Nobody has to approve their own basket twice.
  insert into public.group_order_approvals (group_order_id, user_id, decision, spend_coins)
  values (v_gid, v_me, 'approved', true);

  return public.group_order(v_gid);
end $$;

-- ---------------------------------------------------------------------------
-- Reading one
--
-- The shape of what comes back is the privacy policy. Four teammates see the
-- basket, the people, and one aggregate saving. They do not see each other's
-- balances, they do not see a coin-to-rupee rate (§4), and they do not see the
-- opener's street unless they are the opener.
-- ---------------------------------------------------------------------------
create or replace function public.group_order(p_gid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_me       uuid := auth.uid();
  v_g        record;
  v_subtotal integer;
  v_discount integer;
begin
  select * into v_g from public.group_orders where id = p_gid;
  if not found then
    raise exception 'no such group order' using errcode = 'no_data_found';
  end if;
  if v_me is null or v_me not in (select private.group_order_members(p_gid)) then
    raise exception 'no such group order' using errcode = 'no_data_found';
  end if;

  v_subtotal := private.group_order_subtotal(p_gid);
  v_discount := case when v_g.status = 'open' then private.group_order_discount(p_gid) else 0 end;

  return jsonb_build_object(
    'id',            v_g.id,
    'status',        case when v_g.status = 'open' and v_g.expires_at <= now()
                          then 'expired' else v_g.status end,
    'opened_by',     v_g.opened_by,
    'opened_by_name',(select name from public.users where id = v_g.opened_by),
    'i_opened_it',   v_g.opened_by = v_me,
    'expires_at',    v_g.expires_at,
    'order_id',      v_g.order_id,
    -- The address goes to the person whose address it is, and to nobody else.
    'address',       case when v_g.opened_by = v_me then v_g.address else null end,
    'subtotal_pkr',  v_subtotal,
    -- The ceiling §0 puts on this basket. Public in the same sense the per-card
    -- saving on the store feed is public: it is a property of the products, not
    -- of anybody's wallet.
    'max_discount_pkr', private.group_order_cap(p_gid),
    -- What the approvals collected SO FAR can fund. It climbs as people say yes,
    -- which does tell a teammate roughly what another teammate could reach —
    -- accepted, because a team of five already sees each other's step counts on
    -- the team board every day, and coins are minted from steps. What is never
    -- returned is a per-person figure or a rate (§4); this is one aggregate.
    'discount_pkr',  case when v_g.status = 'placed'
                          then (select o.discount_pkr from public.orders o where o.id = v_g.order_id)
                          else v_discount end,
    'total_pkr',     case when v_g.status = 'placed'
                          then (select o.total_pkr from public.orders o where o.id = v_g.order_id)
                          else v_subtotal - v_discount end,
    'my_coins_spent',(select coalesce(a.coins_spent, 0)
                        from public.group_order_approvals a
                       where a.group_order_id = p_gid and a.user_id = v_me),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_id', p.id, 'title', p.title, 'qty', i.qty,
               'price_pkr', p.price_pkr, 'line_pkr', i.qty * p.price_pkr,
               'in_stock', p.stock >= i.qty, 'images', p.images)
             order by p.title)
        from public.group_order_items i
        join public.products p on p.id = i.product_id
       where i.group_order_id = p_gid), '[]'::jsonb),
    -- Everyone on the team, decided or not, so the UI can show who it is waiting on.
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id',  u.id,
               'name',     u.name,
               'is_me',    u.id = v_me,
               'decision', coalesce(a.decision, 'waiting'),
               'spending', coalesce(a.spend_coins, false),
               'coins_spent', case when u.id = v_me then coalesce(a.coins_spent, 0) else null end)
             order by u.name nulls last, u.id)
        from public.team_members tm
        join public.users u on u.id = tm.user_id
        left join public.group_order_approvals a
               on a.group_order_id = p_gid and a.user_id = u.id
       where tm.team_id = v_g.team_id), '[]'::jsonb),
    'waiting_on', (
      select count(*)::integer
        from public.team_members tm
        left join public.group_order_approvals a
               on a.group_order_id = p_gid and a.user_id = tm.user_id
       where tm.team_id = v_g.team_id and a.decision is null));
end $$;

comment on function public.group_order(uuid) is
  'One group order, as the caller is allowed to see it. Returns an aggregate rupee '
  'saving and never a per-member balance or a coin-to-rupee rate (§4).';

create or replace function public.my_group_orders()
returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select coalesce(jsonb_agg(public.group_order(g.id) order by g.created_at desc), '[]'::jsonb)
    from public.group_orders g
    join public.team_members tm on tm.team_id = g.team_id and tm.user_id = auth.uid()
   where g.created_at > now() - interval '30 days'
$$;

-- ---------------------------------------------------------------------------
-- Placing it
--
-- Deliberately a near-copy of public.place_order rather than a wrapper around
-- it. place_order debits one person; this one debits up to five, each from their
-- own batches. Sharing the body would mean giving place_order a "who pays" list,
-- which is one refactor away from being a "whose coins" parameter — and that is
-- exactly the shape §13.3 exists to keep out of this codebase.
--
-- What is NOT copied is the §0 cap: private.line_discount_cap() is the same
-- function, and public.order_items' CHECK is the same CHECK. There is one margin
-- rule and this path is under it.
-- ---------------------------------------------------------------------------
create or replace function private.place_group_order(p_gid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_g         record;
  v_opener    record;
  v_order_id  uuid;
  v_row       record;
  v_product   record;
  v_subtotal  integer := 0;
  v_total_cap integer := 0;
  v_discount  integer := 0;
  v_rate      numeric;
  v_refusals  integer;
  v_risk      integer;
  v_line      record;
  v_remaining integer;
  v_take      integer;

  v_uids      uuid[]  := '{}';
  v_afford    integer[] := '{}';
  v_give      integer[] := '{}';
  v_coins     integer[] := '{}';
  v_active    integer;
  v_share     integer;
  v_progress  boolean;
  i           integer;
  v_week      integer;
begin
  select * into v_g from public.group_orders where id = p_gid for update;
  if not found or v_g.status <> 'open' then
    raise exception 'this basket is no longer open' using errcode = 'check_violation';
  end if;
  if v_g.expires_at <= now() then
    raise exception 'this basket has expired' using errcode = 'check_violation';
  end if;

  -- Unanimity is checked here and not only by the caller: the roster can change
  -- while a basket is open, and a member who joined after four approvals landed
  -- has not approved anything.
  if exists (
    select 1 from public.team_members tm
     where tm.team_id = v_g.team_id
       and not exists (select 1 from public.group_order_approvals a
                        where a.group_order_id = p_gid and a.user_id = tm.user_id
                          and a.decision = 'approved'))
  then
    raise exception 'not everyone has approved this basket' using errcode = 'check_violation';
  end if;

  select * into v_opener from public.users where id = v_g.opened_by;
  if v_opener.status <> 'active' then
    raise exception 'this account cannot place orders' using errcode = 'check_violation';
  end if;

  select count(*) into v_refusals
    from public.orders where user_id = v_g.opened_by and status in ('refused','returned');
  v_risk := least(100, v_refusals * 25);

  if v_g.payment_method = 'cod' and v_risk >= private.cfg_int('COD_RISK_BLOCK_SCORE') then
    raise exception 'cash on delivery is not available on this account'
      using errcode = 'check_violation';
  end if;

  insert into public.orders (user_id, status, payment_method, address, phone, cod_risk_score)
  values (v_g.opened_by, 'pending_confirmation', v_g.payment_method,
          v_g.address, v_g.phone, v_risk)
  returning id into v_order_id;

  for v_row in select product_id, qty from public.group_order_items where group_order_id = p_gid
  loop
    select * into v_product from public.products
     where id = v_row.product_id and is_active
     for update;

    if not found then
      raise exception 'product % is not available', v_row.product_id
        using errcode = 'check_violation';
    end if;
    if v_product.stock < v_row.qty then
      raise exception 'only % of % left', v_product.stock, v_product.title
        using errcode = 'check_violation';
    end if;

    update public.products set stock = stock - v_row.qty where id = v_product.id;

    insert into public.order_items (order_id, product_id, qty, price_pkr, cost_pkr, discount_pkr)
    values (v_order_id, v_product.id, v_row.qty, v_product.price_pkr, v_product.cost_pkr, 0);

    v_subtotal  := v_subtotal + v_row.qty * v_product.price_pkr;
    v_total_cap := v_total_cap + private.line_discount_cap(v_product.id, v_row.qty);
  end loop;

  -- ── who is funding it, and how much each can reach ──────────────────────
  if v_subtotal >= private.cfg_int('MIN_ORDER_FOR_COINS_PKR') then
    v_rate := private.cfg('COIN_VALUE_PKR');

    for v_row in
      select f.user_id, f.affordable_pkr
        from private.group_order_funding(p_gid) f
       where f.affordable_pkr > 0
       order by f.affordable_pkr, f.user_id      -- ascending: water-filling wants the small purses first
    loop
      -- §6.1-style throughput ceiling, per person. Four helpers funding one
      -- buyer twice a week is the farm shape this bounds.
      select count(distinct g.id) into v_week
        from public.group_orders g
        join public.group_order_approvals a on a.group_order_id = g.id
       where a.user_id = v_row.user_id
         and a.coins_spent > 0
         and g.status = 'placed'
         and g.placed_at >= public.pkt_week_start(now());

      if v_week < private.cfg_int('GROUP_ORDER_MAX_PER_USER_WEEK') then
        v_uids   := v_uids   || v_row.user_id;
        v_afford := v_afford || v_row.affordable_pkr;
        v_give   := v_give   || 0;
        v_coins  := v_coins  || 0;
      end if;
    end loop;
  end if;

  if array_length(v_uids, 1) > 0 then
    v_discount := least(v_total_cap,
                        (select coalesce(sum(x), 0)::integer from unnest(v_afford) as x));

    -- Water-filling: an equal share of what is still needed, each pass, capped
    -- by what each person can actually reach. Smallest purses first, so someone
    -- with 40 rupees of coins is not asked for 300 and skipped.
    v_remaining := v_discount;
    loop
      exit when v_remaining <= 0;

      select count(*) into v_active from unnest(v_afford) as a where a > 0;
      exit when v_active = 0;

      v_share := greatest(1, v_remaining / v_active);
      v_progress := false;

      for i in 1 .. array_length(v_uids, 1) loop
        exit when v_remaining <= 0;
        if v_afford[i] > 0 then
          v_take := least(v_share, v_afford[i], v_remaining);
          v_give[i]   := v_give[i] + v_take;
          v_afford[i] := v_afford[i] - v_take;
          v_remaining := v_remaining - v_take;
          v_progress  := true;
        end if;
      end loop;

      exit when not v_progress;
    end loop;

    -- ── coins, per person, from their own batches ─────────────────────────
    -- The discount is rebuilt from what was actually funded, so an unreachable
    -- remainder and a balance that moved mid-transaction both land in one place.
    v_discount := 0;
    for i in 1 .. array_length(v_uids, 1) loop
      if v_give[i] > 0 then
        -- ceil(), so we never hand out more rupees than the coins paid for.
        v_coins[i] := ceil(v_give[i] / v_rate)::integer;
        v_coins[i] := least(v_coins[i], public.coin_balance(v_uids[i]));
        -- If a balance moved since the funding read, the rupees follow the coins
        -- down rather than the debit failing.
        v_give[i]  := least(v_give[i], floor(v_coins[i] * v_rate)::integer);
        v_discount := v_discount + v_give[i];
      end if;
    end loop;
  end if;

  if v_discount > 0 then
    v_remaining := v_discount;
    for v_line in
      select oi.id, private.line_discount_cap(oi.product_id, oi.qty) as cap
        from public.order_items oi
       where oi.order_id = v_order_id
       order by cap desc, oi.id
    loop
      exit when v_remaining <= 0;
      v_take := least(v_line.cap, v_remaining);
      if v_take > 0 then
        update public.order_items set discount_pkr = v_take where id = v_line.id;
        v_remaining := v_remaining - v_take;
      end if;
    end loop;

    update public.orders set discount_pkr = v_discount where id = v_order_id;

    for i in 1 .. array_length(v_uids, 1) loop
      if v_coins[i] > 0 and v_give[i] > 0 then
        -- The debit is on v_uids[i], against v_uids[i]'s own batches. This is the
        -- line that would have to change for a coin to move between two people,
        -- and private.coin_debit_guard() would stop it if it did.
        perform private.spend_coins(v_uids[i], v_coins[i], 'order_pending', v_order_id);

        update public.group_order_approvals
           set coins_spent = v_coins[i]
         where group_order_id = p_gid and user_id = v_uids[i];
      end if;
    end loop;
  end if;

  update public.group_orders
     set status = 'placed', order_id = v_order_id, placed_at = now(), closed_at = now()
   where id = p_gid;

  return jsonb_build_object(
    'group_order_id', p_gid,
    'order_id',       v_order_id,
    'subtotal_pkr',   v_subtotal,
    'discount_pkr',   v_discount,
    'total_pkr',      (select total_pkr from public.orders where id = v_order_id),
    'funded_by',      coalesce(array_length(v_uids, 1), 0));
end $$;

-- ---------------------------------------------------------------------------
-- Saying yes or no
--
-- Two booleans. Nothing that names a coin figure ever crosses this boundary
-- (§13.2): "do you approve" and "are you willing to put your own coins in".
-- The last yes places the order.
-- ---------------------------------------------------------------------------
create or replace function public.respond_to_group_order(
  p_gid       uuid,
  p_approve   boolean,
  p_use_coins boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_me      uuid := auth.uid();
  v_g       record;
  v_waiting integer;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  select * into v_g from public.group_orders where id = p_gid for update;
  if not found or v_me not in (select private.group_order_members(p_gid)) then
    raise exception 'no such group order' using errcode = 'no_data_found';
  end if;
  if v_g.status <> 'open' then
    raise exception 'this basket is already %', v_g.status using errcode = 'check_violation';
  end if;
  if v_g.expires_at <= now() then
    update public.group_orders set status = 'expired', closed_at = now() where id = p_gid;
    raise exception 'this basket has expired' using errcode = 'check_violation';
  end if;

  insert into public.group_order_approvals (group_order_id, user_id, decision, spend_coins)
  values (p_gid, v_me, case when p_approve then 'approved' else 'declined' end,
          p_approve and p_use_coins)
  on conflict (group_order_id, user_id) do update
    set decision    = excluded.decision,
        spend_coins = excluded.spend_coins,
        decided_at  = now()
  -- A decision on a placed basket is not a thing, and coins_spent is the
  -- server's own record; neither is touched by an update.
  where public.group_order_approvals.coins_spent = 0;

  -- One no ends it. There is no quorum and no majority: the ask was permission
  -- from every other person in the group, and that is what this is.
  if not p_approve then
    update public.group_orders set status = 'declined', closed_at = now() where id = p_gid;
    return public.group_order(p_gid);
  end if;

  select count(*) into v_waiting
    from public.team_members tm
    left join public.group_order_approvals a
           on a.group_order_id = p_gid and a.user_id = tm.user_id and a.decision = 'approved'
   where tm.team_id = v_g.team_id and a.user_id is null;

  if v_waiting = 0 then
    perform private.place_group_order(p_gid);
  end if;

  return public.group_order(p_gid);
end $$;

comment on function public.respond_to_group_order(uuid, boolean, boolean) is
  'README §13.2 — two booleans and an id. No coin count, no pledge, no share. The '
  'server decides who funds what, from balances and a rate the client cannot read.';

-- The opener can call it off while it is still open. So can anyone else, by
-- declining — which is the same thing said from the other side.
create or replace function public.cancel_group_order(p_gid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare v_g record;
begin
  select * into v_g from public.group_orders where id = p_gid for update;
  if not found or auth.uid() is null or auth.uid() not in (select private.group_order_members(p_gid)) then
    raise exception 'no such group order' using errcode = 'no_data_found';
  end if;
  if v_g.opened_by <> auth.uid() then
    raise exception 'only the person who opened this basket can call it off'
      using errcode = 'insufficient_privilege';
  end if;
  if v_g.status <> 'open' then
    raise exception 'this basket is already %', v_g.status using errcode = 'check_violation';
  end if;

  -- Nothing to unwind: a draft never held stock and never debited a coin. If it
  -- had been placed, the order's own lifecycle owns it from there and
  -- public.cancel_my_order is the door.
  update public.group_orders set status = 'cancelled', closed_at = now() where id = p_gid;
  return public.group_order(p_gid);
end $$;

-- Swept by the same cron that runs the other housekeeping. Expiry is also
-- checked on every read and every response, so a sweep that does not run yet
-- cannot resurrect a stale basket.
create or replace function private.expire_group_orders()
returns integer
language sql
security definer
set search_path = public, private, pg_temp
as $$
  with done as (
    update public.group_orders
       set status = 'expired', closed_at = now()
     where status = 'open' and expires_at <= now()
    returning 1)
  select count(*)::integer from done
$$;

-- ---------------------------------------------------------------------------
-- Grants.
--
-- Postgres grants EXECUTE on every new function to PUBLIC, and anon and
-- authenticated inherit it. Revoking from those two alone does nothing; the
-- revoke has to name PUBLIC, and it has to happen for every function in this
-- file. 13_function_grants_test.sql is what proves it did.
--
-- The three tables get no grants at all. Every read goes through
-- public.group_order(), which knows who is asking.
-- ---------------------------------------------------------------------------
revoke all on function
  public.open_group_order(jsonb, text, text, text),
  public.respond_to_group_order(uuid, boolean, boolean),
  public.cancel_group_order(uuid),
  public.group_order(uuid),
  public.my_group_orders(),
  private.place_group_order(uuid),
  private.group_order_members(uuid),
  private.group_order_funding(uuid),
  private.group_order_cap(uuid),
  private.group_order_subtotal(uuid),
  private.group_order_discount(uuid),
  private.expire_group_orders()
from public, anon, authenticated;

grant execute on function
  public.open_group_order(jsonb, text, text, text),
  public.respond_to_group_order(uuid, boolean, boolean),
  public.cancel_group_order(uuid),
  public.group_order(uuid),
  public.my_group_orders()
to authenticated;

grant execute on function
  private.place_group_order(uuid),
  private.expire_group_orders()
to service_role;

-- Housekeeping. Hourly is plenty: expiry is enforced on read and on response
-- too, so the sweep only exists to stop 'open' rows accumulating for baskets
-- nobody will ever look at again.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron unavailable — group order sweep not scheduled (local test cluster)';
    return;
  end if;
  create extension if not exists pg_cron;
  perform cron.schedule('qadam-expire-group-orders', '7 * * * *',
                        $cron$select private.expire_group_orders()$cron$);
end $$;
