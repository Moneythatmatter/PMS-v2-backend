-- Patch: guests — human-readable guest_no (G-0, G-1, …)
-- UUID stays the primary key; guest_no is unique and auto-assigned on insert.
-- Run once in Supabase SQL Editor (after guests-uuid-pk.sql).

create sequence if not exists public.guests_guest_no_seq
  start with 0
  increment by 1
  minvalue 0;

alter table public.guests add column if not exists guest_no text;

-- Backfill existing rows in stable order
with numbered as (
  select
    id,
    (row_number() over (order by created_at nulls last, id) - 1)::bigint as n
  from public.guests
  where guest_no is null or trim(guest_no) = ''
)
update public.guests g
set guest_no = 'G-' || numbered.n::text
from numbered
where g.id = numbered.id;

-- Align sequence with next available number
select setval(
  'public.guests_guest_no_seq',
  coalesce(
    (
      select max(
        case
          when guest_no ~ '^G-[0-9]+$'
            then substring(guest_no from 3)::bigint
          else null
        end
      )
      from public.guests
    ),
    -1
  ) + 1,
  false
);

create unique index if not exists guests_guest_no_key
  on public.guests (guest_no)
  where guest_no is not null and trim(guest_no) <> '';

create or replace function public.guests_assign_guest_no()
returns trigger
language plpgsql
as $$
begin
  if new.guest_no is null or trim(new.guest_no) = '' then
    new.guest_no := 'G-' || nextval('public.guests_guest_no_seq')::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guests_assign_guest_no on public.guests;

create trigger trg_guests_assign_guest_no
  before insert on public.guests
  for each row
  execute function public.guests_assign_guest_no();

notify pgrst, 'schema cache';
