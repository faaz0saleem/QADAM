-- Teams cap at five.
--
-- README §7.6 says "teams of 5–30". The human asked for a maximum of five, which
-- is a deliberate override of the brief and is recorded here rather than quietly
-- applied: a change to a number in the brief should be findable by reading the
-- migrations.
--
-- Five is also what makes the group order in the next migration defensible. A
-- shared basket that four other people have to approve is a household or a
-- friend group; the same mechanism across a team of thirty is a coin farm with
-- a delivery address. The size limit is part of that feature's threat model,
-- not a cosmetic setting, which is why it lives in a CHECK.

do $$
declare v_name text;
begin
  -- The constraint was written inline on the column, so its name is whatever
  -- Postgres chose. Look it up rather than guessing at it.
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.teams'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%member_max%';

  if v_name is not null then
    execute format('alter table public.teams drop constraint %I', v_name);
  end if;
end $$;

-- Existing rows first: the new CHECK has to be true before it can be added.
update public.teams
   set member_min = least(member_min, 5),
       member_max = least(member_max, 5);

alter table public.teams alter column member_max set default 5;
alter table public.teams alter column member_min set default 2;

alter table public.teams
  add constraint member_max_is_five
  check (member_max >= member_min and member_max <= 5);

comment on column public.teams.member_max is
  'Five. Deliberately smaller than README §7.6''s 5–30, at the human''s instruction. '
  'public.group_orders leans on this number: a basket that every other member must '
  'approve only works as a safeguard while "every other member" is at most four people.';

comment on column public.teams.member_min is
  'Two, so a team of five is not required to be full before it counts. Nothing '
  'enforces this today; it is what a challenge would read to decide eligibility.';
