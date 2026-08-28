-- Purchase & Stores module schema (UUID text primary keys)
-- Run in Supabase SQL Editor after pgcrypto extension is enabled.
-- Idempotent: safe to re-run.

create extension if not exists pgcrypto;

-- ─── Masters ───────────────────────────────────────────────────────────────

create table if not exists ps_units (
  id text primary key default gen_random_uuid()::text,
  unit_code text not null unique,
  unit_name text not null,
  symbol text not null,
  description text,
  status text not null default 'Active',
  created_date text not null default to_char(now(), 'YYYY-MM-DD'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ps_categories (
  id text primary key default gen_random_uuid()::text,
  category_code text not null unique,
  category_name text not null,
  department text not null,
  description text,
  product_count integer not null default 0,
  status text not null default 'Active',
  created_date text not null default to_char(now(), 'YYYY-MM-DD'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ps_suppliers (
  id text primary key default gen_random_uuid()::text,
  supplier_code text not null unique,
  supplier_name text not null,
  contact_person text not null,
  phone text not null,
  email text not null,
  gstin text,
  pan_number text,
  payment_terms text not null default 'Net 30 Days',
  address text,
  city text,
  rating numeric(2,1) not null default 3,
  status text not null default 'Active',
  created_date text not null default to_char(now(), 'YYYY-MM-DD'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ps_products (
  id text primary key default gen_random_uuid()::text,
  product_code text not null unique,
  product_name text not null,
  category text not null,
  unit text not null,
  brand text,
  description text,
  product_image text,
  preferred_supplier text not null,
  purchase_price numeric(12,2) not null default 0,
  gst_percent numeric(5,2) not null default 0,
  hsn_code text,
  tax_type text not null default 'Exclusive',
  minimum_stock integer not null default 0,
  maximum_stock integer not null default 0,
  par_stock integer not null default 0,
  reorder_level integer not null default 0,
  shelf_location text,
  storage_type text not null default 'Dry Storage',
  status text not null default 'Active',
  created_date text not null default to_char(now(), 'YYYY-MM-DD'),
  updated_date text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ps_warehouses (
  id text primary key default gen_random_uuid()::text,
  code text not null unique,
  name text not null,
  type text not null default 'Warehouse',
  location text not null,
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Procurement documents ─────────────────────────────────────────────────

create table if not exists ps_purchase_requisitions (
  id text primary key default gen_random_uuid()::text,
  pr_number text not null unique,
  department text not null,
  requested_by text not null,
  request_date text not null,
  required_date text not null,
  priority text not null default 'Medium',
  cost_center text not null,
  estimated_amount numeric(14,2) not null default 0,
  current_approver text not null,
  status text not null default 'Draft',
  justification text not null default '',
  requested_items jsonb not null default '[]'::jsonb,
  approval_timeline jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  comments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ps_rfqs (
  id text primary key default gen_random_uuid()::text,
  rfq_number text not null unique,
  linked_pr text,
  department text not null,
  buyer text not null,
  invited_vendors jsonb not null default '[]'::jsonb,
  closing_date text not null,
  rfq_date text not null,
  selected_vendor text,
  po_number text,
  status text not null default 'Draft',
  priority text not null default 'Medium',
  requested_items jsonb not null default '[]'::jsonb,
  commercial_terms jsonb not null default '{}'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  comparison_data jsonb not null default '[]'::jsonb,
  activity_timeline jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ps_purchase_orders (
  id text primary key default gen_random_uuid()::text,
  po_number text not null unique,
  order_date text not null,
  linked_pr text,
  linked_rfq text,
  department text not null,
  buyer_name text not null,
  vendor_name text not null,
  contact_person text not null,
  gstin text not null,
  vendor_address text not null,
  vendor_phone text not null,
  ship_to_warehouse text not null,
  dock_gate text not null,
  expected_delivery_date text not null,
  freight_terms text not null,
  payment_terms text not null,
  payment_due_days integer not null default 30,
  discount_percent numeric(5,2) not null default 0,
  currency text not null default 'INR',
  tax_terms text not null,
  sub_total numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  status text not null default 'Draft',
  items jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  approval_history jsonb not null default '[]'::jsonb,
  activity_timeline jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ps_direct_store_purchases (
  id text primary key default gen_random_uuid()::text,
  dsp_number text not null unique,
  purchase_date text not null,
  department text not null,
  requester_name text not null,
  payment_type text not null,
  vendor_name text not null,
  gstin text,
  receipt_number text,
  contact_number text,
  vendor_address text,
  store_location text not null,
  receiving_date text not null,
  received_by text not null,
  storage_bin text,
  payment_mode text,
  transaction_ref text,
  tax_amount numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  status text not null default 'Draft',
  created_by text not null,
  remarks text,
  items jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  activity_timeline jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ps_rate_contracts (
  id text primary key default gen_random_uuid()::text,
  contract_number text not null unique,
  vendor_name text not null,
  contract_type text not null,
  start_date text not null,
  end_date text not null,
  status text not null default 'Draft',
  contract_value numeric(14,2) not null default 0,
  renewal_notice_days integer not null default 30,
  max_cap_value numeric(14,2) not null default 0,
  contact_person text not null,
  phone text not null,
  email text not null,
  tax_id text,
  price_escalation_clause text,
  payment_terms text not null,
  penalty_terms text,
  special_conditions text,
  termination_notice text,
  warranty_terms text,
  approver_name text,
  approval_level text,
  items jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  activity_timeline jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ps_invoices (
  id text primary key default gen_random_uuid()::text,
  invoice_number text not null unique,
  invoice_date text not null,
  vendor_name text not null,
  gstin text not null,
  po_number text not null,
  grn_number text not null,
  grn_date text not null,
  tax_invoice_number text,
  buyer_name text not null,
  department text not null,
  payment_due_date text not null,
  po_value numeric(14,2) not null default 0,
  invoice_amount numeric(14,2) not null default 0,
  po_amount numeric(14,2) not null default 0,
  grn_amount numeric(14,2) not null default 0,
  status text not null default 'Draft',
  verification_result text not null default 'Pending',
  match_lines jsonb not null default '[]'::jsonb,
  exceptions jsonb not null default '[]'::jsonb,
  comments text,
  attachments jsonb not null default '[]'::jsonb,
  approval_signoff jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Receiving ─────────────────────────────────────────────────────────────

create table if not exists ps_grns (
  id text primary key default gen_random_uuid()::text,
  grn_number text not null unique,
  receipt_date text not null,
  po_number text not null,
  supplier_name text not null,
  warehouse text not null,
  item_count integer not null default 0,
  received_by text not null,
  invoice_number text,
  vehicle_number text,
  delivery_challan text,
  total_amount numeric(14,2) not null default 0,
  inspection_status text not null default 'Pending',
  status text not null default 'Pending',
  remarks text,
  items jsonb not null default '[]'::jsonb,
  inspection_details jsonb,
  attachments jsonb not null default '[]'::jsonb,
  logs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ps_quality_inspections (
  id text primary key default gen_random_uuid()::text,
  inspection_number text not null unique,
  inspection_date text not null,
  grn_number text not null,
  po_number text not null,
  supplier_name text not null,
  warehouse text not null,
  inspector_name text not null,
  items_inspected_count integer,
  items_count integer,
  result text not null default 'Pending',
  status text not null default 'Pending',
  inspection_type text not null,
  priority text not null default 'Medium',
  age text,
  is_overdue boolean default false,
  general_remarks text,
  remarks text,
  items jsonb not null default '[]'::jsonb,
  checklist jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ps_vendor_returns (
  id text primary key default gen_random_uuid()::text,
  return_number text not null unique,
  return_date text not null,
  supplier_name text not null,
  grn_number text not null,
  inspection_number text not null,
  po_number text not null,
  warehouse text not null,
  items_returned_count integer not null default 0,
  return_reason text not null,
  status text not null default 'Pending Pickup',
  transport_details text,
  remarks text,
  items jsonb not null default '[]'::jsonb,
  replacement_details jsonb,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Inventory ───────────────────────────────────────────────────────────────

create table if not exists ps_stock_balances (
  id text primary key default gen_random_uuid()::text,
  material_id text not null references ps_products(id) on delete restrict,
  warehouse_id text not null references ps_warehouses(id) on delete restrict,
  quantity numeric(14,3) not null default 0,
  average_cost numeric(14,2) not null default 0,
  last_movement_at text not null,
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (material_id, warehouse_id)
);

create table if not exists ps_stock_ledger (
  id text primary key default gen_random_uuid()::text,
  transaction_date text not null,
  transaction_no text not null,
  movement_type text not null,
  material_id text not null references ps_products(id) on delete restrict,
  warehouse_id text not null references ps_warehouses(id) on delete restrict,
  quantity_in numeric(14,3) not null default 0,
  quantity_out numeric(14,3) not null default 0,
  balance_qty numeric(14,3) not null default 0,
  remarks text,
  created_at timestamptz not null default now()
);

create table if not exists ps_stock_issues (
  id text primary key default gen_random_uuid()::text,
  issue_no text not null unique,
  issue_date text not null,
  department text not null,
  warehouse text not null,
  store text not null,
  requested_by text not null,
  issued_by text,
  approved_by text,
  status text not null default 'Draft',
  purpose text not null,
  remarks text,
  line_items jsonb not null default '[]'::jsonb,
  total_value numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ps_stock_transfers (
  id text primary key default gen_random_uuid()::text,
  transfer_no text not null unique,
  transfer_date text not null,
  from_warehouse text not null,
  from_store text not null,
  to_warehouse text not null,
  to_store text not null,
  requested_by text not null,
  dispatched_by text,
  received_by text,
  status text not null default 'Draft',
  reason text not null,
  remarks text,
  line_items jsonb not null default '[]'::jsonb,
  total_value numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ps_stock_adjustments (
  id text primary key default gen_random_uuid()::text,
  adjustment_no text not null unique,
  adjustment_date text not null,
  material_id text not null references ps_products(id) on delete restrict,
  warehouse_id text not null references ps_warehouses(id) on delete restrict,
  system_qty numeric(14,3) not null default 0,
  actual_qty numeric(14,3) not null default 0,
  difference numeric(14,3) not null default 0,
  reason text not null,
  requested_by text not null,
  approved_by text,
  status text not null default 'Draft',
  ledger_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ps_par_stock (
  id text primary key default gen_random_uuid()::text,
  item_code text not null,
  item_name text not null,
  category text not null,
  unit text not null,
  warehouse text not null,
  store text not null,
  current_stock numeric(14,3) not null default 0,
  par_level numeric(14,3) not null default 0,
  min_level numeric(14,3) not null default 0,
  max_level numeric(14,3) not null default 0,
  reorder_level numeric(14,3) not null default 0,
  status text not null default 'OK',
  last_issued_date text,
  last_received_date text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ps_batches (
  id text primary key default gen_random_uuid()::text,
  batch_number text not null,
  item_code text not null,
  item_name text not null,
  category text not null,
  warehouse text not null,
  zone text not null,
  rack text not null,
  shelf text not null,
  bin text not null,
  supplier text not null,
  grn_number text not null,
  po_number text not null,
  mfg_date text not null,
  expiry_date text not null,
  total_shelf_life_days integer not null default 0,
  days_remaining integer not null default 0,
  available_qty numeric(14,3) not null default 0,
  reserved_qty numeric(14,3) not null default 0,
  issued_qty numeric(14,3) not null default 0,
  unit_cost numeric(14,2) not null default 0,
  stock_value numeric(14,2) not null default 0,
  unit text not null,
  qr_code text,
  barcode text,
  status text not null default 'Fresh',
  is_fefo_recommended boolean not null default false,
  quality_passed boolean not null default true,
  movements jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ps_stock_ledger_material on ps_stock_ledger(material_id);
create index if not exists idx_ps_stock_ledger_warehouse on ps_stock_ledger(warehouse_id);
create index if not exists idx_ps_stock_balances_material on ps_stock_balances(material_id);
create index if not exists idx_ps_grns_po on ps_grns(po_number);

-- ========== RLS (anon access — same pattern as FO / HK / F&B) ==========
do $$
declare
  t text;
begin
  foreach t in array array[
    'ps_units','ps_categories','ps_suppliers','ps_products','ps_warehouses',
    'ps_purchase_requisitions','ps_rfqs','ps_purchase_orders','ps_direct_store_purchases',
    'ps_rate_contracts','ps_invoices','ps_grns','ps_quality_inspections','ps_vendor_returns',
    'ps_stock_balances','ps_stock_ledger','ps_stock_issues','ps_stock_transfers',
    'ps_stock_adjustments','ps_par_stock','ps_batches'
  ]
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
