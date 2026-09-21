-- Purchase & Stores — drop product financial fields from ps_products
-- Run in Supabase SQL editor after deploying the app change.

alter table public.ps_products
  drop column if exists preferred_supplier,
  drop column if exists purchase_price,
  drop column if exists gst_percent,
  drop column if exists hsn_code,
  drop column if exists tax_type;

notify pgrst, 'reload schema';
