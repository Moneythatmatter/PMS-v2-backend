-- Attendance v2: shift_id, scheduled_hours, extra_hours (rename from overtime_hours)
-- Safe to re-run

alter table hr_attendance_records add column if not exists shift_id text;
alter table hr_attendance_records add column if not exists scheduled_hours numeric(5,2) default 0;

-- extra_hours replaces overtime_hours
alter table hr_attendance_records add column if not exists extra_hours numeric(5,2);
update hr_attendance_records
set extra_hours = coalesce(extra_hours, overtime_hours, 0)
where extra_hours is null;

alter table hr_attendance_records alter column extra_hours set default 0;
update hr_attendance_records set extra_hours = 0 where extra_hours is null;
alter table hr_attendance_records alter column extra_hours set not null;

alter table hr_attendance_records drop column if exists overtime_hours;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hr_attendance_records_shift_id_fkey'
  ) then
    alter table hr_attendance_records
      add constraint hr_attendance_records_shift_id_fkey
      foreign key (shift_id) references hr_shift_types(id) on delete set null;
  end if;
exception when others then null;
end $$;

create index if not exists idx_hr_attendance_shift
  on hr_attendance_records(property_id, shift_id);

notify pgrst, 'reload schema';
