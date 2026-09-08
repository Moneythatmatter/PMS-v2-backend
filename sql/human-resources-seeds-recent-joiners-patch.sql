-- Patch: recent joiners + attendance (ref date 2026-09-07)
-- Run in Supabase SQL Editor if employees already exist with old join dates.
-- Safe to re-run — updates join dates and upserts attendance by fixed IDs.

-- ========== GRAND PALACE — join dates ==========
update hr_employees set join_date = '2026-09-01', attendance_rate = 100.0 where id = 'k2000001-0001-4000-8000-000000000001';
update hr_employees set join_date = '2026-09-02', attendance_rate = 75.0  where id = 'k2000001-0001-4000-8000-000000000002';
update hr_employees set join_date = '2026-09-03', attendance_rate = 100.0 where id = 'k2000001-0001-4000-8000-000000000003';
update hr_employees set join_date = '2026-09-04', attendance_rate = 100.0 where id = 'k2000001-0001-4000-8000-000000000004';
update hr_employees set join_date = '2026-09-05', attendance_rate = 100.0 where id = 'k2000001-0001-4000-8000-000000000005';

-- ========== SHAW HOTEL — join dates ==========
update hr_employees set join_date = '2026-09-01', attendance_rate = 100.0 where id = 'f2000002-0001-4000-8000-000000000001';
update hr_employees set join_date = '2026-09-02', attendance_rate = 75.0  where id = 'f2000002-0001-4000-8000-000000000002';
update hr_employees set join_date = '2026-09-03', attendance_rate = 100.0 where id = 'f2000002-0001-4000-8000-000000000003';
update hr_employees set join_date = '2026-09-04', attendance_rate = 100.0 where id = 'f2000002-0001-4000-8000-000000000004';
update hr_employees set join_date = '2026-09-05', attendance_rate = 100.0 where id = 'f2000002-0001-4000-8000-000000000005';

-- ========== GRAND PALACE — attendance ==========
insert into hr_attendance_records (
  id, property_id, employee_id, attendance_date, day_type, attendance_status,
  punch_in, punch_out, worked_hours, overtime_hours, holiday_worked, source, remarks
) values
  ('r8000001-0001-4000-8000-000000000001', 'prop-grand-palace', 'k2000001-0001-4000-8000-000000000001', '2026-09-01', 'WORKING_DAY', 'PRESENT', '2026-09-01 05:58:00+05:30', '2026-09-01 14:02:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000001-0001-4000-8000-000000000002', 'prop-grand-palace', 'k2000001-0001-4000-8000-000000000001', '2026-09-02', 'WORKING_DAY', 'PRESENT', '2026-09-02 06:05:00+05:30', '2026-09-02 14:10:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000001-0001-4000-8000-000000000003', 'prop-grand-palace', 'k2000001-0001-4000-8000-000000000001', '2026-09-03', 'WORKING_DAY', 'PRESENT', '2026-09-03 05:55:00+05:30', '2026-09-03 14:00:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000001-0001-4000-8000-000000000004', 'prop-grand-palace', 'k2000001-0001-4000-8000-000000000001', '2026-09-04', 'WORKING_DAY', 'PRESENT', '2026-09-04 06:00:00+05:30', '2026-09-04 14:05:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000001-0001-4000-8000-000000000005', 'prop-grand-palace', 'k2000001-0001-4000-8000-000000000001', '2026-09-05', 'WORKING_DAY', 'PRESENT', '2026-09-05 05:52:00+05:30', '2026-09-05 14:00:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000001-0001-4000-8000-000000000006', 'prop-grand-palace', 'k2000001-0001-4000-8000-000000000002', '2026-09-02', 'WORKING_DAY', 'PRESENT', '2026-09-02 14:00:00+05:30', '2026-09-02 22:00:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000001-0001-4000-8000-000000000007', 'prop-grand-palace', 'k2000001-0001-4000-8000-000000000002', '2026-09-03', 'WORKING_DAY', 'PRESENT', '2026-09-03 14:22:00+05:30', '2026-09-03 22:05:00+05:30', 7.5, 0, false, 'MANUAL', 'Late arrival'),
  ('r8000001-0001-4000-8000-000000000008', 'prop-grand-palace', 'k2000001-0001-4000-8000-000000000002', '2026-09-04', 'WORKING_DAY', 'PRESENT', '2026-09-04 13:58:00+05:30', '2026-09-04 21:55:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000001-0001-4000-8000-000000000009', 'prop-grand-palace', 'k2000001-0001-4000-8000-000000000002', '2026-09-05', 'WORKING_DAY', 'PRESENT', '2026-09-05 14:05:00+05:30', '2026-09-05 22:10:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000001-0001-4000-8000-000000000010', 'prop-grand-palace', 'k2000001-0001-4000-8000-000000000003', '2026-09-03', 'WORKING_DAY', 'PRESENT', '2026-09-03 06:02:00+05:30', '2026-09-03 14:08:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000001-0001-4000-8000-000000000011', 'prop-grand-palace', 'k2000001-0001-4000-8000-000000000003', '2026-09-04', 'WORKING_DAY', 'PRESENT', '2026-09-04 05:58:00+05:30', '2026-09-04 14:00:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000001-0001-4000-8000-000000000012', 'prop-grand-palace', 'k2000001-0001-4000-8000-000000000003', '2026-09-05', 'WORKING_DAY', 'PRESENT', '2026-09-05 06:00:00+05:30', '2026-09-05 14:05:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000001-0001-4000-8000-000000000013', 'prop-grand-palace', 'k2000001-0001-4000-8000-000000000004', '2026-09-04', 'WORKING_DAY', 'PRESENT', '2026-09-04 14:00:00+05:30', '2026-09-04 22:00:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000001-0001-4000-8000-000000000014', 'prop-grand-palace', 'k2000001-0001-4000-8000-000000000004', '2026-09-05', 'WORKING_DAY', 'PRESENT', '2026-09-05 13:55:00+05:30', '2026-09-05 21:50:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000001-0001-4000-8000-000000000015', 'prop-grand-palace', 'k2000001-0001-4000-8000-000000000005', '2026-09-05', 'WORKING_DAY', 'PRESENT', '2026-09-05 14:10:00+05:30', '2026-09-05 22:00:00+05:30', 7.5, 0, false, 'MANUAL', null)
