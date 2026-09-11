-- Employee Portal: link application users to hr_employees
-- Run after auth-users-schema.sql, multi-property-schema.sql, human-resources-schema.sql
--
-- Chain: users.id → users.employee_id → hr_employees.id
-- Optional auth_user_id for future Supabase Auth (auth.users.id) — do NOT create a separate employee auth table.

alter table public.users
  add column if not exists employee_id text references public.hr_employees(id) on delete set null;

alter table public.users
  add column if not exists auth_user_id uuid;

create unique index if not exists idx_users_employee_id_unique
  on public.users (employee_id)
  where employee_id is not null;

create unique index if not exists idx_users_auth_user_id_unique
  on public.users (auth_user_id)
  where auth_user_id is not null;

create index if not exists idx_users_employee_id on public.users (employee_id);

comment on column public.users.employee_id is 'HR employee record for self-service portal access';
comment on column public.users.auth_user_id is 'Optional Supabase auth.users.id when migrating to Supabase Auth';

-- Demo employee portal user (Grand Palace — Rajesh Kumar EMP-0101)
-- Login: employee@gmail.com / 123456
insert into public.users (id, name, email, password_hash, role, initials, status, employee_id) values
  (
    'U-EMP-DEMO',
    'Rajesh Kumar',
    'employee@gmail.com',
    '$2b$10$YRx65m7Qb/hI/3YLOSfv2u6CLH7KmmPHfi0n9FHDXz4uHY4OLnciy',
    'Employee',
    'RK',
    'Active',
    'k2000001-0001-4000-8000-000000000001'
  )
on conflict (id) do update set
  name = excluded.name,
  email = excluded.email,
  password_hash = excluded.password_hash,
  role = excluded.role,
  initials = excluded.initials,
  status = excluded.status,
  employee_id = excluded.employee_id;

insert into public.user_property_access (user_id, property_id, is_default) values
  ('U-EMP-DEMO', 'prop-grand-palace', true)
on conflict (user_id, property_id) do update set is_default = excluded.is_default;

notify pgrst, 'reload schema';
