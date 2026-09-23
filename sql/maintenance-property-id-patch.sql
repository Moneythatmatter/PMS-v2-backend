-- Ensure every Engineering Maintenance (mnt_*) table has property_id
-- and is scoped to the active workspace.
-- Safe to re-run. Run AFTER properties table exists.
--
-- If you already have rows with NULL property_id, either delete them
-- or backfill before the NOT NULL step (see optional backfill below).

do $$
declare
  t text;
  tables text[] := array[
    'mnt_asset_categories',
    'mnt_problem_categories',
    'mnt_root_causes',
    'mnt_pm_templates',
    'mnt_vendors',
    'mnt_spare_parts',
    'mnt_assets',
    'mnt_requests',
    'mnt_work_orders',
    'mnt_pm_schedules',
    'mnt_rooms',
    'mnt_public_areas'
  ];
begin
  foreach t in array tables
  loop
    execute format(
      'alter table %I add column if not exists property_id text',
      t
    );

    -- Optional: attach orphan rows to the default property before NOT NULL.
    -- Uncomment if you need to keep existing null rows:
    -- execute format(
    --   'update %I set property_id = (
    --      select id from properties where is_default = true limit 1
    --    ) where property_id is null',
    --   t
    -- );

    -- Drop rows that still have no property (clean orphan test data).
    execute format('delete from %I where property_id is null', t);

    -- Enforce NOT NULL + FK (idempotent-ish: ignore if already set).
    begin
      execute format(
        'alter table %I alter column property_id set not null',
        t
      );
    exception when others then
      raise notice 'NOT NULL on %.property_id skipped: %', t, SQLERRM;
    end;

    begin
      execute format(
        'alter table %I drop constraint if exists %I',
        t, t || '_property_id_fkey'
      );
      execute format(
        'alter table %I add constraint %I foreign key (property_id) references properties(id) on delete cascade',
        t, t || '_property_id_fkey'
      );
    exception when others then
      raise notice 'FK on %.property_id skipped: %', t, SQLERRM;
    end;

    execute format(
      'create index if not exists %I on %I (property_id)',
      'idx_' || t || '_property_id',
      t
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