on conflict (id) do nothing;

-- ========== SHAW HOTEL — attendance ==========
insert into hr_attendance_records (
  id, property_id, employee_id, attendance_date, day_type, attendance_status,
  punch_in, punch_out, worked_hours, overtime_hours, holiday_worked, source, remarks
) values
  ('r8000002-0001-4000-8000-000000000001', 'prop-shaw-hotel', 'f2000002-0001-4000-8000-000000000001', '2026-09-01', 'WORKING_DAY', 'PRESENT', '2026-09-01 05:58:00+05:30', '2026-09-01 14:02:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000002-0001-4000-8000-000000000002', 'prop-shaw-hotel', 'f2000002-0001-4000-8000-000000000001', '2026-09-02', 'WORKING_DAY', 'PRESENT', '2026-09-02 06:05:00+05:30', '2026-09-02 14:10:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000002-0001-4000-8000-000000000003', 'prop-shaw-hotel', 'f2000002-0001-4000-8000-000000000001', '2026-09-03', 'WORKING_DAY', 'PRESENT', '2026-09-03 05:55:00+05:30', '2026-09-03 14:00:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000002-0001-4000-8000-000000000004', 'prop-shaw-hotel', 'f2000002-0001-4000-8000-000000000001', '2026-09-04', 'WORKING_DAY', 'PRESENT', '2026-09-04 06:00:00+05:30', '2026-09-04 14:05:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000002-0001-4000-8000-000000000005', 'prop-shaw-hotel', 'f2000002-0001-4000-8000-000000000001', '2026-09-05', 'WORKING_DAY', 'PRESENT', '2026-09-05 05:52:00+05:30', '2026-09-05 14:00:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000002-0001-4000-8000-000000000006', 'prop-shaw-hotel', 'f2000002-0001-4000-8000-000000000002', '2026-09-02', 'WORKING_DAY', 'PRESENT', '2026-09-02 14:00:00+05:30', '2026-09-02 22:00:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000002-0001-4000-8000-000000000007', 'prop-shaw-hotel', 'f2000002-0001-4000-8000-000000000002', '2026-09-03', 'WORKING_DAY', 'PRESENT', '2026-09-03 14:22:00+05:30', '2026-09-03 22:05:00+05:30', 7.5, 0, false, 'MANUAL', 'Late arrival'),
  ('r8000002-0001-4000-8000-000000000008', 'prop-shaw-hotel', 'f2000002-0001-4000-8000-000000000002', '2026-09-04', 'WORKING_DAY', 'PRESENT', '2026-09-04 13:58:00+05:30', '2026-09-04 21:55:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000002-0001-4000-8000-000000000009', 'prop-shaw-hotel', 'f2000002-0001-4000-8000-000000000002', '2026-09-05', 'WORKING_DAY', 'PRESENT', '2026-09-05 14:05:00+05:30', '2026-09-05 22:10:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000002-0001-4000-8000-000000000010', 'prop-shaw-hotel', 'f2000002-0001-4000-8000-000000000003', '2026-09-03', 'WORKING_DAY', 'PRESENT', '2026-09-03 06:02:00+05:30', '2026-09-03 14:08:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000002-0001-4000-8000-000000000011', 'prop-shaw-hotel', 'f2000002-0001-4000-8000-000000000003', '2026-09-04', 'WORKING_DAY', 'PRESENT', '2026-09-04 05:58:00+05:30', '2026-09-04 14:00:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000002-0001-4000-8000-000000000012', 'prop-shaw-hotel', 'f2000002-0001-4000-8000-000000000003', '2026-09-05', 'WORKING_DAY', 'PRESENT', '2026-09-05 06:00:00+05:30', '2026-09-05 14:05:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000002-0001-4000-8000-000000000013', 'prop-shaw-hotel', 'f2000002-0001-4000-8000-000000000004', '2026-09-04', 'WORKING_DAY', 'PRESENT', '2026-09-04 14:00:00+05:30', '2026-09-04 22:00:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000002-0001-4000-8000-000000000014', 'prop-shaw-hotel', 'f2000002-0001-4000-8000-000000000004', '2026-09-05', 'WORKING_DAY', 'PRESENT', '2026-09-05 13:55:00+05:30', '2026-09-05 21:50:00+05:30', 7.5, 0, false, 'MANUAL', null),
  ('r8000002-0001-4000-8000-000000000015', 'prop-shaw-hotel', 'f2000002-0001-4000-8000-000000000005', '2026-09-05', 'WORKING_DAY', 'PRESENT', '2026-09-05 14:10:00+05:30', '2026-09-05 22:00:00+05:30', 7.5, 0, false, 'MANUAL', null)
on conflict (id) do nothing;
