-- Align users.role with the 3-tier SaaS model:
--   Super Admin  = platform (admin panel) — is_super_admin = true
--   Admin        = tenant admin (PMS)
--   User         = default staff created by tenant inside a property
--
-- Run after saas-tenants.sql. Job labels (Front Office, Housekeeping, …) are left alone.

-- 1) Platform operators
update public.users
set role = 'Super Admin'
where coalesce(is_super_admin, false) = true;

-- 2) Tenant admins (membership role admin, not platform super)
update public.users u
set role = 'Admin'
where coalesce(u.is_super_admin, false) = false
  and exists (
    select 1
    from public.tenant_users tu
    where tu.user_id = u.id
      and lower(tu.role) = 'admin'
  );

-- 3) Anyone still labeled legacy "Admin" / "Administrator" / "client" who is NOT
--    a tenant admin and NOT super → treat as User
update public.users u
set role = 'User'
where coalesce(u.is_super_admin, false) = false
  and lower(trim(u.role)) in ('admin', 'administrator', 'client')
  and not exists (
    select 1
    from public.tenant_users tu
    where tu.user_id = u.id
      and lower(tu.role) = 'admin'
  );
