-- Multi-property seeds — run AFTER multi-property-schema.sql
-- Clears operational FO/HK data and seeds two isolated workspaces.

-- ========== PROPERTIES ==========
insert into public.properties (id, name, code, city, timezone, is_default, status) values
  ('prop-shaw-hotel', 'Shaw Hotel', 'bbsr', 'Bhubaneswar', 'Asia/Kolkata', true, 'Active'),
  ('prop-grand-palace', 'Grand Palace Resort', 'gpr', 'Puri', 'Asia/Kolkata', false, 'Active')
on conflict (id) do update set
  name = excluded.name,
  code = excluded.code,
  city = excluded.city,
  status = excluded.status;

-- ========== USERS ==========
update public.users set is_super_admin = true, role = 'Administrator', name = 'ritgb', initials = 'RI'
where email = 'admin@gmail.com';

insert into public.users (id, name, email, password_hash, role, initials, status, is_super_admin) values
  (
    'U-FO-SHAW',
    'FO Shaw',
    'fo.shaw@hotel.com',
    '$2b$10$YRx65m7Qb/hI/3YLOSfv2u6CLH7KmmPHfi0n9FHDXz4uHY4OLnciy',
    'Front Office',
    'FS',
    'Active',
    false
  ),
  (
    'U-HK-GPR',
    'HK Puri',
    'hk.gpr@hotel.com',
    '$2b$10$YRx65m7Qb/hI/3YLOSfv2u6CLH7KmmPHfi0n9FHDXz4uHY4OLnciy',
    'Housekeeping',
    'HP',
    'Active',
    false
  )
on conflict (id) do nothing;

insert into public.user_property_access (user_id, property_id, is_default) values
  ('U-ADMIN', 'prop-shaw-hotel', true),
  ('U-ADMIN', 'prop-grand-palace', false),
  ('U-FO-SHAW', 'prop-shaw-hotel', true),
  ('U-HK-GPR', 'prop-grand-palace', true)
on conflict do nothing;

-- Admin — full access both properties
insert into public.user_permissions (id, user_id, property_id, module_key, permission)
select gen_random_uuid()::text, 'U-ADMIN', p.id, m.key, 'admin'
from public.properties p
cross join (values
  ('dashboard'), ('front_office'), ('food_beverages'), ('housekeeping'),
  ('purchase_stores'), ('human_resources'), ('accounts'), ('sales_marketing'), ('system_settings')
) as m(key)
on conflict do nothing;

-- FO Shaw — Shaw property FO write, HK read
insert into public.user_permissions (id, user_id, property_id, module_key, permission) values
  (gen_random_uuid()::text, 'U-FO-SHAW', 'prop-shaw-hotel', 'dashboard', 'read'),
  (gen_random_uuid()::text, 'U-FO-SHAW', 'prop-shaw-hotel', 'front_office', 'write'),
  (gen_random_uuid()::text, 'U-FO-SHAW', 'prop-shaw-hotel', 'housekeeping', 'read')
on conflict do nothing;

-- HK Puri — Grand Palace HK write, FO read
insert into public.user_permissions (id, user_id, property_id, module_key, permission) values
  (gen_random_uuid()::text, 'U-HK-GPR', 'prop-grand-palace', 'dashboard', 'read'),
  (gen_random_uuid()::text, 'U-HK-GPR', 'prop-grand-palace', 'housekeeping', 'write'),
  (gen_random_uuid()::text, 'U-HK-GPR', 'prop-grand-palace', 'front_office', 'read')
on conflict do nothing;

-- ========== CLEAR OLD GLOBAL DATA (skips tables not created yet) ==========
-- Order: children before parents (maintenance_requests before rooms — SET NULL FK + location check)
do $$
declare
  t text;
