-- 20260818001400_auth.sql
-- Profile creation, and the referral link that has to survive signup.

-- Supabase creates the auth.users row; this creates the matching public.users
-- row in the same transaction, so there is never a signed-in user without a
-- profile. Doing it in the app instead leaves a window where a crash between
-- the two writes strands an account with no city, no referrer and no ledger.
create or replace function handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_referrer uuid;
  v_code     text;
begin
  -- §7.7: the referral is carried through signup as metadata. It names the
  -- referrer only; nothing is paid here, and nothing is paid on install.
  v_code := nullif(new.raw_user_meta_data ->> 'referral_code', '');
  if v_code is not null then
    select id into v_referrer from users where referral_code = upper(v_code);
  end if;

  insert into users (id, phone, name, city, referred_by)
  values (
    new.id,
    coalesce(new.phone, new.email, new.id::text),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(new.raw_user_meta_data ->> 'city', ''),
    v_referrer
  )
  on conflict (id) do nothing;

  return new;
end
$$;

-- Every user gets a code to share (§7.7). Six characters from the same
-- unambiguous alphabet as team codes — these get read aloud too.
alter table users add column referral_code text unique;

create or replace function gen_referral_code() returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from users where referral_code = code);
  end loop;
  return code;
end
$$;

alter table users alter column referral_code set default gen_referral_code();
update users set referral_code = gen_referral_code() where referral_code is null;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- A client may read its own code to share it, but must not be able to look up
-- who owns someone else's — that would turn a shared code into a way of
-- resolving a stranger's account.
grant select (referral_code) on users to authenticated;
