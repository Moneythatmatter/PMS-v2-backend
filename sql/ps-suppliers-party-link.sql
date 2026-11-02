-- Purchase & Stores vendors come from the Accounts Party Master.
-- Each ps_suppliers row is linked to one party of type Vendor (VEND).
-- Name, contact, GSTIN, PAN and address are owned by the party; Purchase keeps vendor code,
-- payment terms, rating and status.
--
-- Run after accounts-schema.sql and accounts-universal-party-types.sql.
-- Includes the Purchase & Stores property scoping from ps-property-scope.sql (existing rows go to Shaw Hotel).
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 0. Purchase & Stores property scoping (same as ps-property-scope.sql).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'ps_units', 'ps_categories', 'ps_suppliers', 'ps_products', 'ps_warehouses',
    'purchase_requisitions', 'purchase_requisition_items', 'ps_rfqs', 'ps_purchase_orders',
    'ps_direct_store_purchases', 'ps_rate_contracts', 'ps_invoices', 'ps_grns',
    'ps_quality_inspections', 'ps_vendor_returns', 'ps_stock_balances', 'ps_stock_ledger',
    'ps_stock_issues', 'ps_stock_transfers', 'ps_stock_adjustments', 'ps_par_stock', 'ps_batches'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('alter table public.%I add column if not exists property_id text', t);
    execute format('update public.%I set property_id = %L where property_id is null', t, 'prop-shaw-hotel');
    execute format('create index if not exists %I on public.%I (property_id)', t || '_property_id_idx', t);
  end loop;
end $$;

do $$
declare
  pair text[];
  pairs text[][] := array[
    array['ps_units', 'unit_code'],
    array['ps_categories', 'category_code'],
    array['ps_suppliers', 'supplier_code'],
    array['ps_products', 'product_code'],
    array['ps_warehouses', 'code']
  ];
  con record;
