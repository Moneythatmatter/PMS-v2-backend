-- Link wastage rows to Ingredients / Conversion Items for reporting + stock deduction.
alter table public.fb_wastage
  add column if not exists item_category text not null default 'other',
  add column if not exists item_id text,
  add column if not exists uom text not null default '',
  add column if not exists stock_deducted boolean not null default false,
  add column if not exists stock_deducted_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fb_wastage_item_category_check'
  ) then
    alter table public.fb_wastage
      add constraint fb_wastage_item_category_check
      check (item_category in ('ingredient', 'converted', 'other'));
  end if;
end $$;

create index if not exists idx_fb_wastage_item
  on public.fb_wastage (item_category, item_id)
  where item_id is not null;

-- Backfill free-text rows as "other".
update public.fb_wastage
set item_category = 'other'
where item_category is null or item_category = '';
