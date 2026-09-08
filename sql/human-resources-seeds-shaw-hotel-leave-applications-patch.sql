-- Leave application samples for Shaw Hotel (prop-shaw-hotel)
-- Run after human-resources-seeds-shaw-hotel.sql

insert into hr_leave_applications (
  id, property_id, employee_id, leave_type_id, leave_type_code, leave_type_name,
  from_date, to_date, total_days, reason, status, applied_on, approved_by
) values
  (
    'l4000002-0001-4000-8000-000000000001',
    'prop-shaw-hotel',
    'f2000002-0001-4000-8000-000000000002',
    'e5000002-0001-4000-8000-000000000003',
    'LV-SL',
    'Sick Leave (SL)',
    '2026-09-08',
    '2026-09-09',
    2,
    'Fever — doctor advised rest',
    'Pending',
    '2026-09-06 09:30:00+05:30',
    null
  ),
  (
    'l4000002-0001-4000-8000-000000000002',
    'prop-shaw-hotel',
    'f2000002-0001-4000-8000-000000000003',
    'e5000002-0001-4000-8000-000000000001',
    'LV-CL',
    'Casual Leave (CL)',
    '2026-09-10',
    '2026-09-10',
    1,
    'Personal work at home',
    'Pending',
    '2026-09-05 11:00:00+05:30',
    null
  ),
  (
    'l4000002-0001-4000-8000-000000000003',
    'prop-shaw-hotel',
    'f2000002-0001-4000-8000-000000000001',
    'e5000002-0001-4000-8000-000000000001',
    'LV-CL',
    'Casual Leave (CL)',
    '2026-08-20',
    '2026-08-21',
    2,
    'Family function',
    'Approved',
    '2026-08-18 10:00:00+05:30',
    'Neha Mehta (HR Manager)'
  ),
  (
    'l4000002-0001-4000-8000-000000000004',
    'prop-shaw-hotel',
    'f2000002-0001-4000-8000-000000000004',
    'e5000002-0001-4000-8000-000000000002',
    'LV-EL',
    'Earned Leave (EL)',
    '2026-08-01',
    '2026-08-05',
    5,
    'Annual vacation',
    'Approved',
    '2026-07-28 14:00:00+05:30',
    'Neha Mehta (HR Manager)'
  ),
  (
    'l4000002-0001-4000-8000-000000000005',
    'prop-shaw-hotel',
    'f2000002-0001-4000-8000-000000000005',
    'e5000002-0001-4000-8000-000000000001',
    'LV-CL',
    'Casual Leave (CL)',
    '2026-09-12',
    '2026-09-12',
    1,
    'Insufficient leave balance',
    'Rejected',
    '2026-09-04 16:20:00+05:30',
    'Neha Mehta (HR Manager)'
  )
on conflict (id) do nothing;
