-- Add holiday_id to hr_attendance_records (links attendance to hr_holidays calendar entry)
-- Safe to re-run

alter table hr_attendance_records add column if not exists holiday_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hr_attendance_records_holiday_id_fkey'
  ) then
    alter table hr_attendance_records
      add constraint hr_attendance_records_holiday_id_fkey
      foreign key (holiday_id) references hr_holidays(id) on delete set null;
  end if;
exception when others then null;
end $$;

create index if not exists idx_hr_attendance_holiday
  on hr_attendance_records(property_id, holiday_id);
