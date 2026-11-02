-- Night Audit — Phase 1 (business date + nightly room posting)
--
-- Run in the Supabase SQL Editor AFTER the backend containing NightAuditService
-- is deployed. Older backends seed the full stay into folios.subtotal when a
-- reservation is created; if this file runs first, reservations created by an
-- old backend would default to NIGHTLY and be charged twice.
--
-- Prerequisites: front-office-schema.sql, transactions.sql, fo-group-booking-p0-p1.sql,
-- multi-property-schema.sql. Safe to re-run.

-- ─── 1. Billing mode per reservation ───────────────────────────────────────
-- LEGACY_SEEDED: full stay was written to folios.subtotal at booking time
--                (individual) or as folio_charges ROOM rows (group children).
-- NIGHTLY:       one ROOM_NIGHT charge is posted per night by Night Audit / checkout.
--
-- Every reservation that exists when this runs keeps its current billing,
-- whatever its status: cancelled / checked-out / no-show rows are never billed
-- again, and open rows (including future arrivals) were seeded at creation.

alter table public.reservations add column if not exists billing_mode text;

update public.reservations
set billing_mode = 'LEGACY_SEEDED'
where billing_mode is null;

alter table public.reservations alter column billing_mode set default 'NIGHTLY';
alter table public.reservations alter column billing_mode set not null;

alter table public.reservations drop constraint if exists reservations_billing_mode_check;
alter table public.reservations
  add constraint reservations_billing_mode_check
  check (billing_mode in ('LEGACY_SEEDED', 'NIGHTLY'));

-- ─── 2. Tax on folio charges + one charge per reservation per night ────────

alter table public.folio_charges add column if not exists tax_amount numeric(14, 2) not null default 0;
alter table public.folio_charges add column if not exists tax_details jsonb;
alter table public.folio_charges add column if not exists business_date date;

-- source_id = '<reservation id>:<YYYY-MM-DD>'. Independent of folio_id so a room
-- transfer, rate change or new folio can never produce a second charge for a night.
create unique index if not exists folio_charges_room_night_uidx
  on public.folio_charges (source_id)
  where source_module = 'FRONT_OFFICE' and source_type = 'ROOM_NIGHT';

-- ─── 3. Night audit runs ───────────────────────────────────────────────────

create table if not exists public.fo_night_audits (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references public.properties(id) on delete cascade,
  business_date date not null,
  next_business_date date not null,
  status text not null default 'RUNNING'
    check (status in ('RUNNING', 'COMPLETED', 'FAILED')),
  day_closing_id text,
  attempts int not null default 1,
  room_nights_posted int not null default 0,
  room_revenue numeric(14, 2) not null default 0,
  room_tax numeric(14, 2) not null default 0,
  summary jsonb not null default '{}'::jsonb,
  error text,
  run_by text,
  run_by_name text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fo_night_audits_property_date_key unique (property_id, business_date)
);

create index if not exists fo_night_audits_property_status_idx
  on public.fo_night_audits (property_id, status, business_date desc);

alter table public.fo_night_audits enable row level security;

drop policy if exists "anon_all_fo_night_audits" on public.fo_night_audits;
create policy "anon_all_fo_night_audits" on public.fo_night_audits
  for all to anon using (true) with check (true);

drop policy if exists "authenticated_all_fo_night_audits" on public.fo_night_audits;
create policy "authenticated_all_fo_night_audits" on public.fo_night_audits
  for all to authenticated using (true) with check (true);

-- ─── 4. Post one room night (atomic + idempotent) ──────────────────────────
-- Inserts the ROOM_NIGHT charge and adds amount/tax to the folio header in one
-- transaction. Individual folios also hold legacy amounts written straight to
-- subtotal, so the header is incremented rather than rebuilt from charges.
-- Returns {"posted": false} when the night was already charged.

create or replace function public.fo_post_room_night(
  p_reservation_id text,
  p_folio_id text,
  p_property_id text,
  p_guest_id text,
  p_business_date date,
  p_amount numeric,
  p_tax_amount numeric,
  p_tax_details jsonb,
  p_description text,
  p_created_by text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_id text;
  v_status text;
  v_charge_id text;
begin
  if p_reservation_id is null or p_folio_id is null or p_business_date is null then
    raise exception 'reservation, folio and business date are required' using errcode = 'P0001';
  end if;
  if coalesce(p_amount, 0) < 0 or coalesce(p_tax_amount, 0) < 0 then
    raise exception 'Room night amount and tax must be >= 0' using errcode = 'P0001';
  end if;

  v_source_id := p_reservation_id || ':' || to_char(p_business_date, 'YYYY-MM-DD');

  select status::text into v_status
  from public.folios
  where id = p_folio_id
  for update;

  if not found then
    raise exception 'Folio % not found', p_folio_id using errcode = 'P0002';
  end if;

  select id into v_charge_id
  from public.folio_charges
  where source_module = 'FRONT_OFFICE'
    and source_type = 'ROOM_NIGHT'
    and source_id = v_source_id
  limit 1;

  if v_charge_id is not null then
    return jsonb_build_object('posted', false, 'chargeId', v_charge_id);
  end if;

  if v_status <> 'OPEN' then
    raise exception 'Folio % is not open', p_folio_id using errcode = 'P0001';
  end if;

  insert into public.folio_charges (
    property_id, folio_id, reservation_id, booking_id, guest_id,
    charge_category, description, quantity, unit_price, amount,
    tax_amount, tax_details, business_date, responsibility,
    source_module, source_type, source_id, created_by
  ) values (
    p_property_id, p_folio_id, p_reservation_id, p_reservation_id, p_guest_id,
    'ROOM'::public.fo_charge_category, coalesce(p_description, ''), 1, p_amount, p_amount,
    coalesce(p_tax_amount, 0), p_tax_details, p_business_date, 'GUEST'::public.fo_billing_responsibility,
    'FRONT_OFFICE', 'ROOM_NIGHT', v_source_id, p_created_by
  )
  on conflict do nothing
  returning id into v_charge_id;

  if v_charge_id is null then
    select id into v_charge_id
    from public.folio_charges
    where source_module = 'FRONT_OFFICE'
      and source_type = 'ROOM_NIGHT'
      and source_id = v_source_id
    limit 1;
    return jsonb_build_object('posted', false, 'chargeId', v_charge_id);
  end if;

  update public.folios
  set
    subtotal = coalesce(subtotal, 0) + p_amount,
    tax_total = coalesce(tax_total, 0) + coalesce(p_tax_amount, 0),
    updated_at = now()
  where id = p_folio_id;

  return jsonb_build_object('posted', true, 'chargeId', v_charge_id);
end;
$$;

grant execute on function public.fo_post_room_night(
  text, text, text, text, date, numeric, numeric, jsonb, text, text
) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
