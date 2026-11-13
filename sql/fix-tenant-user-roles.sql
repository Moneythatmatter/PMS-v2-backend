-- Fix: saas-tenants seed mistakenly marked every property user as tenant_users.role = 'admin',
-- so Users saw ALL properties in the tenant. Demote non-Admin users to 'member'.

update public.tenant_users tu
set role = 'member'
from public.users u
where tu.user_id = u.id
  and lower(tu.role) = 'admin'
  and coalesce(u.is_super_admin, false) = false
  and lower(trim(u.role)) not in ('admin', 'administrator', 'super admin', 'superadmin');

-- Ensure real Tenant Admins stay admin in tenant_users
update public.tenant_users tu
set role = 'admin'
from public.users u
where tu.user_id = u.id
  and coalesce(u.is_super_admin, false) = false
  and lower(trim(u.role)) in ('admin', 'administrator');
