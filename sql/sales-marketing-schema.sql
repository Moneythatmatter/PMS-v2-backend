-- Sales & Marketing module schema (property-scoped)
-- Run in Supabase SQL editor, then sales-marketing-rls-patch.sql

-- ─── Masters ───────────────────────────────────────────────────────────────

create table if not exists sm_venues (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  venue_code text not null,
  venue_name text not null,
  venue_type text not null default 'Banquet Hall',
  minimum_capacity integer not null default 0,
  maximum_capacity integer not null default 100,
  location text default '',
  status text not null default 'Active',
  description text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, venue_code)
);

create table if not exists sm_lead_sources (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  source_code text not null,
  source_name text not null,
  category text not null default 'Direct',
  status text not null default 'Active',
  description text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, source_code)
);

create table if not exists sm_activity_types (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  activity_type_code text not null,
  type_name text not null,
  category text not null default 'Communication',
  status text not null default 'Active',
  description text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, activity_type_code)
);

create table if not exists sm_deal_stages (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  stage_code text not null,
  stage_name text not null,
  sequence integer not null default 1,
  status text not null default 'Active',
  description text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, stage_code)
);

create table if not exists sm_contact_types (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  contact_type_code text not null,
  contact_type_name text not null,
  status text not null default 'Active',
  description text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, contact_type_code)
);

create table if not exists sm_booking_types (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  code text not null,
  is_system boolean not null default false,
  central_type text not null,
  lead_type text not null,
  card_label text not null,
  short_label text not null,
  description text default '',
  beo_required boolean not null default false,
  handover_note text,
  icon_key text not null default 'calendar',
  sort_order integer not null default 1,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, code)
);

-- ─── Contacts ──────────────────────────────────────────────────────────────

create table if not exists sm_contacts (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  contact_code text not null,
  contact_name text not null,
  contact_type text not null default 'Individual',
  contact_category text default 'Guest',
  company_name text,
  mobile text not null,
  email text,
  city text,
  status text not null default 'Active',
  created_from text default 'Manual Entry',
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, contact_code)
);

-- ─── Leads ─────────────────────────────────────────────────────────────────

create table if not exists sm_leads (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  lead_code text not null,
  lead_name text not null,
  contact_person text not null,
  mobile_number text not null,
  email text,
  company_name text,
  city text,
  preferred_contact_method text default 'Phone Call',
  booking_type text not null,
  event_date date,
  guest_count integer default 0,
  estimated_revenue numeric(14,2) default 0,
  budget_range text,
  priority text not null default 'Medium',
  customer_requirements text default '',
  lead_source text not null default 'Walk-In',
  campaign_id text,
  campaign_name text,
  promotion_code text,
  promotion_name text,
  imported_via text not null default 'Manual Entry',
  assigned_executive text not null default '',
  status text not null default 'New',
  pipeline_stage text default 'Qualification',
  linked_deal_id text,
  linked_deal_stage text,
  timeline jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, lead_code)
);

-- ─── Deals ─────────────────────────────────────────────────────────────────

create table if not exists sm_deals (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  deal_code text not null,
  deal_name text not null,
  lead_id text references sm_leads(id) on delete set null,
  contact_id text references sm_contacts(id) on delete set null,
  customer_name text not null,
  company_name text,
  mobile text,
  email text,
  booking_type text,
  stage text not null default 'Qualification',
  status text not null default 'Open',
  deal_value numeric(14,2) default 0,
  expected_close_date date,
  assigned_executive text,
  campaign_id text,
  campaign_name text,
  notes text default '',
  booking_created boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, deal_code)
);

-- ─── Activities ──────────────────────────────────────────────────────────────

create table if not exists sm_activities (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  activity_code text not null,
  activity_type text not null,
  priority text not null default 'Medium',
  deal_id text references sm_deals(id) on delete set null,
  lead_id text references sm_leads(id) on delete set null,
  deal_name text,
  lead_name text,
  customer_name text not null,
  company_name text,
  contact_person text,
  mobile_number text,
  email text,
  pipeline_stage text,
  activity_date date not null,
  activity_time text,
  assigned_executive text,
  status text not null default 'Scheduled',
  venue_required text,
  purpose text,
  outcome_notes text,
  outcome text,
  completed_at timestamptz,
  next_action text,
  next_action_date date,
  timeline jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, activity_code)
);

-- ─── Bookings ────────────────────────────────────────────────────────────────

create table if not exists sm_bookings (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  booking_code text not null,
  booking_type text not null,
  booking_category text not null default 'Wedding',
  booking_name text not null,
  contact_id text references sm_contacts(id) on delete set null,
  customer_name text not null,
  company_name text,
  mobile text not null,
  email text,
  deal_id text references sm_deals(id) on delete set null,
  lead_id text references sm_leads(id) on delete set null,
  campaign_id text,
  promotion_id text,
  created_from text not null default 'Direct Walk-In',
  start_date date not null,
  end_date date,
  start_time text,
  end_time text,
  venue_id text references sm_venues(id) on delete set null,
  venue_or_room text not null default '',
  guest_count integer default 0,
  room_count integer default 0,
  contract_value numeric(14,2) not null default 0,
  advance_received numeric(14,2) not null default 0,
  balance_due numeric(14,2) not null default 0,
  payment_status text not null default 'Pending Advance',
  status text not null default 'Tentative',
  beo_required boolean not null default false,
  beo_id text,
  beo_status text,
  handover_status text default 'Not Required',
  coordinator_name text,
  coordinator_mobile text,
  notes text default '',
  timeline jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, booking_code)
);

create index if not exists sm_leads_property_status_idx on sm_leads (property_id, status);
create index if not exists sm_deals_property_stage_idx on sm_deals (property_id, stage);
create index if not exists sm_bookings_property_status_idx on sm_bookings (property_id, status);
create index if not exists sm_activities_property_date_idx on sm_activities (property_id, activity_date);

notify pgrst, 'reload schema';
