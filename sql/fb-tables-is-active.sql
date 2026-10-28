-- F&B Tables master: Active / Inactive flag.
-- `status` stays the live POS state (Available / Occupied / Dirty) and is no longer edited from the master.
-- Inactive tables are hidden from the POS floor plan and live table list.

alter table fb_live_tables add column if not exists is_active boolean not null default true;

notify pgrst, 'reload schema';
