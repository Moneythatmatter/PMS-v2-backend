-- FO Group Booking P0–P1
-- Run AFTER front-office-schema.sql + transactions.sql (+ multi-property if used).
-- Idempotent. Does NOT migrate individual booking folio behavior.
--
-- Adds: fo_groups, fo_group_billing_rules, folio_charges,
--        reservations.group_id, nullable reservations.guest_id, folios.group_id,
--        RPCs: fo_create_group, ensure_folio_for_group, fo_recalc_folio_from_charges,
--        null-safe ensure_folio_for_booking.

create extension if not exists pgcrypto;

-- ─── Enums ─────────────────────────────────────────────────────────────────

do $$
begin
  create type public.fo_charge_category as enum (
    'ROOM',
    'FOOD_BEVERAGE',
    'MINIBAR',
    'LAUNDRY',
    'OTHER'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.fo_billing_responsibility as enum (
    'GROUP_OWNER',
    'GUEST'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.fo_group_status as enum (
    'Confirmed',
    'Partial',
    'In-House',
    'Checked Out',
    'Cancelled'
  );
exception
  when duplicate_object then null;
end $$;

-- ─── fo_groups ─────────────────────────────────────────────────────────────

create sequence if not exists public.fo_groups_group_no_seq
  start with 0 increment by 1 minvalue 0;

create table if not exists public.fo_groups (
  id text primary key default gen_random_uuid()::text,
  property_id text,
  group_no text,
  group_name text not null,
  group_type text not null default 'Other',
  contact_guest_id text references public.guests(id) on delete set null,
  contact_name text,
  contact_phone text,
  contact_email text,
  company_name text,
  arrival_date text not null,
  departure_date text not null,
  status public.fo_group_status not null default 'Confirmed',
  notes text,
  idempotency_key text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'properties'
  ) and not exists (
    select 1 from pg_constraint where conname = 'fo_groups_property_id_fkey'
  ) then
    alter table public.fo_groups
      add constraint fo_groups_property_id_fkey
      foreign key (property_id) references public.properties(id) on delete cascade;
  end if;
exception
  when others then
    raise notice 'fo_groups.property_id FK skipped: %', SQLERRM;
end $$;

create unique index if not exists fo_groups_property_group_no_key
  on public.fo_groups (property_id, group_no)
  where property_id is not null and group_no is not null and trim(group_no) <> '';

create unique index if not exists fo_groups_property_idempotency_key
  on public.fo_groups (property_id, idempotency_key)
  where property_id is not null
    and idempotency_key is not null
    and trim(idempotency_key) <> '';

create index if not exists fo_groups_property_id_idx on public.fo_groups (property_id);

create or replace function public.fo_groups_assign_group_no()
returns trigger
language plpgsql
as $$
begin
  if new.group_no is null or trim(new.group_no) = '' then
    new.group_no := 'GRP-' || nextval('public.fo_groups_group_no_seq')::text;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_fo_groups_assign_group_no on public.fo_groups;
create trigger trg_fo_groups_assign_group_no
  before insert or update on public.fo_groups
  for each row execute function public.fo_groups_assign_group_no();

-- ─── fo_group_billing_rules ────────────────────────────────────────────────

create table if not exists public.fo_group_billing_rules (
  id text primary key default gen_random_uuid()::text,
  property_id text,
  group_id text not null references public.fo_groups(id) on delete cascade,
  charge_category public.fo_charge_category not null,
  responsibility public.fo_billing_responsibility not null default 'GUEST',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, charge_category)
);

create index if not exists fo_group_billing_rules_group_id_idx
  on public.fo_group_billing_rules (group_id);

-- ─── reservations: group_id + nullable guest_id ────────────────────────────

alter table public.reservations
  add column if not exists group_id text;

alter table public.reservations
  add column if not exists requested_room_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reservations_group_id_fkey'
  ) then
    alter table public.reservations
      add constraint reservations_group_id_fkey
      foreign key (group_id) references public.fo_groups(id) on delete set null;
  end if;
exception
  when others then
    raise notice 'reservations.group_id FK skipped: %', SQLERRM;
end $$;

create index if not exists reservations_group_id_idx
  on public.reservations (group_id)
  where group_id is not null;

alter table public.reservations
  alter column guest_id drop not null;

-- ─── folios.group_id ───────────────────────────────────────────────────────

alter table public.folios
  add column if not exists group_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'folios_group_id_fkey'
  ) then
    alter table public.folios
      add constraint folios_group_id_fkey
      foreign key (group_id) references public.fo_groups(id) on delete set null;
  end if;
