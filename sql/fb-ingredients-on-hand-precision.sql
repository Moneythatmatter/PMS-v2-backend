-- Keep fractional on-hand (e.g. 20.19 kg after gm-level consumption).
alter table public.fb_ingredients
  alter column on_hand type numeric(14, 4) using round(coalesce(on_hand, 0)::numeric, 4);

alter table public.fb_ingredients
  alter column reorder type numeric(14, 4) using round(coalesce(reorder, 0)::numeric, 4);

alter table public.fb_ingredients
  alter column on_hand set default 0;

alter table public.fb_ingredients
  alter column reorder set default 0;
