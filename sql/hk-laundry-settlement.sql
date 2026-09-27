-- Patch: laundry job billing columns + folio settle RPC
-- Run after housekeeping-schema.sql and hk-laundry-masters.sql

-- ========== Enrich hk_laundry_jobs for guest laundry billing ==========
alter table public.hk_laundry_jobs
  add column if not exists guest_phone text,
  add column if not exists folio_id text,
  add column if not exists booking_id text,
  add column if not exists guest_id text,
  add column if not exists urgency text default 'Normal',
  add column if not exists service_type text,
  add column if not exists expected_at timestamptz,
  add column if not exists subtotal numeric(14, 2) default 0,
  add column if not exists tax_amount numeric(14, 2) default 0,
  add column if not exists billing_status text not null default 'Unbilled',
  add column if not exists payment_mode text,
  add column if not exists paid_at timestamptz,
  add column if not exists cancelled boolean not null default false,
  add column if not exists is_outsourced boolean not null default false,
  add column if not exists line_items jsonb not null default '[]'::jsonb,
  add column if not exists updated_at timestamptz default now();

create index if not exists hk_laundry_jobs_booking_id_idx
  on public.hk_laundry_jobs (booking_id)
  where booking_id is not null;

create index if not exists hk_laundry_jobs_billing_status_idx
  on public.hk_laundry_jobs (billing_status);

create or replace function public.hk_laundry_jobs_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_hk_laundry_jobs_set_updated_at on public.hk_laundry_jobs;
create trigger trg_hk_laundry_jobs_set_updated_at
  before update on public.hk_laundry_jobs
  for each row
  execute function public.hk_laundry_jobs_set_updated_at();

-- Atomic folio (Room Charge) settlement for delivered guest laundry.
-- Posts ADJUSTMENT txn to folio, bumps reservations.laundry, marks job Folio.
create or replace function public.hk_settle_laundry_folio_charge(
  p_job_id text,
  p_booking_id text,
  p_guest_id text default null,
  p_amount numeric default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_job public.hk_laundry_jobs%rowtype;
  v_folio_id text;
  v_amount numeric(14, 2);
  v_notes text;
  v_txn public.transactions%rowtype;
  v_existing int;
begin
  if p_job_id is null or trim(p_job_id) = '' then
    raise exception 'job_id is required' using errcode = 'P0001';
  end if;
  if p_booking_id is null or trim(p_booking_id) = '' then
    raise exception 'booking_id is required' using errcode = 'P0001';
  end if;

  select * into v_job from public.hk_laundry_jobs where id = p_job_id for update;
  if not found then
    raise exception 'Laundry job not found' using errcode = 'P0002';
  end if;

  if coalesce(v_job.cancelled, false) then
    raise exception 'Cannot settle a cancelled laundry job' using errcode = 'P0001';
  end if;

  if coalesce(v_job.status, '') <> 'Delivered' then
    raise exception 'Laundry must be Delivered before settlement' using errcode = 'P0001';
  end if;

  if upper(coalesce(v_job.billing_status, 'Unbilled')) <> 'UNBILLED' then
    raise exception 'Laundry job is already settled / charged' using errcode = 'P0001';
  end if;

  if coalesce(v_job.type, 'Guest') <> 'Guest' then
    raise exception 'Folio charge is only for guest laundry' using errcode = 'P0001';
  end if;

  v_amount := coalesce(p_amount, v_job.charges, 0)::numeric(14, 2);
  if v_amount <= 0 then
    raise exception 'Settlement amount must be > 0' using errcode = 'P0001';
  end if;

  v_folio_id := public.ensure_folio_for_booking(p_booking_id, p_guest_id);

  select count(*) into v_existing
  from public.transactions t
  where t.folio_id = v_folio_id
    and t.source_module = 'HOUSEKEEPING'::public.transaction_source_module
    and t.source_type = 'LAUNDRY'
    and t.source_id = p_job_id
    and t.status = 'COMPLETED'::public.transaction_status;

  if v_existing > 0 then
    raise exception 'Laundry charge already posted for this job' using errcode = 'P0001';
  end if;

  v_notes := coalesce(
    nullif(trim(p_notes), ''),
    format('[LAUNDRY] charge — job %s · room %s', p_job_id, coalesce(v_job.room, '—'))
  );

  insert into public.transactions (
    transaction_type,
    payment_method,
    amount,
    currency,
    status,
    folio_id,
    booking_id,
    guest_id,
    source_module,
    source_type,
    source_id,
    notes
  ) values (
    'ADJUSTMENT'::public.transaction_type,
    'OTHER'::public.payment_method,
    v_amount,
    'INR',
    'COMPLETED'::public.transaction_status,
    v_folio_id,
    p_booking_id,
    nullif(trim(coalesce(p_guest_id, v_job.guest_id)), ''),
    'HOUSEKEEPING'::public.transaction_source_module,
    'LAUNDRY',
    p_job_id,
    v_notes
  )
  returning * into v_txn;

  update public.folios
  set subtotal = greatest(0, coalesce(subtotal, 0) + v_amount)
  where id = v_folio_id;

  update public.reservations
  set laundry = greatest(0, coalesce(laundry, 0) + v_amount)
  where id = p_booking_id;

  update public.hk_laundry_jobs
  set
    billing_status = 'Folio',
    payment_mode = 'Room Charge',
    paid_at = now(),
    folio_id = v_folio_id,
    booking_id = p_booking_id,
    guest_id = coalesce(nullif(trim(p_guest_id), ''), guest_id),
    updated_at = now()
  where id = p_job_id;

  return jsonb_build_object(
    'jobId', p_job_id,
    'folioId', v_folio_id,
    'transactionId', v_txn.id,
    'amount', v_amount,
    'billingStatus', 'Folio'
  );
end;
$$;

grant execute on function public.hk_settle_laundry_folio_charge(text, text, text, numeric, text)
  to anon, authenticated;

notify pgrst, 'schema cache';
