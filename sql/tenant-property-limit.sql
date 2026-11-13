-- Per-tenant max properties (platform Super Admin sets this).
-- Run in Supabase SQL Editor.

alter table public.tenants
  add column if not exists property_limit integer not null default 5;

comment on column public.tenants.property_limit is
  'Max properties this tenant may create. Enforced on property create.';

-- Keep existing orgs usable; tighten per-tenant from the platform console.
update public.tenants
set property_limit = greatest(property_limit, 5)
where property_limit is null or property_limit < 1;
