-- Custom tenant roles with page-wise access templates.
-- Run in Supabase SQL Editor after saas-tenants.sql.

create table if not exists public.tenant_roles (
  id text primary key,
  tenant_id text not null references public.tenants(id) on delete cascade,
  name text not null,
  description text not null default '',
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_roles_name_unique unique (tenant_id, name)
);

create index if not exists idx_tenant_roles_tenant on public.tenant_roles (tenant_id);

create table if not exists public.tenant_role_permissions (
  role_id text not null references public.tenant_roles(id) on delete cascade,
  module_key text not null,
  permission text not null,
  primary key (role_id, module_key),
  constraint tenant_role_permissions_level
    check (permission in ('read', 'write', 'admin'))
);

create index if not exists idx_tenant_role_permissions_role
  on public.tenant_role_permissions (role_id);

-- Link staff users to a custom role (template for page grants).
alter table public.users
  add column if not exists access_role_id text references public.tenant_roles(id) on delete set null;

create index if not exists idx_users_access_role on public.users (access_role_id);

alter table public.tenant_roles enable row level security;
alter table public.tenant_role_permissions enable row level security;

drop policy if exists "anon_all_tenant_roles" on public.tenant_roles;
create policy "anon_all_tenant_roles" on public.tenant_roles for all using (true) with check (true);

drop policy if exists "anon_all_tenant_role_permissions" on public.tenant_role_permissions;
create policy "anon_all_tenant_role_permissions" on public.tenant_role_permissions
  for all using (true) with check (true);
