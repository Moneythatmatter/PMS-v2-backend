-- Patch: centralized purchase requisitions for every module.
--   purchase_requisitions        one header per request, tagged with source_module
--   purchase_requisition_items   one row per requested material (FK → ps_products)
-- Replaces ps_purchase_requisitions and its requested_items jsonb array. Existing
-- requisitions are kept; their array items are moved into purchase_requisition_items.
-- Run once in Supabase SQL Editor, then redeploy the backend. Safe to re-run.

begin;

do $$
begin
  if to_regclass('public.ps_purchase_requisitions') is not null
     and to_regclass('public.purchase_requisitions') is null then
    alter table public.ps_purchase_requisitions rename to purchase_requisitions;
  end if;
end $$;

create table if not exists public.purchase_requisitions (
  id text primary key default gen_random_uuid()::text,
  pr_number text not null unique,
  source_module text not null default 'Purchase & Stores',
  source_reference text not null default '',
  department text not null,
  requested_by text not null,
  request_date text not null,
  required_date text not null,
  priority text not null default 'Medium',
  cost_center text not null default '',
  delivery_warehouse_id text references public.ps_warehouses(id) on delete set null,
  estimated_amount numeric(14,2) not null default 0,
  current_approver text not null,
  status text not null default 'Draft',
  justification text not null default '',
  submitted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  rejection_reason text not null default '',
  approval_timeline jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  comments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.purchase_requisitions
  add column if not exists source_module text not null default 'Purchase & Stores',
  add column if not exists source_reference text not null default '',
  add column if not exists delivery_warehouse_id text references public.ps_warehouses(id) on delete set null,
  add column if not exists submitted_at timestamptz,
  add column if not exists approved_by text,
  add column if not exists approved_at timestamptz,
  add column if not exists rejection_reason text not null default '';

create table if not exists public.purchase_requisition_items (
  id text primary key default gen_random_uuid()::text,
  requisition_id text not null references public.purchase_requisitions(id) on delete cascade,
  line_no integer not null default 1,
  material_id text references public.ps_products(id) on delete restrict,
  product_code text not null default '',
  item_name text not null,
  category text not null default '',
  unit text not null default '',
  requested_qty numeric(14,3) not null check (requested_qty > 0),
  approved_qty numeric(14,3) check (approved_qty is null or approved_qty >= 0),
  ordered_qty numeric(14,3) not null default 0,
  received_qty numeric(14,3) not null default 0,
  stock_on_hand numeric(14,3),
  estimated_rate numeric(14,2) not null default 0,
  estimated_amount numeric(16,2) generated always as (round(requested_qty * estimated_rate, 2)) stored,
  required_date text,
  remarks text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pr_items_requisition on public.purchase_requisition_items(requisition_id, line_no);
create index if not exists idx_pr_items_material on public.purchase_requisition_items(material_id);
create index if not exists idx_purchase_requisitions_source on public.purchase_requisitions(source_module, status);

-- One-time move of the legacy jsonb array into child rows. Legacy item ids are kept
-- when unique, so PO lines that reference them (prItemId) stay linked.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_requisitions' and column_name = 'requested_items'
  ) then
    update public.purchase_requisitions set source_module = case
      when department ilike '%house%' then 'Housekeeping'
      when department ilike '%kitchen%' or department ilike '%culinary%' then 'Kitchen'
      when department ilike '%f&b%' or department ilike '%food%' or department ilike '%beverage%' then 'Food & Beverage'
      when department ilike '%engineer%' or department ilike '%mainten%' then 'Maintenance'
      when department ilike '%front%' then 'Front Office'
      when department ilike '%human%' or department ilike 'hr%' then 'Human Resources'
      when department ilike '%account%' or department ilike '%finance%' then 'Accounts'
      when department ilike '%sales%' or department ilike '%marketing%' then 'Sales & Marketing'
      when department ilike '%security%' then 'Security'
      else 'Purchase & Stores'
    end;

    with lines as (
      select
        pr.id as requisition_id,
        li.ordinality::int as line_no,
        li.value as v,
        nullif(trim(li.value->>'id'), '') as legacy_id
      from public.purchase_requisitions pr
      cross join lateral jsonb_array_elements(coalesce(pr.requested_items, '[]'::jsonb))
        with ordinality as li(value, ordinality)
    ),
    keyed as (
      select l.*, count(*) over (partition by l.legacy_id) as id_uses from lines l
    )
    insert into public.purchase_requisition_items (
      id, requisition_id, line_no, material_id, product_code, item_name, category, unit,
      requested_qty, estimated_rate, remarks
    )
    select
      case when k.legacy_id is not null and k.id_uses = 1 then k.legacy_id else gen_random_uuid()::text end,
      k.requisition_id,
      k.line_no,
      coalesce(p_id.id, p_code.id),
      coalesce(nullif(k.v->>'productCode', ''), p_id.product_code, p_code.product_code, ''),
      coalesce(nullif(k.v->>'item', ''), p_id.product_name, p_code.product_name, 'Item ' || k.line_no),
      coalesce(nullif(k.v->>'category', ''), p_id.category, p_code.category, ''),
      coalesce(nullif(k.v->>'unit', ''), p_id.unit, p_code.unit, ''),
      greatest(coalesce(nullif(k.v->>'quantity', '')::numeric, 1), 0.001),
      coalesce(nullif(k.v->>'estimatedPrice', '')::numeric, 0),
      coalesce(k.v->>'remarks', '')
    from keyed k
    left join public.ps_products p_id on p_id.id = k.v->>'materialId'
    left join public.ps_products p_code
      on p_id.id is null and p_code.product_code = nullif(k.v->>'productCode', '')
    on conflict (id) do nothing;

    update public.purchase_requisitions pr
    set estimated_amount = t.amount
    from (
      select requisition_id, sum(estimated_amount) as amount
      from public.purchase_requisition_items group by requisition_id
    ) t
    where t.requisition_id = pr.id;

    alter table public.purchase_requisitions drop column requested_items;
  end if;
end $$;

alter table public.purchase_requisitions drop constraint if exists purchase_requisitions_source_module_check;
alter table public.purchase_requisitions add constraint purchase_requisitions_source_module_check
  check (source_module in (
    'Front Office', 'Housekeeping', 'Food & Beverage', 'Kitchen', 'Maintenance',
    'Human Resources', 'Accounts', 'Sales & Marketing', 'Security', 'Purchase & Stores'
  ));

-- RLS (anon access — same pattern as the other Purchase & Stores tables)
drop policy if exists "anon_all_ps_purchase_requisitions" on public.purchase_requisitions;
do $$
declare
  t text;
begin
  foreach t in array array['purchase_requisitions', 'purchase_requisition_items']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "anon_all_%s" on public.%I', t, t);
    execute format(
      'create policy "anon_all_%s" on public.%I for all to anon using (true) with check (true)',
      t, t
    );
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
