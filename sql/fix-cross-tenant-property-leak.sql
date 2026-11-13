-- Fix: one tenant sees other tenants' properties in PMS.
-- Cause: old saas-tenants.sql linked every Admin user into tenant-default,
-- and demo seed often granted user_property_access across orgs.
--
-- Run in PRODUCTION Supabase SQL Editor (safe to re-run).

-- ========== Diagnose (optional) ==========
-- select u.email, u.tenant_id as home, tu.tenant_id as membership, tu.role
-- from public.users u
-- join public.tenant_users tu on tu.user_id = u.id
-- where coalesce(u.is_super_admin, false) = false
-- order by u.email, tu.tenant_id;

-- select u.email, u.tenant_id as home, p.id, p.name, p.tenant_id as prop_tenant
-- from public.user_property_access upa
-- join public.users u on u.id = upa.user_id
-- join public.properties p on p.id = upa.property_id
-- where coalesce(u.is_super_admin, false) = false
--   and u.tenant_id is not null
--   and p.tenant_id is not null
--   and p.tenant_id <> u.tenant_id;

-- ========== 1) Drop wrong tenant-default memberships ==========
-- Keep users whose home tenant IS tenant-default.
delete from public.tenant_users tu
using public.users u
where tu.user_id = u.id
  and tu.tenant_id = 'tenant-default'
  and coalesce(u.is_super_admin, false) = false
  and u.tenant_id is not null
  and u.tenant_id <> 'tenant-default';

-- ========== 2) Drop any membership that is not the user's home tenant ==========
delete from public.tenant_users tu
using public.users u
where tu.user_id = u.id
  and coalesce(u.is_super_admin, false) = false
  and u.tenant_id is not null
  and tu.tenant_id <> u.tenant_id;

-- ========== 3) Drop property access outside the user's home tenant ==========
delete from public.user_property_access upa
using public.users u, public.properties p
where upa.user_id = u.id
  and upa.property_id = p.id
  and coalesce(u.is_super_admin, false) = false
  and u.tenant_id is not null
  and p.tenant_id is not null
  and p.tenant_id <> u.tenant_id;

-- ========== 4) Ensure home tenant membership exists ==========
insert into public.tenant_users (tenant_id, user_id, role)
select u.tenant_id, u.id,
  case
    when lower(trim(u.role)) in ('admin', 'administrator') then 'admin'
    else 'member'
  end
from public.users u
where u.tenant_id is not null
  and coalesce(u.is_super_admin, false) = false
on conflict (tenant_id, user_id) do nothing;

-- ========== 5) Re-grant access only to properties inside home tenant ==========
insert into public.user_property_access (user_id, property_id, is_default)
select u.id, p.id, false
from public.users u
join public.properties p on p.tenant_id = u.tenant_id and p.status = 'Active'
where u.tenant_id is not null
  and coalesce(u.is_super_admin, false) = false
  and lower(trim(u.role)) in ('admin', 'administrator')
on conflict do nothing;
