-- Normalize existing attendance rows to manual source

update hr_attendance_records
set source = 'MANUAL'
where source is distinct from 'MANUAL';
