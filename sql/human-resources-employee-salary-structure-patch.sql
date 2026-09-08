-- Link employees to salary structure templates; remove legacy salary column
-- Run after human-resources-schema.sql (requires hr_salary_structures to exist)

alter table hr_employees
  add column if not exists salary_structure_id text references hr_salary_structures(id) on delete set null;

create index if not exists idx_hr_employees_salary_structure
  on hr_employees(property_id, salary_structure_id);

alter table hr_employees
  drop column if exists salary;
