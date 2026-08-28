-- Default sell price on menu items
alter table public.fnb_menu_items add column if not exists price numeric not null default 0;

notify pgrst, 'schema cache';
