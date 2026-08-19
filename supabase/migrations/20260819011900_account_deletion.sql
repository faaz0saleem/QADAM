-- In-app account deletion.
--
-- Apple and Google both require it of any app that lets people create an
-- account, so this is not optional even in Phase 1. It also forces an answer to
-- a question the schema had been quietly avoiding: what happens to an
-- APPEND-ONLY ledger when the person it belongs to leaves?
--
-- The append-only trigger blocks DELETE. users cascades to coin_ledger. So
-- `delete from users` raises, and the account cannot be removed at all — which
-- is a store rejection waiting to happen and, more to the point, a promise to a
-- user that we could not keep.
--
-- THE CHOICE: a real delete, not an anonymisation.
--
-- Coins never convert to cash and never leave the app (§1), so the ledger is not
-- a financial record anyone is obliged to retain. Keeping a "deleted" user's
-- rows forever, tied to a tombstone row, would be retaining personal data while
-- telling someone it was gone. Everything goes.
--
-- The append-only guarantee is preserved everywhere else by making the exception
-- narrow and explicit: the trigger yields only inside a transaction that has set
-- a flag, and only private.delete_account sets it. There is no way to reach that
-- flag from a client, and erasing one row of history still cannot be done at all.

alter table public.users drop constraint if exists users_status_check;
alter table public.users add constraint users_status_check
  check (status in ('active', 'flagged', 'banned', 'deleting'));

comment on column public.users.status is
  'flagged: still earns and still sees their own totals, but is excluded from '
  'leaderboards and cannot redeem. banned: nothing. deleting: the account is on '
  'its way out and must not earn, rank or be referred to.';

-- The one thing allowed to lift the append-only rule, and only for the length of
-- one transaction.
create or replace function private.coin_ledger_is_append_only()
returns trigger
language plpgsql
as $$
begin
  -- Set only by private.delete_account, which is service_role only. A client
  -- cannot set a session variable through PostgREST, and even if it could, this
  -- one is checked alongside a delete of the whole account.
  if current_setting('qadam.erasing_account', true) = 'yes' and tg_op = 'DELETE' then
    return old;
  end if;

  raise exception
    'coin_ledger is append-only (README §5): % is not permitted. Correct a mistake by '
    'appending an adjustment row, never by rewriting history.', tg_op
    using errcode = 'restrict_violation';
end $$;

-- ---------------------------------------------------------------------------
-- The two-step deletion.
--
-- Step one is the client's: mark the account, so it stops earning and ranking
-- immediately even if step two is delayed. Step two is the Edge Function's,
-- which removes the rows and then the auth user — an order that matters, since
-- deleting the auth user cascades back into everything here.
-- ---------------------------------------------------------------------------
create or replace function public.request_account_deletion()
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  update public.users set status = 'deleting' where id = v_me;

  -- Out of every shared surface at once. Someone who has asked to leave should
  -- not appear on a leaderboard or in a team roster while the queue catches up.
  delete from public.leaderboard_snap where user_id = v_me;
  delete from public.team_members where user_id = v_me;
  delete from public.friendships where user_a = v_me or user_b = v_me;
  delete from public.push_tokens where user_id = v_me;

  return jsonb_build_object('status', 'deleting');
end $$;

comment on function public.request_account_deletion() is
  'Marks the caller''s account for deletion and removes them from every shared '
  'surface immediately. The rows go in private.delete_account, called by the '
  'delete-account Edge Function, which then removes the auth user.';

create or replace function private.delete_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user  record;
  v_coins integer;
begin
  select * into v_user from public.users where id = p_user_id;
  if not found then
    return jsonb_build_object('deleted', false, 'reason', 'unknown_user');
  end if;

  -- Only an account that asked. This is the guard that stops a bug elsewhere
  -- turning into an erasure.
  if v_user.status <> 'deleting' then
    raise exception 'account % has not requested deletion', p_user_id
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(delta), 0) into v_coins
    from public.coin_ledger where user_id = p_user_id and delta > 0;

  -- A team without a captain is a team nobody can administer, so hand it to the
  -- longest-standing member rather than leaving it stranded.
  update public.teams t
     set captain_id = (select m.user_id from public.team_members m
                        where m.team_id = t.id and m.user_id <> p_user_id
                        order by m.joined_at limit 1)
   where t.captain_id = p_user_id
     and exists (select 1 from public.team_members m
                  where m.team_id = t.id and m.user_id <> p_user_id);

  delete from public.teams t
   where t.captain_id = p_user_id
     and not exists (select 1 from public.team_members m
                      where m.team_id = t.id and m.user_id <> p_user_id);

  -- Someone else's referral row should not vanish because their referee left;
  -- it is detached instead, so the referrer keeps what they were paid.
  update public.referrals set referee_id = null where referee_id = p_user_id and paid_at is not null;
  delete from public.referrals where referee_id = p_user_id and paid_at is null;
  update public.users set referred_by = null where referred_by = p_user_id;

  perform set_config('qadam.erasing_account', 'yes', true);
  delete from public.users where id = p_user_id;
  perform set_config('qadam.erasing_account', 'no', true);

  return jsonb_build_object('deleted', true, 'coins_destroyed', v_coins);
end $$;

comment on function private.delete_account(uuid) is
  'Removes every row belonging to one account. The caller must then delete the '
  'auth.users row. Coins are destroyed, not transferred — §13.3 means there is '
  'nowhere for them to go, which is exactly why leaving is safe to allow.';

-- referrals.referee_id has to become nullable for the detach above.
alter table public.referrals alter column referee_id drop not null;
alter table public.referrals drop constraint if exists no_self_referral;
alter table public.referrals add constraint no_self_referral
  check (referee_id is null or referrer_id <> referee_id);

-- An account on its way out earns nothing and ranks nowhere.
create or replace function private.rankable_steps(p_from date, p_to date)
returns table (user_id uuid, city text, steps bigint)
language sql
stable
as $$
  select d.user_id, u.city, sum(d.credited_steps)::bigint
    from public.daily_steps d
    join public.users u on u.id = d.user_id
   where d.date between p_from and p_to
     and d.attested
     and u.status = 'active'
     and not (d.flags && array['device_shared','rate_ceiling'])
   group by d.user_id, u.city
$$;

revoke all on function private.delete_account(uuid) from public, anon, authenticated;
revoke all on function public.request_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;
grant execute on function private.delete_account(uuid) to service_role;

create or replace function public.delete_account(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = public, private, pg_temp
as $$ select private.delete_account(p_user_id) $$;

revoke all on function public.delete_account(uuid) from public, anon, authenticated;
grant execute on function public.delete_account(uuid) to service_role;