begin
  foreach t in array array[
    'folio_entries', 'payments', 'transactions', 'invoices', 'room_charge_postings', 'folios',
    'room_transfers', 'wake_up_calls', 'taxi_bookings', 'luggage_items', 'messages',
    'guest_feedback', 'damage_reports', 'lost_found_items', 'maintenance_requests',
    'housekeeping_tasks', 'guest_requests', 'housekeeping_requests', 'desk_activity',
    'cashier_shifts', 'day_closings', 'guest_stay_history', 'reservations', 'guests',
    'hk_rooms', 'room_availability_blocks', 'rooms', 'public_areas', 'hk_public_areas',
    'room_types', 'tariff_plans', 'booking_sources', 'companies', 'market_segments'
  ] loop
    begin
      execute format('delete from public.%I', t);
    exception
      when undefined_table then
        null;
    end;
  end loop;
end $$;

-- ========== SHAW HOTEL SEED ==========
insert into public.room_types (id, property_id, code, name, description, base_rate, max_occupancy, status) values
  ('shaw-rt-std', 'prop-shaw-hotel', 'STD', 'Standard', 'Comfortable standard room', 2800, 2, 'Active'),
  ('shaw-rt-dlx', 'prop-shaw-hotel', 'DLX', 'Deluxe', 'Spacious deluxe room', 4200, 3, 'Active')
on conflict (id) do nothing;

insert into public.booking_sources (id, property_id, code, name, description, status) values
  ('shaw-src-walkin', 'prop-shaw-hotel', 'WALKIN', 'Walk-in', 'Front desk walk-in', 'Active'),
  ('shaw-src-web', 'prop-shaw-hotel', 'WEB', 'Website', 'Direct website', 'Active')
on conflict (id) do nothing;

insert into public.rooms (id, property_id, room_no, room_type, floor, max_occupancy, bed_type, is_active) values
  ('shaw-rm-101', 'prop-shaw-hotel', '101', 'Standard', '1st Floor', 2, 'Queen', true),
  ('shaw-rm-102', 'prop-shaw-hotel', '102', 'Standard', '1st Floor', 2, 'Queen', true),
  ('shaw-rm-103', 'prop-shaw-hotel', '103', 'Deluxe', '1st Floor', 3, 'King', true),
  ('shaw-rm-104', 'prop-shaw-hotel', '104', 'Deluxe', '1st Floor', 3, 'King', false),
  ('shaw-rm-105', 'prop-shaw-hotel', '105', 'Standard', '1st Floor', 2, 'Twin', true),
  ('shaw-rm-204', 'prop-shaw-hotel', '204', 'Deluxe', '2nd Floor', 3, 'King', true)
on conflict (id) do nothing;

insert into public.hk_rooms (id, property_id, room_id, status) values
  ('shaw-hk-101', 'prop-shaw-hotel', 'shaw-rm-101', 'INSPECTED'),
  ('shaw-hk-102', 'prop-shaw-hotel', 'shaw-rm-102', 'DIRTY'),
  ('shaw-hk-103', 'prop-shaw-hotel', 'shaw-rm-103', 'INSPECTING'),
  ('shaw-hk-104', 'prop-shaw-hotel', 'shaw-rm-104', 'OUT_OF_SERVICE'),
  ('shaw-hk-105', 'prop-shaw-hotel', 'shaw-rm-105', 'INSPECTED'),
  ('shaw-hk-204', 'prop-shaw-hotel', 'shaw-rm-204', 'INSPECTED')
on conflict (id) do nothing;

insert into public.guests (id, property_id, guest_no, name, mobile, email, nationality, total_stays, loyalty_points) values
  ('shaw-g-1', 'prop-shaw-hotel', 'G-SH-1', 'Rajesh Mohapatra', '+91 98765 11111', 'rajesh@email.com', 'Indian', 3, 600),
  ('shaw-g-2', 'prop-shaw-hotel', 'G-SH-2', 'Atul Kumar', '+91 98765 22222', 'atul@email.com', 'Indian', 1, 100)
on conflict (id) do nothing;

