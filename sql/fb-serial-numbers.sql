-- F&B POS — global sequential document numbers (all outlets share one counter each)
-- ORD-001, KOT-001, BILL-001 … assigned automatically on insert when blank.
-- Run once in Supabase SQL Editor (after fb-pos-v2-schema.sql).

create sequence if not exists public.fb_ord_no_seq
  start with 1
  increment by 1
  minvalue 1;

create sequence if not exists public.fb_kot_no_seq
  start with 1
  increment by 1
  minvalue 1;

create sequence if not exists public.fb_bill_no_seq
  start with 1
  increment by 1
  minvalue 1;

-- Align sequences with existing rows (numeric codes or row count, whichever is higher)
select setval(
  'public.fb_ord_no_seq',
  greatest(
    coalesce(
      (
        select max(substring(order_no from 5)::bigint)
        from public.fb_orders
        where order_no ~ '^ORD-[0-9]+$'
      ),
      0
    ),
    (select count(*)::bigint from public.fb_orders)
  ),
  true
);

select setval(
  'public.fb_kot_no_seq',
  greatest(
    coalesce(
      (
        select max(substring(kot_number from 5)::bigint)
        from public.fb_kot_tickets
        where kot_number ~ '^KOT-[0-9]+$'
      ),
      0
    ),
    (select count(*)::bigint from public.fb_kot_tickets)
  ),
  true
);

select setval(
  'public.fb_bill_no_seq',
  greatest(
    coalesce(
      (
        select max(substring(bill_no from 6)::bigint)
        from public.fb_bills
        where bill_no ~ '^BILL-[0-9]+$'
      ),
      0
    ),
    (select count(*)::bigint from public.fb_bills)
  ),
  true
);

create or replace function public.fb_assign_order_no()
returns trigger
language plpgsql
as $$
begin
  if new.order_no is null or trim(new.order_no) = '' then
    new.order_no := 'ORD-' || lpad(nextval('public.fb_ord_no_seq')::text, 3, '0');
  end if;
  return new;
end;
$$;

create or replace function public.fb_assign_kot_number()
returns trigger
language plpgsql
as $$
begin
  if new.kot_number is null or trim(new.kot_number) = '' then
    new.kot_number := 'KOT-' || lpad(nextval('public.fb_kot_no_seq')::text, 3, '0');
  end if;
  return new;
end;
$$;

create or replace function public.fb_assign_bill_no()
returns trigger
language plpgsql
as $$
begin
  if new.bill_no is null or trim(new.bill_no) = '' then
    new.bill_no := 'BILL-' || lpad(nextval('public.fb_bill_no_seq')::text, 3, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fb_assign_order_no on public.fb_orders;
create trigger trg_fb_assign_order_no
  before insert on public.fb_orders
  for each row
  execute function public.fb_assign_order_no();

drop trigger if exists trg_fb_assign_kot_number on public.fb_kot_tickets;
create trigger trg_fb_assign_kot_number
  before insert on public.fb_kot_tickets
  for each row
  execute function public.fb_assign_kot_number();

drop trigger if exists trg_fb_assign_bill_no on public.fb_bills;
create trigger trg_fb_assign_bill_no
  before insert on public.fb_bills
  for each row
  execute function public.fb_assign_bill_no();

notify pgrst, 'schema cache';