begin
  foreach pair slice 1 in array pairs loop
    if to_regclass('public.' || pair[1]) is null then
      continue;
    end if;
    for con in
      select c.conname
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.conrelid = ('public.' || pair[1])::regclass
        and c.contype = 'u'
        and array_length(c.conkey, 1) = 1
        and a.attname = pair[2]
    loop
      execute format('alter table public.%I drop constraint %I', pair[1], con.conname);
    end loop;
    execute format(
      'create unique index if not exists %I on public.%I (property_id, %I)',
      pair[1] || '_property_' || pair[2] || '_key', pair[1], pair[2]
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Vendor ↔ party link column.
-- ---------------------------------------------------------------------------
alter table public.ps_suppliers add column if not exists party_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ps_suppliers_party_id_fkey') then
    alter table public.ps_suppliers
      add constraint ps_suppliers_party_id_fkey
      foreign key (party_id) references public.acc_parties(id) on delete set null;
  end if;
end $$;

-- One vendor per party in a property.
create unique index if not exists ps_suppliers_property_party_key
  on public.ps_suppliers (property_id, party_id)
  where party_id is not null;

-- ---------------------------------------------------------------------------
-- 1. Link existing vendors to existing Vendor parties: first by GSTIN, then by name.
-- ---------------------------------------------------------------------------
with eligible as (
  select p.id, p.property_id, upper(trim(p.gstin)) as gstin
  from public.acc_parties p
  join public.acc_party_types t on t.id = p.party_type_id
  where t.type_code = 'VEND'
    and not exists (select 1 from public.ps_suppliers s2 where s2.party_id = p.id)
),
matches as (
  select distinct on (e.id) s.id as supplier_id, e.id as party_id
  from public.ps_suppliers s
  join eligible e
    on e.property_id = s.property_id
   and e.gstin <> ''
   and e.gstin = upper(trim(coalesce(s.gstin, '')))
  where s.party_id is null
  order by e.id, s.created_at
)
update public.ps_suppliers s
set party_id = m.party_id
from matches m
where s.id = m.supplier_id
  and not exists (select 1 from public.ps_suppliers s3 where s3.party_id = m.party_id);

with eligible as (
  select p.id, p.property_id, lower(trim(p.party_name)) as pname
  from public.acc_parties p
  join public.acc_party_types t on t.id = p.party_type_id
  where t.type_code = 'VEND'
    and not exists (select 1 from public.ps_suppliers s2 where s2.party_id = p.id)
),
matches as (
  select distinct on (e.id) s.id as supplier_id, e.id as party_id
  from public.ps_suppliers s
  join eligible e
    on e.property_id = s.property_id
   and e.pname = lower(trim(s.supplier_name))
  where s.party_id is null
  order by e.id, s.created_at
)
update public.ps_suppliers s
set party_id = m.party_id
from matches m
where s.id = m.supplier_id
  and not exists (select 1 from public.ps_suppliers s3 where s3.party_id = m.party_id);

-- ---------------------------------------------------------------------------
-- 2. Create a Vendor party for every vendor still unlinked (code PSV-<vendor code>).
--    The payable ledger comes from Company Settings → Default Payable Account.
-- ---------------------------------------------------------------------------
insert into public.acc_parties (
  property_id, party_code, party_name, short_name, party_type_id, party_sub_type_id,
  party_group, entity_type, email, phone, address_line1, city,
  contact_person_name, contact_person_phone, contact_person_email,
  gstin, pan_number, credit_days, payable_account_id, remarks, status
)
select
  s.property_id,
  'PSV-' || upper(s.supplier_code),
  s.supplier_name,
  left(s.supplier_name, 30),
  t.id,
  (
    select st.id from public.acc_party_sub_types st
    where st.property_id = s.property_id and st.party_type_id = t.id and st.status = 'Active'
    order by st.sequence, st.sub_type_name
    limit 1
  ),
  'Sundry Creditors',
  'Company',
  case when coalesce(s.email, '') ~ '^\S+@\S+\.\S+$' then s.email else '' end,
  coalesce(s.phone, ''),
  coalesce(s.address, ''),
  coalesce(s.city, ''),
  coalesce(s.contact_person, ''),
  coalesce(s.phone, ''),
  case when coalesce(s.email, '') ~ '^\S+@\S+\.\S+$' then s.email else '' end,
  case when upper(trim(coalesce(s.gstin, ''))) ~ '^[0-9]{2}[A-Z0-9]{13}$'
       then upper(trim(s.gstin)) else '' end,
  case when upper(trim(coalesce(s.pan_number, ''))) ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'
       then upper(trim(s.pan_number)) else '' end,
  coalesce(nullif(substring(coalesce(s.payment_terms, '') from '([0-9]+)'), '')::int, 0),
  (
    select cs.default_payable_account_id from public.acc_company_settings cs
    where cs.property_id = s.property_id and cs.default_payable_account_id is not null
    limit 1
  ),
  'Created from Purchase vendor ' || s.supplier_code,
  case when s.status = 'Active' then 'Active' else 'Inactive' end
from public.ps_suppliers s
join public.acc_party_types t
  on t.type_code = 'VEND'
where s.party_id is null
  and s.property_id is not null
on conflict (property_id, party_code) do nothing;

update public.ps_suppliers s
set party_id = p.id
from public.acc_parties p
where s.party_id is null
  and p.property_id = s.property_id
  and p.party_code = 'PSV-' || upper(s.supplier_code)
  and not exists (select 1 from public.ps_suppliers s3 where s3.party_id = p.id);

-- ---------------------------------------------------------------------------
-- 3. Refresh the Purchase copy of party details (the party is the source of truth).
-- ---------------------------------------------------------------------------
update public.ps_suppliers s
set supplier_name = p.party_name,
    contact_person = p.contact_person_name,
    email = coalesce(nullif(p.email, ''), p.contact_person_email),
    phone = coalesce(nullif(p.phone, ''), p.contact_person_phone),
    gstin = nullif(p.gstin, ''),
    pan_number = nullif(p.pan_number, ''),
    address = nullif(concat_ws(', ', nullif(p.address_line1, ''), nullif(p.address_line2, '')), ''),
    city = nullif(p.city, '')
from public.acc_parties p
where p.id = s.party_id;

notify pgrst, 'reload schema';

-- Check: vendors still not linked (should be 0).
-- select id, supplier_code, supplier_name, property_id from public.ps_suppliers where party_id is null;
