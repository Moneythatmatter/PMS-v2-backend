-- Link HK Puri login (hk.gpr@hotel.com) to an HR employee for Employee Portal access
-- Run after employee-portal-user-link-patch.sql and human-resources-seeds.sql

insert into hr_employees (
  id, property_id, emp_code, first_name, last_name, email, phone,
  department_id, designation_id, employment_type_id, shift_type_id, leave_policy_id,
  join_date, status, gender, avatar, attendance_rate, leave_balance
) values (
  'k2000001-0001-4000-8000-000000000010',
  'prop-grand-palace',
  'EMP-HK01',
  'HK',
  'Puri',
  'hk.gpr@hotel.com',
  '+91 98765 44001',
  'a1000001-0001-4000-8000-000000000002',
  'b2000001-0001-4000-8000-000000000003',
  'c3000001-0001-4000-8000-000000000001',
  'd4000001-0001-4000-8000-000000000001',
  'f6000001-0001-4000-8000-000000000001',
  '2026-09-01',
  'Active',
  'Male',
  'HP',
  100.0,
  '{"casual":8,"sick":7,"earned":12}'::jsonb
)
on conflict (id) do update set
  email = excluded.email,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  status = excluded.status;

update public.users
set employee_id = 'k2000001-0001-4000-8000-000000000010'
where email = 'hk.gpr@hotel.com';

notify pgrst, 'reload schema';