insert into public.reservations (id, property_id, booking_no, guest_id, room_ref_id, source_id, check_in, check_out, balance, status, adults, children, nights, room_rate, total_amount, advance_paid, payment_mode) values
  ('shaw-bk-1', 'prop-shaw-hotel', 'BK-SH-1', 'shaw-g-1', 'shaw-rm-101', 'shaw-src-walkin', '2026-08-18', '2026-08-20', 0, 'Checked In', 2, 0, 2, 2800, 5600, 5600, 'UPI'),
  ('shaw-bk-2', 'prop-shaw-hotel', 'BK-SH-2', 'shaw-g-2', 'shaw-rm-102', 'shaw-src-web', '2026-08-20', '2026-08-22', 5600, 'Confirmed', 1, 0, 2, 2800, 5600, 0, 'Pay at Hotel')
on conflict (id) do nothing;

-- ========== GRAND PALACE SEED ==========
insert into public.room_types (id, property_id, code, name, description, base_rate, max_occupancy, status) values
  ('gpr-rt-std', 'prop-grand-palace', 'STD', 'Standard', 'Coastal standard room', 3200, 2, 'Active'),
  ('gpr-rt-ste', 'prop-grand-palace', 'STE', 'Suite', 'Ocean-view suite', 9500, 4, 'Active')
on conflict (id) do nothing;

insert into public.booking_sources (id, property_id, code, name, description, status) values
  ('gpr-src-walkin', 'prop-grand-palace', 'WALKIN', 'Walk-in', 'Front desk walk-in', 'Active'),
  ('gpr-src-ota', 'prop-grand-palace', 'OTA', 'OTA', 'Online travel agencies', 'Active')
on conflict (id) do nothing;

insert into public.rooms (id, property_id, room_no, room_type, floor, max_occupancy, bed_type, is_active) values
  ('gpr-rm-201', 'prop-grand-palace', '201', 'Standard', '2nd Floor', 2, 'Queen', true),
  ('gpr-rm-202', 'prop-grand-palace', '202', 'Standard', '2nd Floor', 2, 'Queen', true),
  ('gpr-rm-501', 'prop-grand-palace', '501', 'Suite', '5th Floor', 4, 'King', true),
  ('gpr-rm-503', 'prop-grand-palace', '503', 'Suite', '5th Floor', 4, 'King', true)
on conflict (id) do nothing;

insert into public.hk_rooms (id, property_id, room_id, status) values
  ('gpr-hk-201', 'prop-grand-palace', 'gpr-rm-201', 'INSPECTED'),
  ('gpr-hk-202', 'prop-grand-palace', 'gpr-rm-202', 'DIRTY'),
  ('gpr-hk-501', 'prop-grand-palace', 'gpr-rm-501', 'INSPECTED'),
  ('gpr-hk-503', 'prop-grand-palace', 'gpr-rm-503', 'OUT_OF_SERVICE')
on conflict (id) do nothing;

insert into public.guests (id, property_id, guest_no, name, mobile, email, nationality, total_stays, loyalty_points) values
  ('gpr-g-1', 'prop-grand-palace', 'G-GP-1', 'Sneha Reddy', '+91 91234 56789', 'sneha@email.com', 'Indian', 2, 300),
  ('gpr-g-2', 'prop-grand-palace', 'G-GP-2', 'Michael Brown', '+91 88776 65544', 'm.brown@corp.com', 'American', 4, 1100)
on conflict (id) do nothing;

insert into public.reservations (id, property_id, booking_no, guest_id, room_ref_id, source_id, check_in, check_out, balance, status, adults, children, nights, room_rate, total_amount, advance_paid, payment_mode) values
  ('gpr-bk-1', 'prop-grand-palace', 'BK-GP-1', 'gpr-g-1', 'gpr-rm-501', 'gpr-src-ota', '2026-08-19', '2026-08-23', 0, 'Checked In', 2, 0, 4, 9500, 38000, 20000, 'Card'),
  ('gpr-bk-2', 'prop-grand-palace', 'BK-GP-2', 'gpr-g-2', 'gpr-rm-201', 'gpr-src-walkin', '2026-08-24', '2026-08-26', 6400, 'Confirmed', 1, 0, 2, 3200, 6400, 0, 'Pay at Hotel')
on conflict (id) do nothing;
