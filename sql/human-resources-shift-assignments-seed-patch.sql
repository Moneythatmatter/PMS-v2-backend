-- Seed shift assignments for Shift Management page demo data.
-- Run after human-resources-schema.sql and employee/shift-type seeds.

-- ========== prop-grand-palace ==========
insert into hr_shift_assignments (
  id, property_id, employee_id, shift_type_id, shift_code, shift_name, shift_category,
  start_time, end_time, effective_from, effective_to, status, assigned_by, remarks
) values
  (
    's7000001-0001-4000-8000-000000000001',
    'prop-grand-palace',
    'k2000001-0001-4000-8000-000000000001',
    'd4000001-0001-4000-8000-000000000001',
    'SH-MRN', 'Morning Shift', 'Morning',
    '06:00', '14:00', '2026-09-01', null, 'Active', 'HR Admin', 'Default morning roster'
  ),
  (
    's7000001-0001-4000-8000-000000000002',
    'prop-grand-palace',
    'k2000001-0001-4000-8000-000000000002',
    'd4000001-0001-4000-8000-000000000002',
    'SH-EVE', 'Evening Shift', 'Evening',
    '14:00', '22:00', '2026-09-02', null, 'Active', 'HR Admin', 'Default evening roster'
  ),
  (
    's7000001-0001-4000-8000-000000000003',
    'prop-grand-palace',
    'k2000001-0001-4000-8000-000000000003',
    'd4000001-0001-4000-8000-000000000001',
    'SH-MRN', 'Morning Shift', 'Morning',
    '06:00', '14:00', '2026-09-03', null, 'Active', 'HR Admin', 'Housekeeping morning roster'
  ),
  (
    's7000001-0001-4000-8000-000000000004',
    'prop-grand-palace',
    'k2000001-0001-4000-8000-000000000004',
    'd4000001-0001-4000-8000-000000000002',
    'SH-EVE', 'Evening Shift', 'Evening',
    '14:00', '22:00', '2026-09-04', null, 'Active', 'HR Admin', 'Kitchen evening roster'
  ),
  (
    's7000001-0001-4000-8000-000000000005',
    'prop-grand-palace',
    'k2000001-0001-4000-8000-000000000002',
    'd4000001-0001-4000-8000-000000000003',
    'SH-NGT', 'Night Shift', 'Night',
    '22:00', '06:00', '2026-09-15', null, 'Active', 'HR Admin', 'Scheduled move to night shift'
  )
on conflict (id) do update set
  shift_type_id = excluded.shift_type_id,
  shift_code = excluded.shift_code,
  shift_name = excluded.shift_name,
  shift_category = excluded.shift_category,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  effective_from = excluded.effective_from,
  effective_to = excluded.effective_to,
  status = excluded.status,
  assigned_by = excluded.assigned_by,
  remarks = excluded.remarks;

-- ========== prop-shaw-hotel ==========
insert into hr_shift_assignments (
  id, property_id, employee_id, shift_type_id, shift_code, shift_name, shift_category,
  start_time, end_time, effective_from, effective_to, status, assigned_by, remarks
) values
  (
    's7000002-0001-4000-8000-000000000001',
    'prop-shaw-hotel',
    'f2000002-0001-4000-8000-000000000001',
    'd4000002-0001-4000-8000-000000000001',
    'SH-MRN', 'Morning Shift', 'Morning',
    '06:00', '14:00', '2026-09-01', null, 'Active', 'HR Admin', 'Default morning roster'
  ),
  (
    's7000002-0001-4000-8000-000000000002',
    'prop-shaw-hotel',
    'f2000002-0001-4000-8000-000000000002',
    'd4000002-0001-4000-8000-000000000002',
    'SH-EVE', 'Evening Shift', 'Evening',
    '14:00', '22:00', '2026-09-02', null, 'Active', 'HR Admin', 'Default evening roster'
  ),
  (
    's7000002-0001-4000-8000-000000000003',
    'prop-shaw-hotel',
    'f2000002-0001-4000-8000-000000000003',
    'd4000002-0001-4000-8000-000000000001',
    'SH-MRN', 'Morning Shift', 'Morning',
    '06:00', '14:00', '2026-09-03', null, 'Active', 'HR Admin', 'Housekeeping morning roster'
  ),
  (
    's7000002-0001-4000-8000-000000000004',
    'prop-shaw-hotel',
    'f2000002-0001-4000-8000-000000000004',
    'd4000002-0001-4000-8000-000000000002',
    'SH-EVE', 'Evening Shift', 'Evening',
    '14:00', '22:00', '2026-09-04', null, 'Active', 'HR Admin', 'Kitchen evening roster'
  )
on conflict (id) do update set
  shift_type_id = excluded.shift_type_id,
  shift_code = excluded.shift_code,
  shift_name = excluded.shift_name,
  shift_category = excluded.shift_category,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  effective_from = excluded.effective_from,
  effective_to = excluded.effective_to,
  status = excluded.status,
  assigned_by = excluded.assigned_by,
  remarks = excluded.remarks;
