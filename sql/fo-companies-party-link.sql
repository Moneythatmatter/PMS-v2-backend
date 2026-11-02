-- Front Office companies come from the Accounts Party Master.
-- Each FO company is linked to one party of type Corporate (CORP).
-- Name, contact, GST, address and credit limit are owned by the party; FO keeps code, booking type,
-- corporate discount and status.
--
-- Run after accounts-schema.sql, accounts-universal-party-types.sql and multi-property-schema.sql.
-- Safe to run more than once.

alter table public.companies add column if not exists party_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'companies_party_id_fkey') then
    alter table public.companies
      add constraint companies_party_id_fkey
      foreign key (party_id) references public.acc_parties(id) on delete set null;
  end if;
end $$;

-- One FO company per party in a property.
create unique index if not exists companies_property_party_key
  on public.companies (property_id, party_id)
  where party_id is not null;

-- ---------------------------------------------------------------------------
-- 1. Link existing FO companies to existing parties: first by GSTIN, then by name.
-- ---------------------------------------------------------------------------
with eligible as (
  select p.id, p.property_id, upper(trim(p.gstin)) as gstin, lower(trim(p.party_name)) as pname
  from public.acc_parties p
  join public.acc_party_types t on t.id = p.party_type_id
  where t.type_code = 'CORP'
    and not exists (select 1 from public.companies c2 where c2.party_id = p.id)
),
matches as (
  select distinct on (e.id) c.id as company_id, e.id as party_id
  from public.companies c
  join eligible e
    on e.property_id = c.property_id
   and e.gstin <> ''
   and e.gstin = upper(trim(coalesce(c.gst_number, '')))
  where c.party_id is null
  order by e.id, c.created_at
)
update public.companies c
set party_id = m.party_id
from matches m
where c.id = m.company_id
  and not exists (select 1 from public.companies c3 where c3.party_id = m.party_id);

with eligible as (
  select p.id, p.property_id, lower(trim(p.party_name)) as pname
  from public.acc_parties p
  join public.acc_party_types t on t.id = p.party_type_id
  where t.type_code = 'CORP'
    and not exists (select 1 from public.companies c2 where c2.party_id = p.id)
),
matches as (
  select distinct on (e.id) c.id as company_id, e.id as party_id
  from public.companies c
  join eligible e
    on e.property_id = c.property_id
   and e.pname = lower(trim(c.name))
  where c.party_id is null
  order by e.id, c.created_at
)
update public.companies c
set party_id = m.party_id
from matches m
where c.id = m.company_id
  and not exists (select 1 from public.companies c3 where c3.party_id = m.party_id);

-- ---------------------------------------------------------------------------
-- 2. Create a party for every FO company still unlinked (code FOC-<company code>).
--    All of them become Corporate (CORP) parties.
--    The receivable ledger comes from Company Settings → Default Receivable Account.
-- ---------------------------------------------------------------------------
insert into public.acc_parties (
  property_id, party_code, party_name, short_name, party_type_id, party_sub_type_id,
  party_group, entity_type, email, phone, address_line1, city,
  contact_person_name, contact_person_phone, contact_person_email,
  gstin, credit_limit, receivable_account_id, remarks, status
)
select
  c.property_id,
  'FOC-' || upper(c.code),
  c.name,
  left(c.name, 30),
  t.id,
  (
    select st.id from public.acc_party_sub_types st
    where st.property_id = c.property_id and st.party_type_id = t.id and st.status = 'Active'
    order by st.sequence, st.sub_type_name
    limit 1
  ),
  'Sundry Debtors',
  case when c.type = 'Government' then 'Government' else 'Company' end,
  case when coalesce(c.email, '') ~ '^\S+@\S+\.\S+$' then c.email else '' end,
  coalesce(c.phone, ''),
  case when coalesce(c.address, '') in ('', '—') then '' else c.address end,
  case when coalesce(c.city, '') in ('', '—') then '' else c.city end,
  coalesce(c.contact_person, ''),
  coalesce(c.phone, ''),
  case when coalesce(c.email, '') ~ '^\S+@\S+\.\S+$' then c.email else '' end,
  case when upper(trim(coalesce(c.gst_number, ''))) ~ '^[0-9]{2}[A-Z0-9]{13}$'
       then upper(trim(c.gst_number)) else '' end,
  greatest(coalesce(c.credit_limit, 0), 0),
  (
    select s.default_receivable_account_id from public.acc_company_settings s
    where s.property_id = c.property_id and s.default_receivable_account_id is not null
    limit 1
  ),
  'Created from Front Office company ' || c.code,
  case when c.status = 'Active' then 'Active' else 'Inactive' end
from public.companies c
join public.acc_party_types t
  on t.type_code = 'CORP'
where c.party_id is null
  and c.property_id is not null
on conflict (property_id, party_code) do nothing;

update public.companies c
set party_id = p.id
from public.acc_parties p
where c.party_id is null
  and p.property_id = c.property_id
  and p.party_code = 'FOC-' || upper(c.code)
  and not exists (select 1 from public.companies c3 where c3.party_id = p.id);

-- ---------------------------------------------------------------------------
-- 3. Refresh the FO copy of party details (the party is the source of truth).
-- ---------------------------------------------------------------------------
update public.companies c
set name = p.party_name,
    contact_person = p.contact_person_name,
    email = p.email,
    phone = coalesce(nullif(p.phone, ''), p.contact_person_phone),
    gst_number = nullif(p.gstin, ''),
    address = concat_ws(', ', nullif(p.address_line1, ''), nullif(p.address_line2, '')),
    city = p.city,
    credit_limit = p.credit_limit
from public.acc_parties p
where p.id = c.party_id;

notify pgrst, 'reload schema';

-- Check: companies still not linked (should be 0).
-- select id, code, name, property_id from public.companies where party_id is null;
