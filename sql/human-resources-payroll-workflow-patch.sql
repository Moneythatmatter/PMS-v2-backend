-- Payroll workflow: Calculate → (Verify) → Approve [lock + payslip] → Send payslip → Record payment(s)
-- Safe to run more than once.

alter table hr_payroll_records add column if not exists is_locked boolean not null default false;
alter table hr_payroll_records add column if not exists verified_at timestamptz;

-- Records that were already approved / paid before this patch become locked.
update hr_payroll_records
   set is_locked = true
 where status in ('Approved', 'Partially Paid', 'Paid', 'Locked')
   and is_locked = false;

-- Legacy "Locked" status maps to Paid (lock is now the is_locked flag).
update hr_payroll_records set status = 'Paid' where status = 'Locked';

-- One payslip per payroll record. Keep the newest if duplicates exist.
delete from hr_payslips p
 using hr_payslips newer
 where p.payroll_id is not null
   and p.payroll_id = newer.payroll_id
   and (p.created_at, p.id) < (newer.created_at, newer.id);

create unique index if not exists hr_payslips_payroll_id_unique
  on hr_payslips (payroll_id)
  where payroll_id is not null;

create index if not exists hr_salary_payments_payroll_idx on hr_salary_payments (payroll_id);
