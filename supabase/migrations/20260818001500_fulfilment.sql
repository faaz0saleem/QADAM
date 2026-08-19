-- 20260818001500_fulfilment.sql
-- §7.5 — the WhatsApp confirmation and the courier handoff.

alter table orders
  add column courier          text check (courier in ('tcs','leopards','mp')),
  add column tracking_number  text,
  add column courier_charge_pkr integer check (courier_charge_pkr >= 0);

create index orders_tracking_idx on orders (tracking_number) where tracking_number is not null;

-- §7.5: "WhatsApp confirmation before dispatch. Automated, with a confirm/cancel
-- button." The reply comes back over a webhook, so each request carries a token
-- that identifies the order without the webhook trusting anything the sender
-- claims about which order they are answering for.
create table order_confirmations (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  token         text not null unique default encode(gen_random_bytes(24), 'hex'),
  phone         text not null,
  channel       text not null default 'whatsapp' check (channel in ('whatsapp','sms')),
  sent_at       timestamptz,
  responded_at  timestamptz,
  response      text check (response in ('confirmed','cancelled')),
  attempts      integer not null default 0 check (attempts >= 0),
  created_at    timestamptz not null default now()
);

create index order_confirmations_order_idx   on order_confirmations (order_id);
create index order_confirmations_pending_idx on order_confirmations (created_at)
  where sent_at is null;

comment on table order_confirmations is
  '§7.5. A COD order above PKR 3,000 cannot be dispatched until one of these '
  'comes back confirmed — set_order_status enforces that.';

-- Queue a confirmation for every COD order that needs one, at placement.
create or replace function queue_order_confirmation(p_order uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  o  orders%rowtype;
  v_id uuid;
begin
  select * into o from orders where id = p_order;
  if not found then
    raise exception 'no such order %', p_order using errcode = 'no_data_found';
  end if;

  -- A prepaid order has nothing to confirm, and a small COD order is not worth
  -- the message: the threshold is the same PKR 3,000 that gates dispatch.
  if o.payment_method <> 'cod' or o.total_pkr <= 3000 then
    return null;
  end if;

  insert into order_confirmations (order_id, phone)
  values (p_order, o.phone)
  returning id into v_id;

  return v_id;
end
$$;

-- The webhook's only entry point. Takes a token, never an order id, so a caller
-- who can reach the webhook still cannot confirm an order they were not sent.
create or replace function respond_to_confirmation(p_token text, p_response text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c order_confirmations%rowtype;
begin
  if p_response not in ('confirmed','cancelled') then
    raise exception 'response must be confirmed or cancelled' using errcode = 'check_violation';
  end if;

  select * into c from order_confirmations where token = p_token for update;
  if not found then
    raise exception 'unknown confirmation' using errcode = 'no_data_found';
  end if;
  if c.responded_at is not null then
    -- A customer tapping twice is not an error, and neither is a webhook
    -- retrying. The first answer stands.
    return c.order_id;
  end if;

  update order_confirmations
  set responded_at = now(), response = p_response
  where id = c.id;

  if p_response = 'confirmed' then
    perform set_order_status(c.order_id, 'confirmed');
  else
    -- Cancelled before dispatch, so the coins come back (§7.5). Only a REFUSED
    -- delivery burns them.
    perform set_order_status(c.order_id, 'cancelled');
  end if;

  return c.order_id;
end
$$;

-- Record what the courier says, and translate it into an order status.
create or replace function record_courier_status(
  p_tracking text,
  p_status   text,
  p_raw      text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_order uuid;
  v_now   text;
begin
  select id, status into v_order, v_now from orders where tracking_number = p_tracking;
  if v_order is null then
    raise exception 'no order with tracking number %', p_tracking using errcode = 'no_data_found';
  end if;

  -- Only the terminal states change anything. An 'in transit' ping should not
  -- reopen an order that has already closed.
  if v_now in ('delivered','refused','cancelled','returned') then
    return v_order;
  end if;

  if p_status = 'delivered' then
    perform set_order_status(v_order, 'delivered');
  elsif p_status = 'refused' then
    -- §7.5: this is the one that burns the coins.
    perform set_order_status(v_order, 'refused');
  elsif p_status = 'returned' or p_status = 'lost' then
    -- Not the customer's fault as far as we can tell, so their coins survive.
    perform set_order_status(v_order, 'returned');
  elsif p_status = 'out_for_delivery' and v_now = 'confirmed' then
    perform set_order_status(v_order, 'dispatched');
  end if;

  return v_order;
end
$$;

alter table order_confirmations enable row level security;
-- No client policy: confirmations move through the webhook and service_role only.
