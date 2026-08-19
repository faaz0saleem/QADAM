-- §7.5 — the record of who was asked to confirm, and whether the asking worked.
--
-- The dispatch gate already lives in set_order_status. This is the other half:
-- knowing which parcels are sitting still because nobody has been asked
-- anything, which is a support problem rather than a code one but is invisible
-- without a table.

create table public.order_confirmations (
  order_id    uuid not null references public.orders(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  sent        boolean not null,
  detail      text,

  primary key (order_id, attempted_at)
);

alter table public.order_confirmations enable row level security;

create index order_confirmations_order_idx on public.order_confirmations (order_id, attempted_at desc);

create or replace function private.orders_awaiting_confirmation()
returns table (id uuid, phone text, total_pkr integer, item_count integer, locale text)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select o.id, o.phone, o.total_pkr,
         (select coalesce(sum(oi.qty), 0)::integer from public.order_items oi where oi.order_id = o.id),
         coalesce(u.locale, 'en')
    from public.orders o
    join public.users u on u.id = o.user_id
   where o.status = 'pending_confirmation'
     and o.payment_method = 'cod'
     -- Only the ones the threshold actually stops. Asking about a PKR 800 order
     -- spends a paid WhatsApp template to prevent nothing.
     and o.total_pkr > private.cfg_int('COD_CONFIRM_THRESHOLD_PKR')
     -- At most three asks, and not twice in an hour. A confirmation request that
     -- keeps arriving is how a brand-new customer learns to block the number.
     and (select count(*) from public.order_confirmations c where c.order_id = o.id) < 3
     and not exists (select 1 from public.order_confirmations c
                      where c.order_id = o.id and c.attempted_at > now() - interval '1 hour')
   order by o.created_at
   limit 100
$$;

create or replace function private.record_confirmation_attempt(
  p_order_id uuid, p_sent boolean, p_detail text default null)
returns void
language sql
security definer
set search_path = public, private, pg_temp
as $$
  insert into public.order_confirmations (order_id, sent, detail)
  values (p_order_id, p_sent, p_detail)
$$;

create or replace function public.orders_awaiting_confirmation()
returns table (id uuid, phone text, total_pkr integer, item_count integer, locale text)
language sql security definer set search_path = public, private, pg_temp
as $$ select * from private.orders_awaiting_confirmation() $$;

create or replace function public.record_confirmation_attempt(
  p_order_id uuid, p_sent boolean, p_detail text default null)
returns void
language sql security definer set search_path = public, private, pg_temp
as $$ select private.record_confirmation_attempt(p_order_id, p_sent, p_detail) $$;

revoke all on function
  private.orders_awaiting_confirmation(), private.record_confirmation_attempt(uuid, boolean, text),
  public.orders_awaiting_confirmation(), public.record_confirmation_attempt(uuid, boolean, text)
from public, anon, authenticated;

grant execute on function
  private.orders_awaiting_confirmation(), private.record_confirmation_attempt(uuid, boolean, text),
  public.orders_awaiting_confirmation(), public.record_confirmation_attempt(uuid, boolean, text)
to service_role;

-- Every fifteen minutes: ask about anything that is waiting.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('qadam-order-confirmations', '*/15 * * * *',
                          $cron$select private.notify('order-confirm')$cron$);
  end if;
end $$;
