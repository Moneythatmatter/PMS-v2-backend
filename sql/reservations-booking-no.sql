-- Patch: reservations — human-readable booking_no (BK-0, BK-1, …)
-- UUID stays the primary key; booking_no is unique and auto-assigned on insert.
-- Run once in Supabase SQL Editor.

create sequence if not exists public.reservations_booking_no_seq
  start with 0
  increment by 1
  minvalue 0;

alter table public.reservations add column if not exists booking_no text;

-- Backfill existing rows in stable order
with numbered as (
  select
    id,
    (row_number() over (order by created_at nulls last, id) - 1)::bigint as n
  from public.reservations
  where booking_no is null or trim(booking_no) = ''
)
update public.reservations r
set booking_no = 'BK-' || numbered.n::text
from numbered
where r.id = numbered.id;

-- Align sequence with next available number
select setval(
  'public.reservations_booking_no_seq',
  coalesce(
    (
      select max(
        case
          when booking_no ~ '^BK-[0-9]+$'
            then substring(booking_no from 4)::bigint
          else null
        end
      )
      from public.reservations
    ),
    -1
  ) + 1,
  false
);

create unique index if not exists reservations_booking_no_key
  on public.reservations (booking_no)
  where booking_no is not null and trim(booking_no) <> '';

create or replace function public.reservations_assign_booking_no()
returns trigger
language plpgsql
as $$
begin
  if new.booking_no is null or trim(new.booking_no) = '' then
    new.booking_no := 'BK-' || nextval('public.reservations_booking_no_seq')::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reservations_assign_booking_no on public.reservations;

create trigger trg_reservations_assign_booking_no
  before insert on public.reservations
  for each row
  execute function public.reservations_assign_booking_no();

notify pgrst, 'schema cache';