exception
  when others then
    raise notice 'folios.group_id FK skipped: %', SQLERRM;
end $$;

create index if not exists folios_group_id_idx
  on public.folios (group_id)
  where group_id is not null;

-- XOR: stay folio XOR group master folio
-- Skip adding if any existing row would violate (both null / both set).
do $$
begin
  if exists (
    select 1 from public.folios
    where (booking_id is null and group_id is null)
       or (booking_id is not null and group_id is not null)
    limit 1
  ) then
    raise notice 'folios_booking_xor_group skipped — existing rows violate XOR';
  else
    alter table public.folios drop constraint if exists folios_booking_xor_group;
    alter table public.folios
      add constraint folios_booking_xor_group
      check (
        (booking_id is not null and group_id is null)
        or (booking_id is null and group_id is not null)
      );
  end if;
exception
  when others then
    raise notice 'folios_booking_xor_group skipped: %', SQLERRM;
end $$;

-- ─── folio_charges ─────────────────────────────────────────────────────────

create table if not exists public.folio_charges (
  id text primary key default gen_random_uuid()::text,
  property_id text,
  folio_id text not null references public.folios(id) on delete cascade,
  group_id text references public.fo_groups(id) on delete set null,
  reservation_id text references public.reservations(id) on delete set null,
  booking_id text references public.reservations(id) on delete set null,
  guest_id text references public.guests(id) on delete set null,
  charge_category public.fo_charge_category not null,
  description text not null default '',
  quantity numeric(12, 2) not null default 1,
  unit_price numeric(14, 2) not null default 0,
  amount numeric(14, 2) not null default 0,
  responsibility public.fo_billing_responsibility,
  source_module text,
  source_type text,
  source_id text,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists folio_charges_folio_id_idx on public.folio_charges (folio_id);
create index if not exists folio_charges_group_id_idx on public.folio_charges (group_id);
create index if not exists folio_charges_reservation_id_idx on public.folio_charges (reservation_id);

create unique index if not exists folio_charges_source_idempotency_idx
  on public.folio_charges (folio_id, source_module, source_type, source_id)
  where source_module is not null
    and source_type is not null
    and source_id is not null
    and trim(source_id) <> '';

-- ─── Recalc folio header from charges ──────────────────────────────────────

create or replace function public.fo_recalc_folio_from_charges(p_folio_id text)
returns void
language plpgsql
security definer
as $$
declare
  v_subtotal numeric(14, 2) := 0;
begin
  if p_folio_id is null or trim(p_folio_id) = '' then
    return;
  end if;

  select coalesce(sum(amount), 0)
  into v_subtotal
  from public.folio_charges
  where folio_id = p_folio_id;

  update public.folios f
  set
    subtotal = v_subtotal,
    total_amount = v_subtotal
      + coalesce(f.tax_total, 0)
      - coalesce(f.discount_total, 0),
    balance_amount = greatest(
      0,
      v_subtotal
        + coalesce(f.tax_total, 0)
        - coalesce(f.discount_total, 0)
        - coalesce(f.paid_amount, 0)
    ),
    updated_at = now()
  where f.id = p_folio_id;
end;
$$;

-- ─── ensure_folio_for_group ────────────────────────────────────────────────

create or replace function public.ensure_folio_for_group(p_group_id text)
returns text
language plpgsql
security definer
as $$
declare
  v_folio_id text;
  v_guest_id text;
  v_property_id text;
  v_status public.folio_status;
  v_grp_status text;
begin
  if p_group_id is null or trim(p_group_id) = '' then
    raise exception 'group_id is required' using errcode = 'P0001';
  end if;

  select id into v_folio_id
  from public.folios
  where group_id = p_group_id
    and booking_id is null
    and status = 'OPEN'::public.folio_status
  order by opened_at desc
  limit 1;

  if v_folio_id is not null then
    -- Heal rows created before property_id was set on insert
    update public.folios f
    set property_id = g.property_id
    from public.fo_groups g
    where f.id = v_folio_id
      and f.property_id is null
      and g.id = p_group_id
      and g.property_id is not null;
    return v_folio_id;
  end if;

  select
    contact_guest_id,
    status::text,
    property_id
  into v_guest_id, v_grp_status, v_property_id
  from public.fo_groups
  where id = p_group_id;

  if not found then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;

  v_status := case
    when coalesce(v_grp_status, '') in ('Checked Out', 'Cancelled')
      then 'CLOSED'::public.folio_status
    else 'OPEN'::public.folio_status
  end;

  insert into public.folios (
    property_id,
    booking_id,
    group_id,
    guest_id,
    status,
    currency,
    subtotal,
    tax_total,
    discount_total,
    total_amount,
    paid_amount,
    balance_amount
  )
  values (
    v_property_id,
    null,
    p_group_id,
    v_guest_id,
    v_status,
    'INR',
    0, 0, 0, 0, 0, 0
  )
  returning id into v_folio_id;

  return v_folio_id;
end;
$$;

-- ─── Null-safe ensure_folio_for_booking ────────────────────────────────────

create or replace function public.ensure_folio_for_booking(
  p_booking_id text,
  p_guest_id text default null
)
returns text
language plpgsql
security definer
as $$
declare
  v_folio_id text;
  v_guest_id text;
  v_property_id text;
  v_status public.folio_status;
  v_subtotal numeric(14, 2) := 0;
  v_res_status text;
  v_group_id text;
begin
  if p_booking_id is null or trim(p_booking_id) = '' then
    raise exception 'booking_id is required' using errcode = 'P0001';
  end if;

  select id into v_folio_id
  from public.folios
  where booking_id = p_booking_id
    and group_id is null
    and status = 'OPEN'::public.folio_status
  order by opened_at desc
  limit 1;

  select
    coalesce(nullif(trim(p_guest_id), ''), r.guest_id),
    r.status,
    coalesce(r.total_amount, 0),
    r.group_id,
    r.property_id
  into v_guest_id, v_res_status, v_subtotal, v_group_id, v_property_id
  from public.reservations r
  where r.id = p_booking_id;

  if not found then
    raise exception 'Reservation not found' using errcode = 'P0002';
  end if;

  if v_folio_id is not null then
    update public.folios
    set property_id = v_property_id
    where id = v_folio_id
      and property_id is null
      and v_property_id is not null;
    -- Group children: never re-seed from reservations.total_amount
    -- (ROOM may live on master folio via folio_charges)
    if v_group_id is not null and trim(v_group_id) <> '' then
      return v_folio_id;
    end if;
    if exists (
      select 1 from public.folio_charges c where c.folio_id = v_folio_id
    ) then
      return v_folio_id;
    end if;
    perform public.sync_folio_from_booking(p_booking_id, v_folio_id);
    return v_folio_id;
  end if;

  -- Group children: start with zero subtotal; ROOM charges posted separately
  if v_group_id is not null and trim(v_group_id) <> '' then
    v_subtotal := 0;
  end if;

  v_status := case
    when coalesce(v_res_status, '') in ('Checked Out', 'Cancelled', 'No Show')
      then 'CLOSED'::public.folio_status
    else 'OPEN'::public.folio_status
  end;

  insert into public.folios (
    property_id,
    booking_id,
    group_id,
    guest_id,
    status,
    currency,
    subtotal,
    tax_total,
    discount_total,
    total_amount,
    paid_amount,
    balance_amount
  )
  values (
    v_property_id,
    p_booking_id,
    null,
    v_guest_id,
    v_status,
    'INR',
    v_subtotal,
    0,
    0,
    v_subtotal,
    0,
    v_subtotal
  )
  returning id into v_folio_id;

  return v_folio_id;
end;
$$;

-- ─── fo_create_group (atomic + idempotent) ─────────────────────────────────

create or replace function public.fo_create_group(
  p_property_id text,
  p_idempotency_key text,
  p_group_name text,
  p_group_type text default 'Other',
  p_contact_guest_id text default null,
  p_contact_name text default null,
  p_contact_phone text default null,
  p_contact_email text default null,
  p_company_name text default null,
  p_arrival_date text default null,
  p_departure_date text default null,
  p_nights int default 1,
  p_notes text default null,
  p_created_by text default null,
  p_room_lines jsonb default '[]'::jsonb,
  p_billing_rules jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_existing_id text;
  v_group_id text;
  v_master_folio_id text;
  v_needs_master boolean := false;
  v_line jsonb;
  v_rule jsonb;
  v_qty int;
  v_i int;
  v_room_type text;
  v_room_rate numeric(14, 2);
  v_nights int;
  v_amount numeric(14, 2);
  v_res_id text;
  v_child_folio_id text;
  v_pay_folio_id text;
  v_responsibility public.fo_billing_responsibility;
  v_category public.fo_charge_category;
  v_reservation_ids text[] := '{}';
  v_room_resp public.fo_billing_responsibility := 'GUEST';
  v_adults int;
  v_children int;
  v_tariff_plan text;
  v_meal_plan text;
begin
  if p_property_id is null or trim(p_property_id) = '' then
    raise exception 'property_id is required' using errcode = 'P0001';
  end if;
  if p_idempotency_key is null or trim(p_idempotency_key) = '' then
    raise exception 'idempotency_key is required' using errcode = 'P0001';
  end if;
  if p_group_name is null or trim(p_group_name) = '' then
    raise exception 'group_name is required' using errcode = 'P0001';
  end if;
  if p_arrival_date is null or trim(p_arrival_date) = '' then
    raise exception 'arrival_date is required' using errcode = 'P0001';
  end if;
  if p_departure_date is null or trim(p_departure_date) = '' then
    raise exception 'departure_date is required' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_room_lines) <> 'array' or jsonb_array_length(p_room_lines) < 1 then
    raise exception 'room_lines must be a non-empty array' using errcode = 'P0001';
  end if;

  v_nights := greatest(1, coalesce(p_nights, 1));

  -- Idempotent return
  select id into v_existing_id
  from public.fo_groups
  where property_id = p_property_id
    and idempotency_key = trim(p_idempotency_key)
  limit 1;

  if v_existing_id is not null then
    return jsonb_build_object(
      'groupId', v_existing_id,
      'idempotent', true,
      'reservationIds', coalesce(
        (
          select jsonb_agg(r.id order by r.created_at, r.id)
          from public.reservations r
          where r.group_id = v_existing_id
        ),
        '[]'::jsonb
      )
    );
  end if;

  insert into public.fo_groups (
    property_id,
    group_name,
    group_type,
    contact_guest_id,
    contact_name,
    contact_phone,
    contact_email,
    company_name,
    arrival_date,
    departure_date,
    status,
    notes,
    idempotency_key,
    created_by,
    updated_by
  )
  values (
    p_property_id,
    trim(p_group_name),
    coalesce(nullif(trim(p_group_type), ''), 'Other'),
    nullif(trim(p_contact_guest_id), ''),
    nullif(trim(p_contact_name), ''),
    nullif(trim(p_contact_phone), ''),
    nullif(trim(p_contact_email), ''),
    nullif(trim(p_company_name), ''),
    trim(p_arrival_date),
    trim(p_departure_date),
    'Confirmed'::public.fo_group_status,
    nullif(trim(p_notes), ''),
    trim(p_idempotency_key),
    nullif(trim(p_created_by), ''),
    nullif(trim(p_created_by), '')
  )
  returning id into v_group_id;

  -- Billing rules (defaults: ROOM=GROUP_OWNER, others=GUEST if empty)
  if jsonb_typeof(p_billing_rules) = 'array' and jsonb_array_length(p_billing_rules) > 0 then
    for v_rule in select * from jsonb_array_elements(p_billing_rules)
    loop
      v_category := upper(coalesce(v_rule->>'chargeCategory', v_rule->>'charge_category', 'OTHER'))::public.fo_charge_category;
      v_responsibility := upper(coalesce(v_rule->>'responsibility', 'GUEST'))::public.fo_billing_responsibility;
      insert into public.fo_group_billing_rules (
        property_id, group_id, charge_category, responsibility
      ) values (
        p_property_id, v_group_id, v_category, v_responsibility
      )
      on conflict (group_id, charge_category) do update
        set responsibility = excluded.responsibility,
            updated_at = now();
      if v_category = 'ROOM'::public.fo_charge_category then
        v_room_resp := v_responsibility;
      end if;
      if v_responsibility = 'GROUP_OWNER'::public.fo_billing_responsibility then
        v_needs_master := true;
      end if;
    end loop;
  else
    insert into public.fo_group_billing_rules (property_id, group_id, charge_category, responsibility)
    values
      (p_property_id, v_group_id, 'ROOM', 'GROUP_OWNER'),
      (p_property_id, v_group_id, 'FOOD_BEVERAGE', 'GUEST'),
      (p_property_id, v_group_id, 'MINIBAR', 'GUEST'),
      (p_property_id, v_group_id, 'LAUNDRY', 'GUEST'),
      (p_property_id, v_group_id, 'OTHER', 'GUEST');
    v_room_resp := 'GROUP_OWNER'::public.fo_billing_responsibility;
    v_needs_master := true;
  end if;

  if v_needs_master then
    v_master_folio_id := public.ensure_folio_for_group(v_group_id);
  end if;

  -- Expand room lines → reservations + folios + ROOM charges
  for v_line in select * from jsonb_array_elements(p_room_lines)
  loop
    v_room_type := coalesce(nullif(trim(v_line->>'roomType'), ''), nullif(trim(v_line->>'room_type'), ''), 'Standard');
    v_qty := greatest(1, coalesce((v_line->>'quantity')::int, (v_line->>'qty')::int, 1));
    v_room_rate := coalesce((v_line->>'roomRate')::numeric, (v_line->>'room_rate')::numeric, 0);
    v_amount := round(v_room_rate * v_nights, 2);
    v_adults := greatest(0, coalesce((v_line->>'adults')::int, (v_line->>'adult')::int, 1));
    v_children := greatest(0, coalesce((v_line->>'children')::int, (v_line->>'child')::int, 0));
    v_tariff_plan := coalesce(nullif(trim(v_line->>'tariffPlan'), ''), nullif(trim(v_line->>'tariff_plan'), ''), '');
    v_meal_plan := coalesce(nullif(trim(v_line->>'mealPlan'), ''), nullif(trim(v_line->>'meal_plan'), ''), '');

    for v_i in 1..v_qty
    loop
      v_res_id := gen_random_uuid()::text;

      insert into public.reservations (
        id,
        property_id,
        guest_id,
        group_id,
        check_in,
        check_out,
        balance,
        status,
        booking_type,
        nights,
        adults,
        children,
        tariff_plan,
        meal_plan,
        requested_room_type,
        room_rate,
        total_amount,
        advance_paid,
        company_name,
        created_at
      )
      values (
        v_res_id,
        p_property_id,
        null,
        v_group_id,
        trim(p_arrival_date),
        trim(p_departure_date),
        0,
        'Confirmed',
        'Group',
        v_nights,
        v_adults,
        v_children,
        nullif(v_tariff_plan, ''),
        nullif(v_meal_plan, ''),
        v_room_type,
        v_room_rate,
        v_amount,
        0,
        nullif(trim(p_company_name), ''),
        now()::text
      );

      v_child_folio_id := public.ensure_folio_for_booking(v_res_id, null);

      if v_room_resp = 'GROUP_OWNER'::public.fo_billing_responsibility then
        if v_master_folio_id is null then
          v_master_folio_id := public.ensure_folio_for_group(v_group_id);
        end if;
        v_pay_folio_id := v_master_folio_id;
      else
        v_pay_folio_id := v_child_folio_id;
      end if;

      if v_amount > 0 then
        insert into public.folio_charges (
          property_id,
          folio_id,
          group_id,
          reservation_id,
          booking_id,
          guest_id,
          charge_category,
          description,
          quantity,
          unit_price,
          amount,
          responsibility,
          source_module,
          source_type,
          source_id
        )
        values (
          p_property_id,
          v_pay_folio_id,
          v_group_id,
          v_res_id,
          v_res_id,
          null,
          'ROOM'::public.fo_charge_category,
          format('Room rent — %s × %s night(s)', v_room_type, v_nights),
          v_nights,
          v_room_rate,
          v_amount,
          v_room_resp,
          'RESERVATION',
          'ROOM_RENT',
          v_res_id
        );
        perform public.fo_recalc_folio_from_charges(v_pay_folio_id);
      end if;

      v_reservation_ids := array_append(v_reservation_ids, v_res_id);
    end loop;
  end loop;

  return jsonb_build_object(
    'groupId', v_group_id,
    'idempotent', false,
    'reservationIds', to_jsonb(v_reservation_ids),
    'masterFolioId', v_master_folio_id
  );
end;
$$;

grant execute on function public.fo_recalc_folio_from_charges(text) to anon, authenticated;
grant execute on function public.ensure_folio_for_group(text) to anon, authenticated;
grant execute on function public.ensure_folio_for_booking(text, text) to anon, authenticated;
grant execute on function public.fo_create_group(
  text, text, text, text, text, text, text, text, text, text, text, int, text, text, jsonb, jsonb
) to anon, authenticated;

-- RLS
do $$
declare
  t text;
begin
  foreach t in array array['fo_groups', 'fo_group_billing_rules', 'folio_charges']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "anon_all_%s" on %I', t, t);
    execute format(
      'create policy "anon_all_%s" on %I for all to anon using (true) with check (true)',
      t, t
    );
  end loop;
end $$;

notify pgrst, 'reload schema';

-- ─── Backfill: folios.property_id (master + child) ─────────────────────────
-- API list filters by property_id; folios created without it were invisible.

update public.folios f
set property_id = g.property_id
from public.fo_groups g
where f.group_id = g.id
  and f.booking_id is null
  and f.property_id is null
  and g.property_id is not null;

update public.folios f
set property_id = r.property_id
from public.reservations r
where f.booking_id = r.id
  and f.property_id is null
  and r.property_id is not null;
