-- Allow EMPLOYEE_PORTAL as a valid attendance source (employee self-service punch in/out)
alter table hr_attendance_records drop constraint if exists hr_attendance_source_check;
alter table hr_attendance_records add constraint hr_attendance_source_check
  check (source in ('BIOMETRIC', 'MANUAL', 'IMPORT', 'EMPLOYEE_PORTAL'));

notify pgrst, 'reload schema';
