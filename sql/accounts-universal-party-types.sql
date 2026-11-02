-- Universal party types: one fixed list shared by every property.
-- Posting / mapping logic reads type_code only, so codes are fixed and never typed by users.
-- Existing per-property types are mapped to the shared list by code (unknown codes -> OTHER),
-- and party sub types / parties are re-pointed. Party sub types stay per property.
-- Run after accounts-schema.sql. Safe to re-run.

-- 1. Move the old per-property table aside (only if it still has property_id)
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'acc_party_types' and column_name = 'property_id'
  ) then
    alter table public.acc_party_types rename to acc_party_types_legacy;
    alter table public.acc_party_types_legacy rename constraint acc_party_types_code_unique to acc_party_types_legacy_code_unique;
    alter table public.acc_party_types_legacy rename constraint acc_party_types_pkey to acc_party_types_legacy_pkey;
  end if;
end $$;

-- 2. Shared table + fixed list
create table if not exists public.acc_party_types (
  id uuid primary key default gen_random_uuid(),
  type_code text not null,
  type_name text not null,
  description text not null default '',
  sequence int not null default 1,
  is_system boolean not null default true,
  status text not null default 'Active' check (status in ('Active','Inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_party_types_code_unique unique (type_code)
);

insert into public.acc_party_types (type_code, type_name, description, sequence) values
  ('CUST',  'Customer / Guest',    'Individual guests and city ledger customers', 1),
  ('CORP',  'Corporate',           'Corporate clients with credit facility',      2),
  ('TA',    'Travel Agent',        'Offline travel agents and tour operators',    3),
  ('OTA',   'Online Travel Agent', 'Online booking channels',                     4),
  ('CC',    'Credit Card Company', 'Card acquirers and payment aggregators',      5),
  ('VEND',  'Vendor',              'Suppliers and service providers',             6),
  ('EMP',   'Employee',            'Staff advances and reimbursements',           7),
  ('OTHER', 'Other',               'Anything not covered above',                  8)
on conflict (type_code) do update
  set type_name = excluded.type_name,
      description = excluded.description,
      sequence = excluded.sequence,
      is_system = true;

-- 3. Re-point sub types and parties from the old per-property rows, then drop them
do $$
declare
  v_other uuid;
begin
  if to_regclass('public.acc_party_types_legacy') is null then
    return;
  end if;

  select id into v_other from public.acc_party_types where type_code = 'OTHER';

  create temp table pt_map as
  select l.id as old_id, coalesce(n.id, v_other) as new_id
    from public.acc_party_types_legacy l
    left join public.acc_party_types n
      on n.type_code = case upper(trim(l.type_code))
                         when 'GUEST' then 'CUST'
                         when 'CUSTOMER' then 'CUST'
                         when 'CORPORATE' then 'CORP'
                         when 'TRAVELAGENT' then 'TA'
                         when 'TRAVEL_AGENT' then 'TA'
                         when 'AGENT' then 'TA'
                         when 'CARD' then 'CC'
                         when 'VENDOR' then 'VEND'
                         when 'SUPPLIER' then 'VEND'
                         when 'EMPLOYEE' then 'EMP'
                         when 'STAFF' then 'EMP'
                         else upper(trim(l.type_code))
                       end;

  alter table public.acc_party_sub_types drop constraint if exists acc_party_sub_types_party_type_id_fkey;
  alter table public.acc_parties drop constraint if exists acc_parties_party_type_id_fkey;

  update public.acc_party_sub_types s set party_type_id = m.new_id from pt_map m where s.party_type_id = m.old_id;
  update public.acc_parties p set party_type_id = m.new_id from pt_map m where p.party_type_id = m.old_id;

  drop table pt_map;
  drop table public.acc_party_types_legacy;
end $$;

-- Online-agent sub type belongs under the new OTA type; parties follow their sub type
update public.acc_party_sub_types
   set party_type_id = (select id from public.acc_party_types where type_code = 'OTA')
 where upper(sub_type_code) = 'OTA';

update public.acc_parties p
   set party_type_id = s.party_type_id
  from public.acc_party_sub_types s
 where p.party_sub_type_id = s.id
   and p.party_type_id is distinct from s.party_type_id;

-- 4. Foreign keys to the shared table
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'acc_party_sub_types_party_type_id_fkey') then
    alter table public.acc_party_sub_types
      add constraint acc_party_sub_types_party_type_id_fkey
      foreign key (party_type_id) references public.acc_party_types(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'acc_parties_party_type_id_fkey') then
    alter table public.acc_parties
      add constraint acc_parties_party_type_id_fkey
      foreign key (party_type_id) references public.acc_party_types(id) on delete set null;
  end if;
end $$;

-- 5. updated_at trigger + RLS (same as other accounts tables)
drop trigger if exists acc_party_types_touch on public.acc_party_types;
create trigger acc_party_types_touch before update on public.acc_party_types
  for each row execute function public.acc_touch_updated_at();

alter table public.acc_party_types enable row level security;
drop policy if exists "anon_all_acc_party_types" on public.acc_party_types;
create policy "anon_all_acc_party_types" on public.acc_party_types
  for all to anon using (true) with check (true);

notify pgrst, 'reload schema';
