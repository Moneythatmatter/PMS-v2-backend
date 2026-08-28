-- GRN physical-receipt fields (run after purchase-stores-schema.sql)
alter table ps_grns add column if not exists delivery_time text;
alter table ps_grns add column if not exists receiving_dock text;
alter table ps_grns add column if not exists delivery_person text;

notify pgrst, 'reload schema';
