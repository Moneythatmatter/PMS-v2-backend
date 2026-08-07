-- Flexible records for F&B pages without dedicated tables
-- (recipes, service charge, printers, table types, reason masters, etc.)

create table if not exists fb_module_records (
  id text primary key,
  module_key text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_fb_module_records_key on fb_module_records(module_key);

alter table fb_module_records enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'fb_module_records' and policyname = 'anon_all_fb_module_records'
  ) then
    create policy anon_all_fb_module_records on fb_module_records for all using (true) with check (true);
  end if;
end $$;

notify pgrst, 'reload schema';
