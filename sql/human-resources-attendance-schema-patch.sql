-- Migrate hr_attendance_records to the new attendance schema
-- Safe to re-run: uses IF NOT EXISTS / conditional drops

-- 1) Add new columns
alter table hr_attendance_records add column if not exists attendance_date date;
alter table hr_attendance_records add column if not exists day_type text default 'WORKING_DAY';
alter table hr_attendance_records add column if not exists attendance_status text default 'PRESENT';
alter table hr_attendance_records add column if not exists punch_in timestamptz;
alter table hr_attendance_records add column if not exists punch_out timestamptz;
alter table hr_attendance_records add column if not exists overtime_hours numeric(5,2) default 0;
alter table hr_attendance_records add column if not exists holiday_worked boolean default false;
alter table hr_attendance_records add column if not exists leave_request_id text;
alter table hr_attendance_records add column if not exists holiday_id text;
alter table hr_attendance_records add column if not exists remarks text;
alter table hr_attendance_records add column if not exists source text default 'MANUAL';
alter table hr_attendance_records add column if not exists created_by text;
alter table hr_attendance_records add column if not exists updated_by text;

-- 2) Backfill from legacy columns when present
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'hr_attendance_records' and column_name = 'record_date'
  ) then
    update hr_attendance_records
    set
      attendance_date = coalesce(attendance_date, record_date),
      attendance_status = case
        when coalesce(attendance_status, '') <> '' and attendance_status <> 'PRESENT' then attendance_status
        when status ilike 'Absent' then 'ABSENT'
        when status ilike '%Leave%' then 'LEAVE'
        when status ilike '%Weekly%' then 'WEEKLY_OFF'
        when status ilike '%Holiday%' then 'HOLIDAY'
        else 'PRESENT'
      end,
      day_type = case
        when coalesce(day_type, '') <> '' and day_type <> 'WORKING_DAY' then day_type
        when status ilike '%Weekly%' then 'WEEKLY_OFF'
        when status ilike '%Holiday%' then 'HOLIDAY'
        else 'WORKING_DAY'
      end,
      remarks = coalesce(remarks, manual_reason),
      source = case
        when coalesce(source, '') <> '' and source <> 'MANUAL' then source
        when device_type ilike '%Biometric%' then 'BIOMETRIC'
        when coalesce(is_manual_entry, false) then 'MANUAL'
        when device_type ilike '%Import%' then 'IMPORT'
        else 'MANUAL'
      end,
      updated_by = coalesce(updated_by, edited_by)
    where attendance_date is null
       or attendance_status is null
       or source is null;
  end if;
end $$;

alter table hr_attendance_records
  alter column attendance_date set not null;

-- 3) Drop legacy columns
alter table hr_attendance_records drop column if exists shift_code;
alter table hr_attendance_records drop column if exists shift_name;
alter table hr_attendance_records drop column if exists record_date;
alter table hr_attendance_records drop column if exists check_in;
alter table hr_attendance_records drop column if exists check_out;
alter table hr_attendance_records drop column if exists expected_hours;
alter table hr_attendance_records drop column if exists status;
alter table hr_attendance_records drop column if exists in_location;
alter table hr_attendance_records drop column if exists out_location;
alter table hr_attendance_records drop column if exists device_type;
alter table hr_attendance_records drop column if exists is_manual_entry;
alter table hr_attendance_records drop column if exists manual_reason;
alter table hr_attendance_records drop column if exists edited_by;
alter table hr_attendance_records drop column if exists edited_on;

-- 4) Constraints & indexes
alter table hr_attendance_records drop constraint if exists hr_attendance_day_type_check;
alter table hr_attendance_records add constraint hr_attendance_day_type_check
  check (day_type in ('WORKING_DAY', 'HOLIDAY', 'WEEKLY_OFF'));

alter table hr_attendance_records drop constraint if exists hr_attendance_status_check;
alter table hr_attendance_records add constraint hr_attendance_status_check
  check (attendance_status in ('PRESENT', 'ABSENT', 'LEAVE', 'HOLIDAY', 'WEEKLY_OFF'));

alter table hr_attendance_records drop constraint if exists hr_attendance_source_check;
alter table hr_attendance_records add constraint hr_attendance_source_check
  check (source in ('BIOMETRIC', 'MANUAL', 'IMPORT', 'EMPLOYEE_PORTAL'));

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hr_attendance_records_leave_request_id_fkey'
  ) then
    alter table hr_attendance_records
      add constraint hr_attendance_records_leave_request_id_fkey
      foreign key (leave_request_id) references hr_leave_applications(id) on delete set null;
  end if;
exception when others then null;
end $$;

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

drop index if exists idx_hr_attendance_date;
create index if not exists idx_hr_attendance_date
  on hr_attendance_records(property_id, attendance_date);
create index if not exists idx_hr_attendance_employee
  on hr_attendance_records(property_id, employee_id, attendance_date);

create unique index if not exists idx_hr_attendance_unique_day
  on hr_attendance_records(property_id, employee_id, attendance_date);
