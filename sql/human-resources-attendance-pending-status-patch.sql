-- Add PENDING attendance status (not finalized until shift cutoff)
-- Run after human-resources-attendance-schema-patch.sql

-- Drop ALL known check constraint names (schema patch vs fresh install use different names)
alter table hr_attendance_records
  drop constraint if exists hr_attendance_records_attendance_status_check;

alter table hr_attendance_records
  drop constraint if exists hr_attendance_status_check;

alter table hr_attendance_records
  add constraint hr_attendance_status_check
  check (attendance_status in ('PRESENT', 'ABSENT', 'LEAVE', 'HOLIDAY', 'WEEKLY_OFF', 'PENDING'));

notify pgrst, 'reload schema';
