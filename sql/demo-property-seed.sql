-- Demo property with basic master data for every module.
--
--   Platform     property + access for Admin users
--   Accounts     acc_seed_property (chart of accounts, FY, taxes, voucher types ...) + parties for demo companies / suppliers
--   Front Office room types, rooms, tariff plans, booking sources, corporate companies, guests
--   Housekeeping room status rows, public areas, linen / amenity inventory
--   F&B          outlet types, outlets, tables, units, tax groups, menu categories, menu items, modifiers, ingredients
--   Purchase     units, categories, stores, suppliers, products
--   HR           departments, designations, employment / shift / leave types, leave policy, holidays,
--                salary components, document categories & types, complaint categories, payroll settings, employees
--   Sales & Mkt  venues, lead sources, activity types, deal stages, contact types
--   Maintenance  asset / problem categories, root causes, vendors, spare parts, PM templates, assets, room & area rows
--
-- Prerequisite: accounts-property-setup.sql (for the Accounts part) + saas-tenants.sql.
-- Run this whole file once in the Supabase SQL Editor (creates/replaces the functions).
-- Then seed a property FOR A SPECIFIC TENANT (tenant id is required):
--
--   select public.demo_seed_new_property('tenant-itc');
--   select public.demo_seed_new_property('tenant-itc', 'Demo Resort', 'Puri');
--   select public.demo_seed_property(
--     'prop-itc-demo', 'ITC Demo Hotel', 'itc-demo', 'Bhubaneswar', 'tenant-itc'
--   );
--
-- Tenant id = tenants.id from the platform console (e.g. tenant-default, tenant-itc).
-- Each call creates a NEW demo property under that tenant (prop-demo, prop-demo2, ...).
-- Respects tenants.property_limit. Links property access to that tenant's users.

