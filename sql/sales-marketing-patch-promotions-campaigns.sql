-- Sales & Marketing — promotions, campaigns, OTA channels + deal metadata
-- Run AFTER sales-marketing-schema.sql

alter table sm_deals add column if not exists lead_source text;
alter table sm_deals add column if not exists customer_requirement text default '';
alter table sm_deals add column if not exists guest_count integer default 0;
alter table sm_deals add column if not exists expected_event_date date;
alter table sm_deals add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists sm_promotions (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  promo_scheme_code text not null,
  name text not null,
  promo_code text not null,
  description text default '',
  applicable_to text not null default 'Rooms',
  discount_type text not null default 'Percentage',
  discount_value numeric(14,2) not null default 0,
  min_spend numeric(14,2),
  min_nights integer,
  start_date date not null,
  end_date date not null,
  status text not null default 'Active',
  usage_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, promo_scheme_code),
  unique (property_id, promo_code)
);

create table if not exists sm_campaigns (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  campaign_code text not null,
  campaign_name text not null,
  description text default '',
  campaign_type text not null default 'Room Promotion',
  linked_promo_id text references sm_promotions(id) on delete set null,
  linked_promo_code text,
  target_audience text default 'All Guests',
  goal text default 'Lead Generation',
  start_date date,
  end_date date,
  budget numeric(14,2),
  status text not null default 'Draft',
  external_platform text,
  external_campaign_id text,
  external_campaign_name text,
  expected_leads integer default 0,
  expected_bookings integer default 0,
  expected_revenue numeric(14,2) default 0,
  bookings_list jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, campaign_code)
);

create table if not exists sm_ota_channels (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  channel_code text not null,
  channel_name text not null,
  logo_badge text default '',
  status text not null default 'Active Sync',
  monthly_revenue numeric(14,2) not null default 0,
  monthly_bookings integer not null default 0,
  room_nights_sold integer not null default 0,
  commission_rate numeric(6,2) not null default 0,
  adr numeric(14,2) not null default 0,
  profitability_score text default 'Medium',
  occupancy_contribution numeric(6,2) default 0,
  cancellation_rate numeric(6,2) default 0,
  avg_stay_nights numeric(6,2) default 0,
  avg_lead_time_days integer default 0,
  growth_rate_percent numeric(6,2) default 0,
  last_sync_time text default '',
  inventory_push_status text default 'Success',
  rate_push_status text default 'Success',
  restriction_push_status text default 'Success',
  sync_warnings jsonb not null default '[]'::jsonb,
  room_mappings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, channel_code)
);

create index if not exists sm_promotions_property_status_idx on sm_promotions (property_id, status);
create index if not exists sm_campaigns_property_status_idx on sm_campaigns (property_id, status);

notify pgrst, 'reload schema';
