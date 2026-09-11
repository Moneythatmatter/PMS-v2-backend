-- Remove Holiday Attendance feature (page + API + table).
-- Safe to re-run.

drop table if exists hr_holiday_attendance_records cascade;

notify pgrst, 'reload schema';