------------------------------------------------------------------------------------------------
-- 1. Codes / numbers unique per property (otherwise room "101" or code "STD" clashes with
--    another property). Same approach as fb-unique-per-property.sql, for the other master tables.
------------------------------------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'rooms', 'room_types', 'tariff_plans', 'booking_sources', 'companies', 'guests',
    'public_areas', 'hk_inventory',
    'ps_units', 'ps_categories', 'ps_suppliers', 'ps_products', 'ps_warehouses',
    'fnb_menu_categories', 'fnb_menu_items', 'fnb_units', 'fnb_tax_groups', 'fb_outlets', 'fb_outlet_types',
    'fb_live_tables', 'fb_modifier_groups', 'fb_modifiers', 'fb_ingredients',
    'hr_departments', 'hr_designations', 'hr_employment_types', 'hr_shift_types', 'hr_leave_types',
    'hr_leave_policies', 'hr_holidays', 'hr_salary_components', 'hr_employees',
    'sm_venues', 'sm_lead_sources', 'sm_activity_types', 'sm_deal_stages', 'sm_contact_types'
  ];
  r record;
  cols text;
  new_name text;
  con_name text;
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then continue; end if;
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = t and column_name = 'property_id') then
      continue;
    end if;
    for r in
      select i.indexrelid, ic.relname as index_name, array_agg(a.attname::text order by k.ord) as col_names
      from pg_index i
      join pg_class ic on ic.oid = i.indexrelid
      cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
      where i.indrelid = ('public.' || t)::regclass
        and i.indisunique and not i.indisprimary and i.indpred is null and i.indexprs is null
      group by i.indexrelid, ic.relname
    loop
      if 'property_id' = any(r.col_names)
         or exists (select 1 from unnest(r.col_names) c where c = 'id' or c like '%\_id' escape '\') then
        continue;
      end if;
      select string_agg(quote_ident(c), ', ') into cols from unnest(r.col_names) c;
      new_name := left(t || '_' || array_to_string(r.col_names, '_') || '_per_property', 63);
      begin
        execute format('create unique index if not exists %I on public.%I (property_id, %s)', new_name, t, cols);
        select conname into con_name from pg_constraint where conindid = r.indexrelid and contype = 'u';
        if con_name is not null then
          execute format('alter table public.%I drop constraint %I', t, con_name);
        else
          execute format('drop index if exists public.%I', r.index_name);
        end if;
        raise notice '%: % -> per property', t, r.index_name;
      exception when others then
        raise notice '%: kept % (%)', t, r.index_name, sqlerrm;
      end;
    end loop;
  end loop;
end $$;

------------------------------------------------------------------------------------------------
-- 2. Seed function
------------------------------------------------------------------------------------------------
create or replace function public.demo_seed_property(
  p_property_id text default 'prop-demo',
  p_name text default 'Demo Hotel',
  p_code text default 'demo',
  p_city text default 'Bhubaneswar',
  p_tenant_id text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  pid text := p_property_id;
  tid text := nullif(trim(coalesce(p_tenant_id, '')), '');
  rep jsonb := '{}'::jsonb;
  yr int := extract(year from (now() at time zone 'Asia/Kolkata'))::int;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  rec record;
  n int;
  cnt int;
  lim int;
  used int;
  tname text;
  tstatus text;
  is_new boolean;
begin
  if tid is null then
    raise exception 'p_tenant_id is required. Example: select demo_seed_new_property(''tenant-itc'');';
  end if;

  select t.name, t.status, coalesce(t.property_limit, 5)
    into tname, tstatus, lim
  from public.tenants t
  where t.id = tid;

  if tname is null then
    raise exception 'Tenant not found: %. Check tenants.id in the platform console.', tid;
  end if;
  if coalesce(tstatus, '') <> 'Active' then
    raise exception 'Tenant % is not Active (status=%). Activate it before seeding.', tid, tstatus;
  end if;

  is_new := not exists (select 1 from public.properties where id = pid);
  if is_new then
    select count(*)::int into used from public.properties where tenant_id = tid;
    if used >= lim then
      raise exception
        'Property limit exceeded for tenant % (%). Already % / % properties. Raise property_limit in the platform console.',
        tid, tname, used, lim;
    end if;
  end if;

  -- Platform -----------------------------------------------------------------------------------
  insert into public.properties (id, name, code, city, timezone, is_default, status, tenant_id)
  values (pid, p_name, p_code, p_city, 'Asia/Kolkata', false, 'Active', tid)
  on conflict (id) do update set
    name = excluded.name,
    code = excluded.code,
    city = excluded.city,
    timezone = excluded.timezone,
    status = excluded.status,
    tenant_id = excluded.tenant_id,
    updated_at = now();

  rep := rep || jsonb_build_object(
    'tenant_id', tid,
    'tenant_name', tname,
    'property_limit', lim
  );

  begin
    -- Tenant's own users (admin + staff) get access to this property.
    insert into public.user_property_access (user_id, property_id, is_default)
    select tu.user_id, pid, false
    from public.tenant_users tu
    where tu.tenant_id = tid
    on conflict do nothing;

    -- Platform super-admins can open any property for support.
    insert into public.user_property_access (user_id, property_id, is_default)
    select u.id, pid, false
    from public.users u
    where coalesce(u.is_super_admin, false) = true
       or lower(trim(coalesce(u.role, ''))) in ('super admin', 'superadmin')
    on conflict do nothing;

    rep := rep || jsonb_build_object('user_property_access', 'seeded');
  exception when others then rep := rep || jsonb_build_object('user_property_access', 'error: ' || sqlerrm);
  end;

  -- Accounts -----------------------------------------------------------------------------------
  begin
    rep := rep || jsonb_build_object('accounts', public.acc_seed_property(pid));
  exception when others then rep := rep || jsonb_build_object('accounts', 'error: ' || sqlerrm || ' (run accounts-property-setup.sql first)');
  end;

  -- Front Office -------------------------------------------------------------------------------
  begin
    if exists (select 1 from public.room_types where property_id = pid) then
      rep := rep || '{"room_types":"skipped"}';
    else
      insert into public.room_types (id, property_id, code, name, description, base_rate, size_sq_ft, status)
      select gen_random_uuid(), pid, v.code, v.name, v.descr, v.rate, v.size, 'Active'
      from (values
        ('STD', 'Standard', 'Cosy room with queen bed, work desk and city view', 2500, 250),
        ('DLX', 'Deluxe', 'Spacious room with king bed and seating area', 3800, 320),
        ('EXE', 'Executive', 'Upper-floor room with lounge chair and minibar', 5200, 400),
        ('STE', 'Suite', 'Separate living room, king bed and bathtub', 8500, 650)
      ) v(code, name, descr, rate, size);
      rep := rep || '{"room_types":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('room_types', 'error: ' || sqlerrm);
  end;

  begin
    if exists (select 1 from public.rooms where property_id = pid) then
      rep := rep || '{"rooms":"skipped"}';
    else
      cnt := 0;
      for rec in
        select * from (values
          ('101', 'Standard', '1st Floor', 2, 'Queen'), ('102', 'Standard', '1st Floor', 2, 'Queen'),
          ('103', 'Standard', '1st Floor', 2, 'Twin'),  ('104', 'Standard', '1st Floor', 2, 'Twin'),
          ('105', 'Deluxe', '1st Floor', 3, 'King'),    ('106', 'Deluxe', '1st Floor', 3, 'King'),
          ('201', 'Deluxe', '2nd Floor', 3, 'King'),    ('202', 'Deluxe', '2nd Floor', 3, 'King'),
          ('203', 'Deluxe', '2nd Floor', 3, 'Twin'),    ('204', 'Executive', '2nd Floor', 3, 'King'),
          ('205', 'Executive', '2nd Floor', 3, 'King'), ('206', 'Executive', '2nd Floor', 3, 'King'),
          ('301', 'Executive', '3rd Floor', 3, 'King'), ('302', 'Executive', '3rd Floor', 3, 'King'),
          ('303', 'Suite', '3rd Floor', 4, 'King'),     ('304', 'Suite', '3rd Floor', 4, 'King')
        ) v(room_no, room_type, floor, occ, bed)
      loop
        insert into public.rooms (id, property_id, room_no, room_type, floor, max_occupancy, bed_type, is_active)
        values (gen_random_uuid(), pid, rec.room_no, rec.room_type, rec.floor, rec.occ, rec.bed, true)
        on conflict do nothing;
        get diagnostics n = row_count;
        if n = 0 then
          -- room_no is still unique across properties and another property uses this number
          insert into public.rooms (id, property_id, room_no, room_type, floor, max_occupancy, bed_type, is_active)
          values (gen_random_uuid(), pid, upper(p_code) || '-' || rec.room_no, rec.room_type, rec.floor, rec.occ, rec.bed, true)
          on conflict do nothing;
          cnt := cnt + 1;
        end if;
      end loop;
      rep := rep || jsonb_build_object('rooms', case when cnt = 0 then 'seeded'
        else format('seeded; %s room numbers were taken by another property and got the prefix %s-', cnt, upper(p_code)) end);
    end if;
  exception when others then rep := rep || jsonb_build_object('rooms', 'error: ' || sqlerrm);
  end;

  begin
    if exists (select 1 from public.tariff_plans where property_id = pid) then
      rep := rep || '{"tariff_plans":"skipped"}';
    else
      insert into public.tariff_plans (id, property_id, code, name, room_type, base_rate, weekend_rate, meal_plan,
                                       cancellation_policy, min_nights, valid_from, valid_to, status)
      select gen_random_uuid(), pid, v.code, v.name, v.room_type, v.rate, v.weekend, v.meal,
             'Free cancellation up to 24 hours before arrival', 1, make_date(yr, 1, 1), make_date(yr + 1, 12, 31), 'Active'
      from (values
        ('RACK', 'Rack Rate (Room Only)', 'All Types', 2500, 2900, 'EP'),
        ('STD-CP', 'Standard with Breakfast', 'Standard', 2900, 3300, 'CP'),
        ('DLX-CP', 'Deluxe with Breakfast', 'Deluxe', 4300, 4800, 'CP'),
        ('EXE-MAP', 'Executive Half Board', 'Executive', 6200, 6800, 'MAP'),
        ('STE-AP', 'Suite Full Board', 'Suite', 10500, 11500, 'AP'),
        ('CORP', 'Corporate Rate', 'All Types', 2200, 2200, 'CP')
      ) v(code, name, room_type, rate, weekend, meal);
      rep := rep || '{"tariff_plans":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('tariff_plans', 'error: ' || sqlerrm);
  end;

  begin
    if exists (select 1 from public.booking_sources where property_id = pid) then
      rep := rep || '{"booking_sources":"skipped"}';
    else
      insert into public.booking_sources (id, property_id, code, name, description, status)
      select gen_random_uuid(), pid, v.code, v.name, v.descr, 'Active'
      from (values
        ('WALKIN', 'Walk-in', 'Front desk walk-in'),
        ('PHONE', 'Phone / Email', 'Direct reservation by phone or email'),
        ('WEB', 'Website', 'Hotel website booking engine'),
        ('BKG', 'Booking.com', 'OTA channel'),
        ('MMT', 'MakeMyTrip', 'OTA channel'),
        ('CORP', 'Corporate', 'Contracted corporate accounts'),
        ('TA', 'Travel Agent', 'Offline travel agents and tour operators')
      ) v(code, name, descr);
      rep := rep || '{"booking_sources":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('booking_sources', 'error: ' || sqlerrm);
  end;

  begin
    if exists (select 1 from public.companies where property_id = pid) then
      rep := rep || '{"companies":"skipped"}';
    else
      -- Accounts party for each company (needed for bill-to-company posting)
      begin
        insert into public.acc_parties (property_id, party_code, party_name, short_name, party_type_id, party_sub_type_id, party_group,
                                        entity_type, country, currency_id, credit_days, credit_limit, receivable_account_id, remarks, created_by)
        select pid, v.code, v.name, v.short_name, pst.party_type_id, pst.id, 'Sundry Debtors', 'Company', 'India',
               (select c.id from public.acc_currencies c where c.property_id = pid limit 1), 30, v.credit,
               public.acc_account_id_by_code(pid, '1191'), 'Demo corporate account', 'System'
        from (values
          ('P-0101', 'Tata Consultancy Services', 'TCS', 500000),
          ('P-0102', 'Infosys Limited', 'Infosys', 400000),
          ('P-0103', 'Odisha Tourism Development Corp', 'OTDC', 200000)
        ) v(code, name, short_name, credit)
        join public.acc_party_sub_types pst on pst.property_id = pid and pst.sub_type_code = 'CORPCONTRACT'
        on conflict do nothing;
      exception when others then null;
      end;

      insert into public.companies (id, property_id, code, name, type, contact_person, email, phone, gst_number,
                                    address, city, corporate_discount, credit_limit, status, party_id)
      select gen_random_uuid(), pid, v.code, v.name, 'Corporate', v.contact, v.email, v.phone, v.gst, v.addr, v.city, v.disc, v.credit, 'Active',
             (select ap.id from public.acc_parties ap where ap.property_id = pid and ap.party_code = v.code limit 1)
      from (values
        ('P-0101', 'Tata Consultancy Services', 'Anita Rao', 'travel.desk@tcs.example.com', '+91 674 668 0000', '21AAACT2727Q1ZV', 'Infocity, Patia', 'Bhubaneswar', 12, 500000),
        ('P-0102', 'Infosys Limited', 'Rahul Menon', 'events@infosys.example.com', '+91 80 2852 0261', '29AAACI4798L1ZX', 'Electronics City, Hosur Road', 'Bengaluru', 10, 400000),
        ('P-0103', 'Odisha Tourism Development Corp', 'S. Mohanty', 'booking@otdc.example.com', '+91 674 243 2382', '21AAACO1234D1Z5', 'Jayadev Vihar', 'Bhubaneswar', 8, 200000)
      ) v(code, name, contact, email, phone, gst, addr, city, disc, credit);
      rep := rep || '{"companies":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('companies', 'error: ' || sqlerrm);
  end;

  begin
    if exists (select 1 from public.guests where property_id = pid) then
      rep := rep || '{"guests":"skipped"}';
    else
      insert into public.guests (id, property_id, name, mobile, email, nationality, total_stays, loyalty_points, id_type, id_number,
                                 address, member_since, gender, city, state, country, pincode)
      select gen_random_uuid(), pid, v.name, v.mobile, v.email, 'Indian', 0, 0, 'Aadhaar', '', v.addr,
             to_char(today, 'Mon YYYY'), v.gender, v.city, v.state, 'India', v.pin
      from (values
        ('Rohan Mehta', '9811000001', 'rohan.mehta@example.com', 'Male', '12 MG Road', 'Mumbai', 'Maharashtra', '400001'),
        ('Sneha Iyer', '9811000002', 'sneha.iyer@example.com', 'Female', '44 Anna Salai', 'Chennai', 'Tamil Nadu', '600002'),
        ('Arjun Das', '9811000003', 'arjun.das@example.com', 'Male', 'Plot 7, Saheed Nagar', 'Bhubaneswar', 'Odisha', '751007'),
        ('Priya Nair', '9811000004', 'priya.nair@example.com', 'Female', '9 Park Street', 'Kolkata', 'West Bengal', '700016')
      ) v(name, mobile, email, gender, addr, city, state, pin);
      rep := rep || '{"guests":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('guests', 'error: ' || sqlerrm);
  end;

  -- Housekeeping -------------------------------------------------------------------------------
  begin
    insert into public.hk_rooms (id, property_id, room_id, status)
    select gen_random_uuid()::text, pid, rm.id, 'CLEAN'
    from public.rooms rm
    where rm.property_id = pid and not exists (select 1 from public.hk_rooms h where h.room_id = rm.id);
    rep := rep || '{"hk_rooms":"seeded"}';
  exception when others then rep := rep || jsonb_build_object('hk_rooms', 'error: ' || sqlerrm);
  end;

  begin
    if exists (select 1 from public.public_areas where property_id = pid) then
      rep := rep || '{"public_areas":"skipped"}';
    else
      insert into public.public_areas (id, property_id, area_code, name, area_type, location, floor_number, is_active)
      select gen_random_uuid()::text, pid, v.code, v.name, v.area_type, v.loc, v.floor, true
      from (values
        ('PA-LOBBY', 'Main Lobby & Reception', 'Lobby', 'Ground floor entrance', 0),
        ('PA-REST', 'Restaurant Dining Area', 'Restaurant', 'Ground floor, east wing', 0),
        ('PA-POOL', 'Swimming Pool Deck', 'Pool', 'Garden level', 0),
        ('PA-GYM', 'Fitness Centre', 'Gym', '1st floor, west wing', 1),
        ('PA-COR1', '1st Floor Corridor', 'Corridor', '1st floor', 1),
        ('PA-COR2', '2nd Floor Corridor', 'Corridor', '2nd floor', 2),
        ('PA-BANQ', 'Banquet Hall Foyer', 'Banquet', 'Ground floor, west wing', 0)
      ) v(code, name, area_type, loc, floor);
      rep := rep || '{"public_areas":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('public_areas', 'error: ' || sqlerrm);
  end;

  begin
    if exists (select 1 from public.hk_inventory where property_id = pid) then
      rep := rep || '{"hk_inventory":"skipped"}';
    else
      insert into public.hk_inventory (id, property_id, name, category, available, laundry, damaged, lost, discarded, par_stock, unit)
      select gen_random_uuid()::text, pid, v.name, v.cat, v.avail, 0, 0, 0, 0, v.par, 'Pcs'
      from (values
        ('King Bed Sheets', 'Linen', 60, 64), ('Queen Bed Sheets', 'Linen', 50, 48), ('Pillow Covers', 'Linen', 140, 128),
        ('Bath Towels', 'Linen', 90, 96), ('Hand Towels', 'Linen', 90, 96), ('Bath Robes', 'Linen', 20, 16),
        ('Shampoo Bottles', 'Amenities', 300, 200), ('Soap Bars', 'Amenities', 400, 250), ('Dental Kits', 'Amenities', 200, 150)
      ) v(name, cat, avail, par);
      rep := rep || '{"hk_inventory":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('hk_inventory', 'error: ' || sqlerrm);
  end;

  -- F&B ----------------------------------------------------------------------------------------
  begin
    if exists (select 1 from public.fb_outlet_types where property_id = pid) then
      rep := rep || '{"fb_outlet_types":"skipped"}';
    else
      insert into public.fb_outlet_types (id, property_id, code, name, description, has_tables, has_kds, status)
      select gen_random_uuid(), pid, v.code, v.name, v.descr, v.tables, v.kds, 'Active'
      from (values
        ('REST', 'Restaurant', 'Full-service dining with table management', 'Yes', 'Yes'),
        ('CAFE', 'Cafe', 'Quick-service cafe counter', 'Yes', 'Yes'),
        ('BAR', 'Bar & Lounge', 'Beverage service with small plates', 'Yes', 'No'),
        ('RS', 'Room Service', 'In-room dining', 'No', 'Yes')
      ) v(code, name, descr, tables, kds);
      rep := rep || '{"fb_outlet_types":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('fb_outlet_types', 'error: ' || sqlerrm);
  end;

  begin
    if exists (select 1 from public.fb_outlets where property_id = pid) then
      rep := rep || '{"fb_outlets":"skipped"}';
    else
      insert into public.fb_outlets (id, property_id, name, type, status, tables, covers)
      select gen_random_uuid(), pid, v.name, v.type, 'Active', v.tables, 0
      from (values ('The Spice Route', 'restaurant', 8), ('Lobby Cafe', 'cafe', 4), ('Sky Lounge Bar', 'bar', 4)) v(name, type, tables);

      insert into public.fb_live_tables (id, property_id, outlet_id, table_no, capacity, covers, guest, server, duration_min,
                                         check_amount, status, shape, qr, housekeeping, is_active)
      select gen_random_uuid(), pid, o.id, 'T-' || lpad(g::text, 2, '0'), case when g % 3 = 0 then 6 when g % 2 = 0 then 4 else 2 end,
             0, '—', '—', 0, 0, 'Available', case when g % 2 = 0 then 'Square' else 'Round' end, 'Pending', 'CLEAN', true
      from public.fb_outlets o
      cross join lateral generate_series(1, o.tables) g
      where o.property_id = pid;
      rep := rep || '{"fb_outlets":"seeded","fb_live_tables":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('fb_outlets', 'error: ' || sqlerrm);
  end;

  begin
    if exists (select 1 from public.fnb_units where property_id = pid) then
      rep := rep || '{"fnb_units":"skipped"}';
    else
      insert into public.fnb_units (id, property_id, code, name, symbol, unit_type, decimal_places, is_active)
      select gen_random_uuid(), pid, v.code, v.name, v.sym, v.utype, v.dec, true
      from (values
        ('PLT', 'Plate', 'plt', 'Count', 0), ('PCS', 'Piece', 'pc', 'Count', 0), ('GLS', 'Glass', 'gls', 'Count', 0),
        ('BTL', 'Bottle', 'btl', 'Count', 0), ('KG', 'Kilogram', 'kg', 'Weight', 2), ('LTR', 'Litre', 'L', 'Volume', 2)
      ) v(code, name, sym, utype, dec);
      rep := rep || '{"fnb_units":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('fnb_units', 'error: ' || sqlerrm);
  end;

  begin
    if exists (select 1 from public.fnb_tax_groups where property_id = pid) then
      rep := rep || '{"fnb_tax_groups":"skipped"}';
    else
      insert into public.fnb_tax_groups (id, property_id, code, name, description, tax_codes, total_rate, applies_to, is_active)
      select gen_random_uuid(), pid, v.code, v.name, v.descr, v.codes, v.rate, v.applies, true
      from (values
        ('TG-FOOD5', 'Food GST 5%', 'Restaurant food (no ITC)', 'CGST2.5,SGST2.5', 5, 'Food'),
        ('TG-BEV5', 'Beverage GST 5%', 'Non-alcoholic beverages', 'CGST2.5,SGST2.5', 5, 'Beverage'),
        ('TG-LIQ18', 'Liquor GST 18%', 'Alcoholic beverages', 'CGST9,SGST9', 18, 'Liquor')
      ) v(code, name, descr, codes, rate, applies);
      rep := rep || '{"fnb_tax_groups":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('fnb_tax_groups', 'error: ' || sqlerrm);
  end;

  begin
    if exists (select 1 from public.fnb_menu_categories where property_id = pid) then
      rep := rep || '{"fnb_menu_categories":"skipped"}';
    else
      insert into public.fnb_menu_categories (id, property_id, name, code, description, is_active)
      select gen_random_uuid(), pid, v.name, v.code, v.descr, true
      from (values
        ('Starters', 'STAR', 'Appetizers and small plates'), ('Main Course', 'MAIN', 'Curries, grills and mains'),
        ('Breads', 'BRD', 'Tandoor breads'), ('Rice & Biryani', 'RICE', 'Rice dishes and biryanis'),
        ('Desserts', 'DSRT', 'Sweets and desserts'), ('Beverages', 'BEV', 'Hot and cold non-alcoholic drinks'),
        ('Bar', 'BAR', 'Beer, wine and spirits')
      ) v(name, code, descr);
      rep := rep || '{"fnb_menu_categories":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('fnb_menu_categories', 'error: ' || sqlerrm);
  end;

  begin
    if exists (select 1 from public.fnb_menu_items where property_id = pid) then
      rep := rep || '{"fnb_menu_items":"skipped"}';
    else
      insert into public.fnb_menu_items (id, property_id, item_code, name, description, category_id, unit_id, is_vegetarian, is_active, price)
      select gen_random_uuid(), pid, v.code, v.name, v.descr, c.id, u.id, v.veg, true, v.price
      from (values
        ('IT-PT01', 'Paneer Tikka', 'Char-grilled cottage cheese with peppers', 'STAR', 'PLT', true, 280),
        ('IT-CT01', 'Chicken 65', 'Spicy fried chicken, South Indian style', 'STAR', 'PLT', false, 320),
        ('IT-VS01', 'Veg Spring Rolls', 'Crispy rolls with sweet chilli dip', 'STAR', 'PLT', true, 220),
        ('IT-BC01', 'Butter Chicken', 'Creamy tomato-based chicken curry', 'MAIN', 'PLT', false, 420),
        ('IT-DM01', 'Dal Makhani', 'Slow-cooked black lentils', 'MAIN', 'PLT', true, 290),
        ('IT-PB01', 'Paneer Butter Masala', 'Cottage cheese in rich tomato gravy', 'MAIN', 'PLT', true, 340),
        ('IT-FC01', 'Fish Curry (Odia style)', 'Rohu in mustard gravy', 'MAIN', 'PLT', false, 450),
        ('IT-BN01', 'Butter Naan', 'Tandoor bread with butter', 'BRD', 'PCS', true, 70),
        ('IT-TR01', 'Tandoori Roti', 'Whole wheat tandoor bread', 'BRD', 'PCS', true, 40),
        ('IT-SR01', 'Steamed Rice', 'Basmati rice', 'RICE', 'PLT', true, 150),
        ('IT-CB01', 'Chicken Biryani', 'Dum-cooked basmati with chicken', 'RICE', 'PLT', false, 380),
        ('IT-VB01', 'Veg Biryani', 'Dum-cooked basmati with vegetables', 'RICE', 'PLT', true, 300),
        ('IT-GJ01', 'Gulab Jamun', 'Two pieces, warm', 'DSRT', 'PLT', true, 120),
        ('IT-IC01', 'Ice Cream Scoop', 'Vanilla / chocolate / strawberry', 'DSRT', 'PLT', true, 100),
        ('IT-MC01', 'Masala Chai', 'Indian spiced tea', 'BEV', 'GLS', true, 60),
        ('IT-CF01', 'Cappuccino', 'Espresso with steamed milk', 'BEV', 'GLS', true, 160),
        ('IT-FL01', 'Fresh Lime Soda', 'Sweet or salted', 'BEV', 'GLS', true, 120),
        ('IT-MW01', 'Mineral Water', '1 litre bottle', 'BEV', 'BTL', true, 60),
        ('IT-KB01', 'Kingfisher Beer', '650 ml bottle', 'BAR', 'BTL', true, 350),
        ('IT-WH01', 'Whisky (30 ml)', 'Premium blended whisky', 'BAR', 'GLS', true, 300)
      ) v(code, name, descr, cat, unit, veg, price)
      join public.fnb_menu_categories c on c.property_id = pid and c.code = v.cat
      left join public.fnb_units u on u.property_id = pid and u.code = v.unit;
      rep := rep || '{"fnb_menu_items":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('fnb_menu_items', 'error: ' || sqlerrm);
  end;

  begin
    if exists (select 1 from public.fb_modifier_groups where property_id = pid) then
      rep := rep || '{"fb_modifiers":"skipped"}';
    else
      insert into public.fb_modifier_groups (id, property_id, code, name, min_select, max_select, is_required, status,
                                             description, selection_type, sort_order)
      select gen_random_uuid(), pid, v.code, v.name, v.min_s, v.max_s, v.req, 'Active', v.descr, v.sel, v.sort
      from (values
        ('MG-SPICE', 'Spice Level', 1, 1, true, 'Choose how spicy', 'single', 0),
        ('MG-ADDON', 'Add-ons', 0, 3, false, 'Optional extras', 'multiple', 1)
      ) v(code, name, min_s, max_s, req, descr, sel, sort);

      insert into public.fb_modifiers (id, property_id, code, name, price, status, group_id, is_default, sort_order)
      select gen_random_uuid(), pid, v.code, v.name, v.price, 'Active', g.id, v.def, v.sort
      from (values
        ('MG-SPICE', 'MILD', 'Mild', 0, true, 0), ('MG-SPICE', 'MED', 'Medium', 0, false, 1), ('MG-SPICE', 'HOT', 'Hot', 0, false, 2),
        ('MG-ADDON', 'XCHS', 'Extra Cheese', 40, false, 0), ('MG-ADDON', 'XBTR', 'Extra Butter', 20, false, 1),
        ('MG-ADDON', 'XRAI', 'Raita', 50, false, 2)
      ) v(grp, code, name, price, def, sort)
      join public.fb_modifier_groups g on g.property_id = pid and g.code = v.grp;
      rep := rep || '{"fb_modifiers":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('fb_modifiers', 'error: ' || sqlerrm);
  end;

  begin
    if exists (select 1 from public.fb_ingredients where property_id = pid) then
      rep := rep || '{"fb_ingredients":"skipped"}';
    else
      insert into public.fb_ingredients (id, property_id, code, name, uom, on_hand, reorder, status)
      select gen_random_uuid(), pid, v.code, v.name, v.uom, v.on_hand, v.reorder, 'Active'
      from (values
        ('CHK', 'Chicken', 'kg', 25, 10), ('PNR', 'Paneer', 'kg', 12, 5), ('RICE', 'Basmati Rice', 'kg', 50, 20),
        ('ATTA', 'Wheat Flour', 'kg', 40, 15), ('BTR', 'Butter', 'kg', 8, 3), ('MILK', 'Milk', 'L', 30, 10),
        ('ONN', 'Onion', 'kg', 30, 10), ('TOM', 'Tomato', 'kg', 25, 10)
      ) v(code, name, uom, on_hand, reorder);
      rep := rep || '{"fb_ingredients":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('fb_ingredients', 'error: ' || sqlerrm);
  end;

  -- Purchase & Stores --------------------------------------------------------------------------
  begin
    if exists (select 1 from public.ps_units where property_id = pid) then
      rep := rep || '{"ps_units":"skipped"}';
    else
      insert into public.ps_units (id, property_id, unit_code, unit_name, symbol, description, status, created_date)
      select gen_random_uuid(), pid, v.code, v.name, v.sym, v.descr, 'Active', today
      from (values
        ('UNT-PCS', 'Pieces', 'Pcs', 'Individual count items'), ('UNT-KG', 'Kilograms', 'Kg', 'Weight'),
        ('UNT-LTR', 'Litres', 'Ltr', 'Volume'), ('UNT-BOX', 'Boxes', 'Box', 'Boxed packs'),
        ('UNT-PKT', 'Packets', 'Pkt', 'Packets'), ('UNT-BTL', 'Bottles', 'Btl', 'Bottles')
      ) v(code, name, sym, descr);
      rep := rep || '{"ps_units":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('ps_units', 'error: ' || sqlerrm);
  end;

  begin
    if exists (select 1 from public.ps_categories where property_id = pid) then
      rep := rep || '{"ps_categories":"skipped"}';
    else
      insert into public.ps_categories (id, property_id, category_code, category_name, department, description, product_count, status, created_date)
      select gen_random_uuid(), pid, v.code, v.name, v.dept, v.descr, 0, 'Active', today
      from (values
        ('CAT-LIN', 'Housekeeping Linen', 'Housekeeping', 'Bed and bath linen'),
        ('CAT-AMN', 'Guest Amenities', 'Housekeeping', 'Toiletries and in-room amenities'),
        ('CAT-CHM', 'Cleaning Chemicals', 'Housekeeping', 'Detergents and cleaning agents'),
        ('CAT-GRO', 'Kitchen Groceries', 'Food & Beverage', 'Dry groceries and staples'),
        ('CAT-BEV', 'Beverages', 'Food & Beverage', 'Soft drinks, water, beverages'),
        ('CAT-ENG', 'Engineering Spares', 'Engineering', 'Electrical and plumbing spares'),
        ('CAT-STN', 'Stationery', 'Administration', 'Office stationery and printing')
      ) v(code, name, dept, descr);
      rep := rep || '{"ps_categories":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('ps_categories', 'error: ' || sqlerrm);
  end;

  begin
    if exists (select 1 from public.ps_warehouses where property_id = pid) then
      rep := rep || '{"ps_warehouses":"skipped"}';
    else
      insert into public.ps_warehouses (id, property_id, code, name, type, location, status)
      select gen_random_uuid(), pid, v.code, v.name, v.type, v.loc, 'Active'
      from (values
        ('WH-MAIN', 'Main Store', 'Warehouse', 'Basement level 1'),
        ('WH-KIT', 'Kitchen Store', 'Store', 'Main kitchen'),
        ('WH-HK', 'Housekeeping Store', 'Store', 'Service floor'),
        ('WH-BAR', 'Bar Store', 'Store', 'Sky Lounge back area')
      ) v(code, name, type, loc);
      rep := rep || '{"ps_warehouses":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('ps_warehouses', 'error: ' || sqlerrm);
  end;

  begin
    if exists (select 1 from public.ps_suppliers where property_id = pid) then
      rep := rep || '{"ps_suppliers":"skipped"}';
    else
      begin
        insert into public.acc_parties (property_id, party_code, party_name, short_name, party_type_id, party_sub_type_id, party_group,
                                        entity_type, country, currency_id, credit_days, credit_limit, payable_account_id, remarks, created_by)
        select pid, v.code, v.name, v.short_name, pst.party_type_id, pst.id, 'Sundry Creditors', 'Company', 'India',
               (select c.id from public.acc_currencies c where c.property_id = pid limit 1), 30, 0,
               public.acc_account_id_by_code(pid, '2410'), 'Demo supplier', 'System'
        from (values
          ('P-0201', 'Fresh Farms Produce', 'Fresh Farms', 'FNBSUP'),
          ('P-0202', 'Kalinga Linen House', 'Kalinga Linen', 'GENSUP'),
          ('P-0203', 'CleanPro Chemicals', 'CleanPro', 'GENSUP'),
          ('P-0204', 'Utkal Beverages', 'Utkal Bev', 'FNBSUP')
        ) v(code, name, short_name, sub_type)
        join public.acc_party_sub_types pst on pst.property_id = pid and pst.sub_type_code = v.sub_type
        on conflict do nothing;
      exception when others then null;
      end;

      insert into public.ps_suppliers (id, property_id, supplier_code, supplier_name, contact_person, phone, email, gstin, pan_number,
                                       payment_terms, address, city, rating, status, created_date, party_id)
      select gen_random_uuid(), pid, v.code, v.name, v.contact, v.phone, v.email, v.gstin, v.pan, 'Net 30 Days', v.addr, v.city, v.rating,
             'Active', today, (select ap.id from public.acc_parties ap where ap.property_id = pid and ap.party_code = v.code limit 1)
      from (values
        ('P-0201', 'Fresh Farms Produce', 'Bikash Sahoo', '+91 674 255 1001', 'orders@freshfarms.example.com', '21AABCF1001A1Z1', 'AABCF1001A', 'Unit 8, Rasulgarh', 'Bhubaneswar', 4),
        ('P-0202', 'Kalinga Linen House', 'Meera Patnaik', '+91 674 255 1002', 'sales@kalingalinen.example.com', '21AABCK1002B1Z2', 'AABCK1002B', 'Cuttack Road', 'Bhubaneswar', 5),
        ('P-0203', 'CleanPro Chemicals', 'Amit Jena', '+91 674 255 1003', 'support@cleanpro.example.com', '21AABCC1003C1Z3', 'AABCC1003C', 'Mancheswar Industrial Estate', 'Bhubaneswar', 4),
        ('P-0204', 'Utkal Beverages', 'Ramesh Behera', '+91 674 255 1004', 'trade@utkalbev.example.com', '21AABCU1004D1Z4', 'AABCU1004D', 'Patia Square', 'Bhubaneswar', 3)
      ) v(code, name, contact, phone, email, gstin, pan, addr, city, rating);
      rep := rep || '{"ps_suppliers":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('ps_suppliers', 'error: ' || sqlerrm);
  end;

  begin
    if exists (select 1 from public.ps_products where property_id = pid) then
      rep := rep || '{"ps_products":"skipped"}';
    else
      insert into public.ps_products (id, property_id, product_code, product_name, category, unit, brand, description,
                                      minimum_stock, maximum_stock, par_stock, reorder_level, storage_type, status, created_date)
      select gen_random_uuid(), pid, v.code, v.name, v.cat, v.unit, v.brand, v.descr, v.min_s, v.max_s, v.par, v.reorder, v.storage, 'Active', today
      from (values
        ('PRD-LIN-001', 'King Bed Sheet', 'Housekeeping Linen', 'Pieces', 'Bombay Dyeing', 'White 300 TC king sheet', 20, 120, 64, 30, 'Dry Storage'),
        ('PRD-LIN-002', 'Bath Towel', 'Housekeeping Linen', 'Pieces', 'Welspun', 'White 600 GSM bath towel', 30, 150, 96, 40, 'Dry Storage'),
        ('PRD-AMN-001', 'Shampoo 30 ml', 'Guest Amenities', 'Pieces', 'Forest Essentials', 'Guest shampoo bottle', 100, 600, 300, 150, 'Dry Storage'),
        ('PRD-AMN-002', 'Soap Bar 25 g', 'Guest Amenities', 'Pieces', 'Forest Essentials', 'Guest soap', 100, 800, 400, 200, 'Dry Storage'),
        ('PRD-CHM-001', 'Floor Cleaner 5 L', 'Cleaning Chemicals', 'Litres', 'Taski', 'Concentrated floor cleaner', 10, 60, 30, 15, 'Chemical Storage'),
        ('PRD-GRO-001', 'Basmati Rice', 'Kitchen Groceries', 'Kilograms', 'India Gate', 'Premium basmati rice', 20, 150, 60, 30, 'Dry Storage'),
        ('PRD-GRO-002', 'Wheat Flour', 'Kitchen Groceries', 'Kilograms', 'Aashirvaad', 'Whole wheat atta', 20, 120, 50, 25, 'Dry Storage'),
        ('PRD-BEV-001', 'Mineral Water 1 L', 'Beverages', 'Bottles', 'Bisleri', 'Packaged drinking water', 48, 480, 240, 96, 'Dry Storage'),
        ('PRD-ENG-001', 'LED Bulb 9W', 'Engineering Spares', 'Pieces', 'Philips', 'Warm white LED bulb', 20, 100, 40, 20, 'Dry Storage'),
        ('PRD-STN-001', 'A4 Paper Ream', 'Stationery', 'Packets', 'JK Copier', '500 sheets, 75 GSM', 5, 40, 20, 10, 'Dry Storage')
      ) v(code, name, cat, unit, brand, descr, min_s, max_s, par, reorder, storage);
      rep := rep || '{"ps_products":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('ps_products', 'error: ' || sqlerrm);
  end;

  -- Human Resources ----------------------------------------------------------------------------
  begin
    if exists (select 1 from public.hr_departments where property_id = pid) then
      rep := rep || '{"hr_masters":"skipped"}';
    else
      insert into public.hr_departments (id, property_id, dept_code, department_name, head_of_department, location, description, status)
      select gen_random_uuid()::text, pid, v.code, v.name, v.head, v.loc, v.descr, 'Active'
      from (values
        ('FO-10', 'Front Office', 'Rajesh Kumar', 'Main lobby', 'Reception, reservations, concierge and cashiering'),
        ('HK-20', 'Housekeeping', 'Anjali Sharma', 'Service floor', 'Rooms, laundry and public areas'),
        ('FB-30', 'Food & Beverage', 'Vikram Singh', 'Restaurant', 'Restaurant, bar and room service'),
        ('KT-35', 'Kitchen', 'Chef Arvind Rao', 'Main kitchen', 'Food production'),
        ('EN-50', 'Engineering', 'Suresh Pradhan', 'Plant room', 'Maintenance and utilities'),
        ('AC-60', 'Accounts', 'Neha Gupta', 'Back office', 'Finance and accounts'),
        ('HR-40', 'Human Resources', 'Pooja Verma', 'Back office', 'Recruitment, payroll and staff welfare'),
        ('SM-70', 'Sales & Marketing', 'Karan Malhotra', 'Back office', 'Corporate sales, events and marketing')
      ) v(code, name, head, loc, descr);

      insert into public.hr_designations (id, property_id, designation_code, designation_title, department_id, job_grade, description, status)
      select gen_random_uuid()::text, pid, v.code, v.title, d.id, v.grade, v.descr, 'Active'
      from (values
        ('DSG-FO-01', 'Front Office Manager', 'FO-10', 'M2', 'Leads the front office team'),
        ('DSG-FO-02', 'Front Desk Executive', 'FO-10', 'E2', 'Check-in, check-out and guest service'),
        ('DSG-HK-01', 'Executive Housekeeper', 'HK-20', 'M2', 'Leads housekeeping'),
        ('DSG-HK-02', 'Room Attendant', 'HK-20', 'S1', 'Cleans and services rooms'),
        ('DSG-FB-01', 'F&B Manager', 'FB-30', 'M2', 'Leads restaurant and bar'),
        ('DSG-FB-02', 'Steward', 'FB-30', 'S1', 'Table service'),
        ('DSG-KT-01', 'Executive Chef', 'KT-35', 'M3', 'Leads the kitchen'),
        ('DSG-EN-01', 'Chief Engineer', 'EN-50', 'M2', 'Leads engineering'),
        ('DSG-AC-01', 'Accounts Executive', 'AC-60', 'E2', 'Day-to-day accounting'),
        ('DSG-HR-01', 'HR Manager', 'HR-40', 'M2', 'Leads HR'),
        ('DSG-SM-01', 'Sales Manager', 'SM-70', 'M1', 'Corporate and event sales')
      ) v(code, title, dept, grade, descr)
      join public.hr_departments d on d.property_id = pid and d.dept_code = v.dept;

      insert into public.hr_employment_types (id, property_id, type_code, type_name, working_term, probation_days, notice_period_days,
                                              pf_eligible, esi_eligible, leave_eligible, description, status)
      select gen_random_uuid()::text, pid, v.code, v.name, v.term, v.prob, v.notice, v.pf, v.esi, v.leave, v.descr, 'Active'
      from (values
        ('ET-PERM', 'Permanent', 'Full-time permanent employment', 90, 30, true, true, true, 'Permanent staff with full benefits'),
        ('ET-PROB', 'Probation', 'Full-time on probation', 90, 15, true, true, true, 'New joiners on probation'),
        ('ET-CONT', 'Contract', 'Fixed-term contract', 0, 15, false, true, true, 'Seasonal or project staff'),
        ('ET-INTN', 'Intern', 'Internship / industrial training', 0, 7, false, false, false, 'Hotel management trainees')
      ) v(code, name, term, prob, notice, pf, esi, leave, descr);

      insert into public.hr_shift_types (id, property_id, shift_code, shift_name, category, start_time, end_time, break_duration_minutes,
                                         total_working_hours, is_night_shift, night_allowance_eligible, description, status)
      select gen_random_uuid()::text, pid, v.code, v.name, v.cat, v.st, v.et, 30, 7.5, v.night, v.night, v.descr, 'Active'
      from (values
        ('SH-MRN', 'Morning Shift', 'Regular', '07:00', '15:00', false, 'Morning operations'),
        ('SH-EVE', 'Evening Shift', 'Regular', '15:00', '23:00', false, 'Evening operations'),
        ('SH-NGT', 'Night Shift', 'Night', '23:00', '07:00', true, 'Night audit and security'),
        ('SH-GEN', 'General Shift', 'Regular', '09:30', '18:00', false, 'Back-office staff')
      ) v(code, name, cat, st, et, night, descr);

      insert into public.hr_leave_types (id, property_id, leave_code, leave_name, annual_quota_days, pay_type, carry_forward_allowed,
                                         max_carry_forward_days, encashable, requires_medical_proof, description, status)
      select gen_random_uuid()::text, pid, v.code, v.name, v.days, v.pay, v.cf, v.max_cf, v.enc, v.med, v.descr, 'Active'
      from (values
        ('LV-CL', 'Casual Leave (CL)', 12, 'Paid', false, 0, false, false, 'Short personal absences'),
        ('LV-SL', 'Sick Leave (SL)', 8, 'Paid', true, 16, false, true, 'Illness; certificate for 3+ days'),
        ('LV-EL', 'Earned Leave (EL)', 15, 'Paid', true, 30, true, false, 'Annual vacation leave'),
        ('LV-LOP', 'Loss of Pay (LOP)', 0, 'Unpaid', false, 0, false, false, 'Leave without pay')
      ) v(code, name, days, pay, cf, max_cf, enc, med, descr);

      insert into public.hr_leave_policies (id, property_id, policy_code, policy_name, total_annual_days, applicable_employment_types,
                                            allocations, description, status)
      select gen_random_uuid()::text, pid, 'LP-STD', 'Standard Policy',
             (select coalesce(sum(annual_quota_days), 0) from public.hr_leave_types where property_id = pid and leave_code in ('LV-CL', 'LV-SL', 'LV-EL')),
             (select coalesce(jsonb_agg(id), '[]'::jsonb) from public.hr_employment_types where property_id = pid and type_code in ('ET-PERM', 'ET-PROB')),
             (select coalesce(jsonb_agg(jsonb_build_object('leaveTypeId', id, 'days', annual_quota_days)), '[]'::jsonb)
                from public.hr_leave_types where property_id = pid and leave_code in ('LV-CL', 'LV-SL', 'LV-EL')),
             'Default leave policy for permanent and probation staff', 'Active';

      insert into public.hr_holidays (id, property_id, holiday_code, holiday_name, holiday_date, day_of_week, category, is_mandatory,
                                      extra_pay_multiplier, description, status, year)
      select gen_random_uuid()::text, pid, v.code, v.name, make_date(yr, v.m, v.d), to_char(make_date(yr, v.m, v.d), 'FMDay'),
             v.cat, true, 2, v.cat || ' holiday', 'Active', yr
      from (values
        ('HOL-NY', 'New Year''s Day', 1, 1, 'Festival'), ('HOL-REP', 'Republic Day', 1, 26, 'National'),
        ('HOL-LAB', 'Labour Day', 5, 1, 'National'), ('HOL-IND', 'Independence Day', 8, 15, 'National'),
        ('HOL-GAN', 'Gandhi Jayanti', 10, 2, 'National'), ('HOL-XMS', 'Christmas', 12, 25, 'Festival')
      ) v(code, name, m, d, cat);

      insert into public.hr_salary_components (id, property_id, code, name, component_type, calculation_type, default_value,
                                               is_taxable, is_pf_applicable, is_esi_applicable, description, status)
      select gen_random_uuid()::text, pid, v.code, v.name, v.ctype, v.calc, v.val, v.tax, v.pf, v.esi, v.descr, 'Active'
      from (values
        ('BASIC', 'Basic Salary', 'Earning', 'Fixed', 0, true, true, true, 'Core salary component'),
        ('HRA', 'House Rent Allowance', 'Earning', 'Percentage', 40, true, false, false, '40% of basic'),
        ('CONV', 'Conveyance Allowance', 'Earning', 'Fixed', 1600, false, false, false, 'Monthly conveyance'),
        ('SPL', 'Special Allowance', 'Earning', 'Fixed', 0, true, false, false, 'Balancing allowance'),
        ('PF', 'Provident Fund', 'Deduction', 'Percentage', 12, false, false, false, '12% of basic'),
        ('ESI', 'Employee State Insurance', 'Deduction', 'Percentage', 0.75, false, false, false, '0.75% of gross'),
        ('PT', 'Professional Tax', 'Deduction', 'Fixed', 200, false, false, false, 'State professional tax')
      ) v(code, name, ctype, calc, val, tax, pf, esi, descr);

      insert into public.hr_document_categories (id, property_id, name, description, is_mandatory)
      select gen_random_uuid()::text, pid, v.name, v.descr, v.mand
      from (values
        ('Identity Proof', 'Government-issued identity documents', true),
        ('Employment Documents', 'Offer letter, appointment letter, contracts', true),
        ('Education', 'Certificates and mark sheets', false),
        ('Bank & Statutory', 'Bank, PF and ESI documents', true)
      ) v(name, descr, mand);

      insert into public.hr_document_types (id, property_id, category_id, name, requires_expiry, is_mandatory, description)
      select gen_random_uuid()::text, pid, c.id, v.name, v.expiry, v.mand, v.descr
      from (values
        ('Identity Proof', 'Aadhaar Card', false, true, 'UIDAI identity proof'),
        ('Identity Proof', 'PAN Card', false, true, 'Income tax PAN'),
        ('Identity Proof', 'Passport', true, false, 'For foreign travel'),
        ('Employment Documents', 'Offer Letter', false, true, 'Signed offer letter'),
        ('Education', 'Highest Qualification Certificate', false, false, 'Degree or diploma'),
        ('Bank & Statutory', 'Cancelled Cheque', false, true, 'For salary account')
      ) v(cat, name, expiry, mand, descr)
      join public.hr_document_categories c on c.property_id = pid and c.name = v.cat;

      insert into public.hr_complaint_categories (id, property_id, category_name, description, review_level, status)
      select gen_random_uuid()::text, pid, v.name, v.descr, v.lvl, 'Active'
      from (values
        ('Workplace Harassment', 'Harassment and misconduct complaints', 'HR Manager'),
        ('Payroll & Benefits', 'Salary, payslip and benefits issues', 'HR Executive'),
        ('Facilities', 'Staff canteen, locker and uniform issues', 'HR Executive'),
        ('Scheduling', 'Shift and roster concerns', 'Department Head')
      ) v(name, descr, lvl);

      insert into public.hr_payroll_settings (id, property_id, settings)
      values (gen_random_uuid()::text, pid, jsonb_build_object(
        'frequency', 'Monthly', 'startDay', 1, 'endDay', 31, 'paymentDay', 7, 'enablePf', true, 'enableEsi', true,
        'enablePt', true, 'pfEmployeePct', 12, 'approvalRole', 'HR Manager'));

      rep := rep || '{"hr_masters":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('hr_masters', 'error: ' || sqlerrm);
  end;

  begin
    if exists (select 1 from public.hr_employees where property_id = pid) then
      rep := rep || '{"hr_employees":"skipped"}';
    else
      insert into public.hr_employees (id, property_id, emp_code, first_name, last_name, email, phone, department_id, designation_id,
                                       employment_type_id, shift_type_id, leave_policy_id, join_date, salary, status, gender, avatar,
                                       attendance_rate, leave_balance)
      select gen_random_uuid()::text, pid, v.code, v.fn, v.ln, v.email, v.phone, d.id, g.id, et.id, st.id, lp.id,
             today - v.days_ago, v.salary, 'Active', v.gender, upper(left(v.fn, 1) || left(v.ln, 1)), 100,
             jsonb_build_object('casual', 12, 'sick', 8, 'earned', 15)
      from (values
        ('EMP-0001', 'Rajesh', 'Kumar', 'rajesh.kumar@demohotel.example.com', '+91 98765 10001', 'FO-10', 'DSG-FO-01', 'ET-PERM', 'SH-MRN', 'Male', 720, 55000),
        ('EMP-0002', 'Priya', 'Patel', 'priya.patel@demohotel.example.com', '+91 98765 10002', 'FO-10', 'DSG-FO-02', 'ET-PERM', 'SH-EVE', 'Female', 400, 28000),
        ('EMP-0003', 'Anjali', 'Sharma', 'anjali.sharma@demohotel.example.com', '+91 98765 10003', 'HK-20', 'DSG-HK-01', 'ET-PERM', 'SH-MRN', 'Female', 900, 48000),
        ('EMP-0004', 'Ravi', 'Shankar', 'ravi.shankar@demohotel.example.com', '+91 98765 10004', 'HK-20', 'DSG-HK-02', 'ET-PROB', 'SH-MRN', 'Male', 45, 16000),
        ('EMP-0005', 'Vikram', 'Singh', 'vikram.singh@demohotel.example.com', '+91 98765 10005', 'FB-30', 'DSG-FB-01', 'ET-PERM', 'SH-GEN', 'Male', 600, 52000),
        ('EMP-0006', 'Arvind', 'Rao', 'arvind.rao@demohotel.example.com', '+91 98765 10006', 'KT-35', 'DSG-KT-01', 'ET-PERM', 'SH-GEN', 'Male', 1000, 75000),
        ('EMP-0007', 'Suresh', 'Pradhan', 'suresh.pradhan@demohotel.example.com', '+91 98765 10007', 'EN-50', 'DSG-EN-01', 'ET-PERM', 'SH-GEN', 'Male', 800, 50000),
        ('EMP-0008', 'Neha', 'Gupta', 'neha.gupta@demohotel.example.com', '+91 98765 10008', 'AC-60', 'DSG-AC-01', 'ET-PERM', 'SH-GEN', 'Female', 365, 35000)
      ) v(code, fn, ln, email, phone, dept, dsg, et_code, sh_code, gender, days_ago, salary)
      left join public.hr_departments d on d.property_id = pid and d.dept_code = v.dept
      left join public.hr_designations g on g.property_id = pid and g.designation_code = v.dsg
      left join public.hr_employment_types et on et.property_id = pid and et.type_code = v.et_code
      left join public.hr_shift_types st on st.property_id = pid and st.shift_code = v.sh_code
      left join public.hr_leave_policies lp on lp.property_id = pid and lp.policy_code = 'LP-STD';
      rep := rep || '{"hr_employees":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('hr_employees', 'error: ' || sqlerrm);
  end;

  -- Sales & Marketing --------------------------------------------------------------------------
  begin
    if exists (select 1 from public.sm_venues where property_id = pid) then
      rep := rep || '{"sm_masters":"skipped"}';
    else
      insert into public.sm_venues (id, property_id, venue_code, venue_name, venue_type, minimum_capacity, maximum_capacity, location, status, description)
      select gen_random_uuid()::text, pid, v.code, v.name, v.type, v.min_c, v.max_c, v.loc, 'Active', v.descr
      from (values
        ('VEN-001', 'Grand Ballroom', 'Banquet Hall', 80, 400, 'Ground floor, west wing', 'Pillarless ballroom for weddings and galas'),
        ('VEN-002', 'Garden Lawn', 'Lawn', 100, 500, 'East garden', 'Open-air lawn for receptions'),
        ('VEN-003', 'Board Room', 'Meeting Room', 6, 16, '1st floor', 'Boardroom with video conferencing'),
        ('VEN-004', 'Conference Hall', 'Conference Hall', 30, 120, '1st floor', 'Theatre and classroom setups')
      ) v(code, name, type, min_c, max_c, loc, descr);

      insert into public.sm_lead_sources (id, property_id, source_code, source_name, category, status, description)
      select gen_random_uuid()::text, pid, v.code, v.name, v.cat, 'Active', v.descr
      from (values
        ('SRC-001', 'Website Enquiry', 'Direct', 'Enquiry form on hotel website'),
        ('SRC-002', 'Walk-in', 'Direct', 'Visited the hotel'),
        ('SRC-003', 'Google Ads', 'Digital Advertising', 'Paid search'),
        ('SRC-004', 'Instagram', 'Social Media', 'Social media enquiries'),
        ('SRC-005', 'Referral', 'Referral', 'Referred by guest or partner'),
        ('SRC-006', 'Wedding Planner', 'Partner', 'Event and wedding planners')
      ) v(code, name, cat, descr);

      insert into public.sm_activity_types (id, property_id, activity_type_code, type_name, category, status, description)
      select gen_random_uuid()::text, pid, v.code, v.name, v.cat, 'Active', v.descr
      from (values
        ('ACT-001', 'Call', 'Communication', 'Phone call with prospect'),
        ('ACT-002', 'Email', 'Communication', 'Email follow-up'),
        ('ACT-003', 'Meeting', 'Meeting', 'In-person or video meeting'),
        ('ACT-004', 'Site Visit', 'Visit', 'Venue / property site visit'),
        ('ACT-005', 'Proposal Sent', 'Sales', 'Quotation or proposal shared')
      ) v(code, name, cat, descr);

      insert into public.sm_deal_stages (id, property_id, stage_code, stage_name, sequence, status, description)
      select gen_random_uuid()::text, pid, v.code, v.name, v.seq, 'Active', v.descr
      from (values
        ('STG-001', 'New Enquiry', 1, 'Fresh lead'), ('STG-002', 'Qualified', 2, 'Requirement confirmed'),
        ('STG-003', 'Proposal Sent', 3, 'Quotation shared'), ('STG-004', 'Negotiation', 4, 'Discussing rates and terms'),
        ('STG-005', 'Won', 5, 'Booking confirmed'), ('STG-006', 'Lost', 6, 'Did not convert')
      ) v(code, name, seq, descr);

      insert into public.sm_contact_types (id, property_id, contact_type_code, contact_type_name, status, description)
      select gen_random_uuid()::text, pid, v.code, v.name, 'Active', v.descr
      from (values
        ('CT-001', 'Individual', 'Individual guest or client'), ('CT-002', 'Corporate', 'Corporate account contact'),
        ('CT-003', 'Travel Agent', 'Travel agent or tour operator'), ('CT-004', 'Event Planner', 'Wedding and event planners')
      ) v(code, name, descr);
      rep := rep || '{"sm_masters":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('sm_masters', 'error: ' || sqlerrm);
  end;

  -- Maintenance --------------------------------------------------------------------------------
  begin
    if exists (select 1 from public.mnt_asset_categories where property_id = pid) then
      rep := rep || '{"mnt_masters":"skipped"}';
    else
      insert into public.mnt_asset_categories (id, property_id, category_code, category_name, description, asset_count, status)
      select gen_random_uuid()::text, pid, v.code, v.name, v.descr, 0, 'Active'
      from (values
        ('CAT-HVAC', 'HVAC / Air Conditioning', 'Split ACs, AHUs and chillers'), ('CAT-ELEC', 'Electrical', 'DG sets, panels and lighting'),
        ('CAT-PLMB', 'Plumbing', 'Pumps, geysers and fixtures'), ('CAT-KIT', 'Kitchen Equipment', 'Ovens, fridges and dishwashers'),
        ('CAT-LIFT', 'Elevators', 'Passenger and service lifts')
      ) v(code, name, descr);

      insert into public.mnt_problem_categories (id, property_id, category_code, category_name, description, request_count, status)
      select gen_random_uuid()::text, pid, v.code, v.name, v.descr, 0, 'Active'
      from (values
        ('PROB-AC', 'AC not cooling', 'Air conditioning issues'), ('PROB-ELEC', 'Electrical', 'Lights, sockets, power trips'),
        ('PROB-PLMB', 'Plumbing / Leakage', 'Leaks, blockages, low pressure'), ('PROB-TV', 'TV / Wi-Fi', 'Television and internet'),
        ('PROB-FURN', 'Furniture / Fixtures', 'Broken furniture, doors, locks')
      ) v(code, name, descr);

      insert into public.mnt_root_causes (id, property_id, root_cause_code, root_cause_name, description, used_in_work_orders, status)
      select gen_random_uuid()::text, pid, v.code, v.name, v.descr, 0, 'Active'
      from (values
        ('RC-WEAR', 'Wear and tear', 'Normal ageing of parts'), ('RC-MISUSE', 'Guest misuse', 'Damage due to improper use'),
        ('RC-PM', 'Missed preventive maintenance', 'PM not done on schedule'), ('RC-POWER', 'Power fluctuation', 'Voltage spikes or outages')
      ) v(code, name, descr);

      insert into public.mnt_vendors (id, property_id, vendor_code, vendor_name, service_category, contact_person, phone, email, address,
                                      service_type, service_reference, contract_start_date, contract_end_date, notes, status)
      select gen_random_uuid()::text, pid, v.code, v.name, v.cat, v.contact, v.phone, v.email, v.addr, v.stype, v.ref,
             today, today + 365, '', 'Active'
      from (values
        ('MNT-V-001', 'CoolAir Services', 'HVAC / Air Conditioning', 'Deepak Nayak', '+91 674 256 2001', 'service@coolair.example.com', 'Nayapalli, Bhubaneswar', 'AMC', 'AMC-2026-01'),
        ('MNT-V-002', 'Otis Elevator Co.', 'Elevators', 'Service Desk', '+91 1800 209 6847', 'care@otis.example.com', 'Kolkata', 'AMC', 'OT-77812'),
        ('MNT-V-003', 'PowerGen Solutions', 'Electrical', 'Sanjay Mishra', '+91 674 256 2003', 'support@powergen.example.com', 'Chandrasekharpur, Bhubaneswar', 'Warranty', 'DG-WTY-445')
      ) v(code, name, cat, contact, phone, email, addr, stype, ref);

      insert into public.mnt_spare_parts (id, property_id, part_code, part_name, category, unit, unit_cost, default_stores_ref, description, status)
      select gen_random_uuid()::text, pid, v.code, v.name, v.cat, v.unit, v.cost, 'Main Store', v.descr, 'Active'
      from (values
        ('SP-001', 'AC Capacitor 45 µF', 'Electrical', 'Pcs', 450, 'Split AC compressor capacitor'),
        ('SP-002', 'AC Filter', 'HVAC / Air Conditioning', 'Pcs', 300, 'Indoor unit air filter'),
        ('SP-003', 'LED Tube 20W', 'Electrical', 'Pcs', 250, 'Corridor lighting'),
        ('SP-004', 'Flush Valve', 'Plumbing', 'Pcs', 650, 'Concealed cistern flush valve'),
        ('SP-005', 'Door Closer', 'Furniture / Fixtures', 'Pcs', 900, 'Hydraulic door closer')
      ) v(code, name, cat, unit, cost, descr);

      insert into public.mnt_pm_templates (id, property_id, template_code, template_title, category, default_frequency, checklist,
                                           estimated_hours, safety_note, status)
      select gen_random_uuid()::text, pid, v.code, v.title, v.cat, v.freq, v.checklist, v.hours, v.safety, 'Active'
      from (values
        ('PMT-AC-M', 'Split AC monthly service', 'HVAC / Air Conditioning', 'Monthly',
          jsonb_build_array('Clean filters', 'Check gas pressure', 'Clean drain line', 'Check remote and thermostat'), 1, 'Isolate power before opening the unit'),
        ('PMT-DG-W', 'DG set weekly check', 'Electrical', 'Weekly',
          jsonb_build_array('Check fuel and oil levels', 'Check battery', 'Run on load for 15 minutes'), 1, 'Keep fire extinguisher nearby'),
        ('PMT-LIFT-M', 'Lift monthly inspection', 'Elevators', 'Monthly',
          jsonb_build_array('Check door sensors', 'Test emergency alarm', 'Inspect cabin lighting'), 2, 'Only by authorised vendor')
      ) v(code, title, cat, freq, checklist, hours, safety);

      insert into public.mnt_assets (id, property_id, asset_code, asset_name, category, location_type, location, status, payload)
      select gen_random_uuid()::text, pid, v.code, v.name, v.cat, v.ltype, v.loc, 'Operational',
             jsonb_build_object('assetCode', v.code, 'assetName', v.name, 'category', v.cat, 'locationType', v.ltype, 'location', v.loc,
                                'status', 'Operational', 'manufacturer', v.make, 'model', v.model, 'purchaseCost', v.cost,
                                'purchaseDate', to_char(today - 400, 'YYYY-MM-DD'), 'warrantyStatus', 'Active', 'amcStatus', 'Active',
                                'history', '[]'::jsonb, 'totalMaintenanceCost', 0, 'totalWorkOrdersCount', 0)
      from (values
        ('AST-001', 'DG Set 250 kVA', 'Electrical', 'Public Area', 'Plant room', 'Cummins', 'C250D5', 1850000),
        ('AST-002', 'Passenger Lift 1', 'Elevators', 'Public Area', 'Main lobby', 'Otis', 'Gen2', 2400000),
        ('AST-003', 'Kitchen Combi Oven', 'Kitchen Equipment', 'Public Area', 'Main kitchen', 'Rational', 'iCombi Pro', 950000),
        ('AST-004', 'Split AC - Room 101', 'HVAC / Air Conditioning', 'Guest Room', 'Room 101', 'Daikin', 'FTKM50', 52000)
      ) v(code, name, cat, ltype, loc, make, model, cost);
      rep := rep || '{"mnt_masters":"seeded"}';
    end if;
  exception when others then rep := rep || jsonb_build_object('mnt_masters', 'error: ' || sqlerrm);
  end;

  begin
    insert into public.mnt_rooms (id, property_id, room_id, status)
    select gen_random_uuid()::text, pid, rm.id, 'Operational'
    from public.rooms rm
    where rm.property_id = pid and not exists (select 1 from public.mnt_rooms m where m.room_id = rm.id);

    insert into public.mnt_public_areas (id, property_id, public_area_id, status)
    select gen_random_uuid()::text, pid, pa.id, 'Operational'
    from public.public_areas pa
    where pa.property_id = pid and not exists (select 1 from public.mnt_public_areas m where m.public_area_id = pa.id);
    rep := rep || '{"mnt_locations":"seeded"}';
  exception when others then rep := rep || jsonb_build_object('mnt_locations', 'error: ' || sqlerrm);
  end;

  -- Stamp tenant_id on property-scoped rows (SaaS isolation) ---------------------------------
  begin
    for rec in
      select c.table_name
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.column_name = 'tenant_id'
        and exists (
          select 1 from information_schema.columns p
          where p.table_schema = 'public'
            and p.table_name = c.table_name
            and p.column_name = 'property_id'
        )
        and c.table_name <> 'properties'
    loop
      begin
        execute format(
          'update public.%I set tenant_id = $1 where property_id = $2 and (tenant_id is null or tenant_id <> $1)',
          rec.table_name
        ) using tid, pid;
      exception when others then
        null;
      end;
    end loop;
    rep := rep || jsonb_build_object('tenant_backfill', 'done');
  exception when others then
    rep := rep || jsonb_build_object('tenant_backfill', 'error: ' || sqlerrm);
  end;

  return rep;
end;
$$;

------------------------------------------------------------------------------------------------
-- 3. New demo property for a tenant: prop-demo, prop-demo2, ... (id and code both unused)
------------------------------------------------------------------------------------------------
create or replace function public.demo_seed_new_property(
  p_tenant_id text,
  p_name text default 'Demo Hotel',
  p_city text default 'Bhubaneswar'
)
returns jsonb
language plpgsql
security definer
as $$
declare
  n int := 1;
  pid text;
  pcode text;
  tid text := nullif(trim(coalesce(p_tenant_id, '')), '');
begin
  if tid is null then
    raise exception 'p_tenant_id is required. Example: select demo_seed_new_property(''tenant-itc'');';
  end if;

  -- Serialise concurrent runs so two calls never pick the same number.
  perform pg_advisory_xact_lock(hashtext('demo_seed_new_property'));
  loop
    pid := case when n = 1 then 'prop-demo' else 'prop-demo' || n end;
    pcode := case when n = 1 then 'demo' else 'demo' || n end;
    exit when not exists (select 1 from public.properties where id = pid or lower(code) = pcode);
    n := n + 1;
  end loop;

  return jsonb_build_object(
    'property_id', pid,
    'name', case when n = 1 then p_name else p_name || ' ' || n end,
    'code', pcode,
    'tenant_id', tid
  ) || public.demo_seed_property(
    pid,
    case when n = 1 then p_name else p_name || ' ' || n end,
    pcode,
    p_city,
    tid
  );
end;
$$;

notify pgrst, 'reload schema';

------------------------------------------------------------------------------------------------
-- 4. Seed one demo property for a tenant
--    Replace 'tenant-YOUR-SLUG' with tenants.id from the platform console, then uncomment:
------------------------------------------------------------------------------------------------
-- select jsonb_pretty(public.demo_seed_new_property('tenant-YOUR-SLUG', 'Demo Hotel', 'Bhubaneswar')) as report;

-- Examples:
--   select jsonb_pretty(public.demo_seed_new_property('tenant-default'));
--   select jsonb_pretty(public.demo_seed_new_property('tenant-itc', 'ITC Demo', 'Kolkata'));
--   select jsonb_pretty(public.demo_seed_property('prop-itc-1', 'ITC One', 'itc1', 'Kolkata', 'tenant-itc'));
