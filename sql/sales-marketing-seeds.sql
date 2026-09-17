-- Sales & Marketing seed data for Grand Palace Resort (prop-grand-palace)
-- Run AFTER sales-marketing-schema.sql, sales-marketing-rls-patch.sql,
-- and sales-marketing-patch-promotions-campaigns.sql

-- ========== VENUES ==========
insert into sm_venues (id, property_id, venue_code, venue_name, venue_type, minimum_capacity, maximum_capacity, location, status, description) values
  ('smv-001-gpr', 'prop-grand-palace', 'VEN-001', 'Grand Ballroom', 'Banquet Hall', 100, 500, 'Ground Floor - West Wing', 'Active', 'Pillarless luxury ballroom with crystal chandeliers.'),
  ('smv-002-gpr', 'prop-grand-palace', 'VEN-002', 'Royal Lawn & Gazebo', 'Lawn', 150, 600, 'East Courtyard', 'Active', 'Manicured lawn for destination weddings.'),
  ('smv-003-gpr', 'prop-grand-palace', 'VEN-003', 'Executive Boardroom A', 'Boardroom', 8, 30, 'Level 2 - Business Tower', 'Active', 'High-tech boardroom with video conferencing.'),
  ('smv-004-gpr', 'prop-grand-palace', 'VEN-004', 'Azure Poolside Deck', 'Pool / Poolside', 40, 150, 'Level 3 - Club Wing', 'Active', 'Poolside terrace for sundowner parties.')
on conflict (id) do nothing;

-- ========== LEAD SOURCES ==========
insert into sm_lead_sources (id, property_id, source_code, source_name, category, status, description) values
  ('sms-001-gpr', 'prop-grand-palace', 'SRC-001', 'Google Ads', 'Digital Advertising', 'Active', 'Paid search campaigns'),
  ('sms-002-gpr', 'prop-grand-palace', 'SRC-002', 'Meta Ads', 'Digital Advertising', 'Active', 'Facebook & Instagram campaigns'),
  ('sms-003-gpr', 'prop-grand-palace', 'SRC-003', 'Direct Walk-In', 'Direct', 'Active', 'Front desk walk-in inquiries'),
  ('sms-004-gpr', 'prop-grand-palace', 'SRC-004', 'Phone Inquiry', 'Direct', 'Active', 'Inbound phone inquiries'),
  ('sms-005-gpr', 'prop-grand-palace', 'SRC-005', 'Corporate B2B Reference', 'Referral / B2B', 'Active', 'Corporate referrals')
on conflict (id) do nothing;

-- ========== ACTIVITY TYPES ==========
insert into sm_activity_types (id, property_id, activity_type_code, type_name, category, status, description) values
  ('sma-001-gpr', 'prop-grand-palace', 'ACT-001', 'Call', 'Communication', 'Active', 'Phone call with prospect'),
  ('sma-002-gpr', 'prop-grand-palace', 'ACT-002', 'Site Visit', 'Visit', 'Active', 'Property / venue site visit'),
  ('sma-003-gpr', 'prop-grand-palace', 'ACT-003', 'Meeting', 'Meeting', 'Active', 'In-person or virtual meeting'),
  ('sma-004-gpr', 'prop-grand-palace', 'ACT-004', 'Follow Up', 'Communication', 'Active', 'Follow-up call or message'),
  ('sma-005-gpr', 'prop-grand-palace', 'ACT-005', 'Task', 'Task', 'Active', 'Internal sales task')
on conflict (id) do nothing;

-- ========== DEAL STAGES ==========
insert into sm_deal_stages (id, property_id, stage_code, stage_name, sequence, status, description) values
  ('smd-001-gpr', 'prop-grand-palace', 'STG-001', 'Qualification', 1, 'Active', 'Confirm inquiry is genuine'),
  ('smd-002-gpr', 'prop-grand-palace', 'STG-002', 'Requirement Analysis', 2, 'Active', 'Collect detailed requirements'),
  ('smd-003-gpr', 'prop-grand-palace', 'STG-003', 'Quotation / Proposal', 3, 'Active', 'Proposal sent'),
  ('smd-004-gpr', 'prop-grand-palace', 'STG-004', 'Negotiation', 4, 'Active', 'Rate and terms negotiation'),
  ('smd-005-gpr', 'prop-grand-palace', 'STG-005', 'Tentative Hold', 5, 'Active', 'Tentative date hold'),
  ('smd-006-gpr', 'prop-grand-palace', 'STG-006', 'Final Decision', 6, 'Active', 'Awaiting final confirmation'),
  ('smd-007-gpr', 'prop-grand-palace', 'STG-007', 'Won', 7, 'Active', 'Deal won'),
  ('smd-008-gpr', 'prop-grand-palace', 'STG-008', 'Lost', 8, 'Active', 'Deal lost')
on conflict (id) do nothing;

-- ========== CONTACT TYPES ==========
insert into sm_contact_types (id, property_id, contact_type_code, contact_type_name, status, description) values
  ('smc-001-gpr', 'prop-grand-palace', 'CT-001', 'Individual', 'Active', 'Individual guest or client'),
  ('smc-002-gpr', 'prop-grand-palace', 'CT-002', 'Corporate', 'Active', 'Corporate account contact'),
  ('smc-003-gpr', 'prop-grand-palace', 'CT-003', 'Travel Agent', 'Active', 'Travel trade partner')
on conflict (id) do nothing;

-- ========== PROMOTIONS (matches Promos & Discounts UI) ==========
insert into sm_promotions (id, property_id, promo_scheme_code, name, promo_code, description, applicable_to, discount_type, discount_value, min_spend, min_nights, start_date, end_date, status, usage_count) values
  ('smp-001-gpr', 'prop-grand-palace', 'PRM-101', 'Monsoon Room Retreat', 'MONSOON20', '20% discount on room bookings during monsoon season.', 'Rooms', 'Percentage', 20, 8000, 2, '2026-06-01', '2026-09-30', 'Active', 42),
  ('smp-002-gpr', 'prop-grand-palace', 'PRM-102', 'Grand Wedding Hall Special', 'WEDDING2026', 'Flat ₹50,000 discount on banquet hall bookings for weddings.', 'Banquet', 'Fixed Amount', 50000, 300000, null, '2026-08-01', '2026-11-30', 'Active', 14),
  ('smp-003-gpr', 'prop-grand-palace', 'PRM-103', 'Birthday Dining Treat', 'BIRTHDAY10', '10% off restaurant dining bills.', 'Restaurant', 'Percentage', 10, 2500, null, '2026-01-01', '2026-12-31', 'Active', 68),
  ('smp-004-gpr', 'prop-grand-palace', 'PRM-104', 'Summer Staycation Saver', 'SUMMER15', '15% off room staycation packages.', 'Rooms', 'Percentage', 15, 5000, 1, '2026-05-01', '2026-07-31', 'Inactive', 25),
  ('smp-005-gpr', 'prop-grand-palace', 'PRM-105', 'Corporate Executive Saver', 'CORP1500', 'Flat ₹1,500 discount for corporate room bookings.', 'Rooms', 'Fixed Amount', 1500, 10000, 2, '2026-01-01', '2026-12-31', 'Active', 52)
on conflict (id) do nothing;

-- ========== CAMPAIGNS ==========
insert into sm_campaigns (id, property_id, campaign_code, campaign_name, description, campaign_type, linked_promo_id, linked_promo_code, target_audience, goal, start_date, end_date, budget, status, external_platform, external_campaign_id, external_campaign_name, expected_leads, expected_bookings, expected_revenue) values
  ('smc-mp-001', 'prop-grand-palace', 'CMP-MON-01', 'Monsoon Weekend Escape 2026', 'Weekend staycationers with room discount on Deluxe & Executive stays.', 'Room Promotion', 'smp-001-gpr', 'MONSOON20', 'Past Guests', 'Room Bookings', '2026-06-01', '2026-09-25', 25000, 'Active', 'Google Ads', 'GADS-99102', 'Monsoon_Room_Search_IN', 80, 50, 750000),
  ('smc-mp-002', 'prop-grand-palace', 'CMP-WDG-02', 'Grand Wedding Season Early Bird', 'Free bridal suite for wedding hall bookings above 300 Pax.', 'Banquet Promotion', 'smp-002-gpr', 'WEDDING2026', 'Wedding Leads', 'Banquet Bookings', '2026-08-01', '2026-11-30', 50000, 'Active', 'Meta Ads', 'META-554433', 'Wedding_Season_2026', 120, 35, 4200000),
  ('smc-mp-003', 'prop-grand-palace', 'CMP-CRP-03', 'Corporate Annual Partner Saver', 'Corporate LRA rate drive for Q3 & Q4 executive meets.', 'Corporate Promotion', 'smp-005-gpr', 'CORP1500', 'Corporate Clients', 'Lead Generation', '2026-07-01', '2026-12-31', 35000, 'Active', 'Email Broadcast', null, null, 65, 20, 1800000)
on conflict (id) do nothing;

-- ========== CONTACTS ==========
insert into sm_contacts (id, property_id, contact_code, contact_name, contact_type, contact_category, company_name, mobile, email, city, status, created_from) values
  ('smct-001-gpr', 'prop-grand-palace', 'CONT-1001', 'Raj Sharma', 'Individual', 'Wedding Client', 'Sharma Family Enterprise', '+91 98765 43210', 'raj.sharma@gmail.com', 'Bhubaneswar', 'Active', 'Walk-In'),
  ('smct-002-gpr', 'prop-grand-palace', 'CONT-1002', 'Sunil Varma', 'Corporate', 'Corporate Client', 'TCS India Ltd', '+91 97110 44556', 'sunil.v@tcs.com', 'Mumbai', 'Active', 'Corporate Reference'),
  ('smct-003-gpr', 'prop-grand-palace', 'CONT-1003', 'Pooja Reddy', 'Individual', 'Wedding Client', 'Reddy Family', '+91 99001 22334', 'pooja.reddy@gmail.com', 'Hyderabad', 'Active', 'Walk-In')
on conflict (id) do nothing;

-- ========== LEADS ==========
insert into sm_leads (id, property_id, lead_code, lead_name, contact_person, mobile_number, email, company_name, city, booking_type, event_date, guest_count, estimated_revenue, priority, customer_requirements, lead_source, campaign_id, campaign_name, imported_via, assigned_executive, status, pipeline_stage, timeline) values
  ('sml-001-gpr', 'prop-grand-palace', 'LEAD-001', 'Reddy & Sharma Wedding Reception', 'Pooja Reddy', '+91 99001 22334', 'pooja.reddy@gmail.com', 'Reddy Family', 'Hyderabad', 'Banquet Event', '2026-11-12', 450, 2400000, 'High', 'Grand Ballroom & Royal Lawn for 450 guests with live buffet and 30 room block.', 'Walk-In', 'CMP-WDG-02', 'Grand Wedding Season Early Bird', 'Manual Entry', 'Vikram Malhotra', 'Converted', 'Quotation / Proposal', '[{"id":"T-1","date":"2026-08-15","title":"Lead Created","actor":"Vikram Malhotra"}]'::jsonb),
  ('sml-002-gpr', 'prop-grand-palace', 'LEAD-002', 'TCS Q4 Executive Leadership Meet', 'Sunil Varma', '+91 97110 44556', 'sunil.v@tcs.com', 'TCS India Ltd', 'Mumbai', 'Conference', '2026-09-15', 150, 890000, 'High', '45 rooms for 3 nights with breakfast, WiFi and airport transfer.', 'Email', 'CMP-CRP-03', 'Corporate Annual Partner Saver', 'Manual Entry', 'Jay Kumar', 'Qualified', 'Negotiation', '[{"id":"T-2","date":"2026-08-16","title":"Lead Created","actor":"Jay Kumar"}]'::jsonb),
  ('sml-003-gpr', 'prop-grand-palace', 'LEAD-003', 'Monsoon Weekend Stay Inquiry', 'Ananya Roy', '+91 98112 33445', 'ananya.roy@gmail.com', null, 'Puri', 'Room Booking', '2026-09-05', 2, 18000, 'Medium', 'Deluxe room for weekend stay with breakfast.', 'Google Ads', 'CMP-MON-01', 'Monsoon Weekend Escape 2026', 'Website', 'Jay Kumar', 'New', 'Qualification', '[{"id":"T-3","date":"2026-09-01","title":"Website Inquiry","actor":"System"}]'::jsonb)
on conflict (id) do nothing;

-- ========== DEALS ==========
insert into sm_deals (id, property_id, deal_code, deal_name, lead_id, contact_id, customer_name, company_name, mobile, email, booking_type, stage, status, deal_value, expected_close_date, assigned_executive, campaign_id, campaign_name, lead_source, customer_requirement, guest_count, expected_event_date, booking_created) values
  ('smdl-001-gpr', 'prop-grand-palace', 'DEAL-301', 'Reddy & Sharma Wedding Reception', 'sml-001-gpr', 'smct-003-gpr', 'Pooja Reddy', 'Reddy Family', '+91 99001 22334', 'pooja.reddy@gmail.com', 'Banquet / Event Booking', 'Quotation / Proposal', 'Open', 2400000, '2026-09-10', 'Vikram Malhotra', 'CMP-WDG-02', 'Grand Wedding Season Early Bird', 'Walk-In', 'Grand Ballroom & Royal Lawn for 450 guests.', 450, '2026-11-12', false),
  ('smdl-002-gpr', 'prop-grand-palace', 'DEAL-302', 'TCS Executive Leadership Meet', 'sml-002-gpr', 'smct-002-gpr', 'Sunil Varma', 'TCS India Ltd', '+91 97110 44556', 'sunil.v@tcs.com', 'Conference Booking', 'Negotiation', 'Open', 890000, '2026-08-25', 'Jay Kumar', 'CMP-CRP-03', 'Corporate Annual Partner Saver', 'Email', '45 rooms for 3 nights with corporate rates.', 150, '2026-09-15', false),
  ('smdl-003-gpr', 'prop-grand-palace', 'DEAL-801', 'Singhania Destination Wedding', null, null, 'Rakesh Singhania', 'Singhania Group', '+91 98220 11990', 'rakesh@singhaniagroup.com', 'Banquet / Event Booking', 'Won', 'Won', 4200000, '2026-08-25', 'Vikram Malhotra', 'CMP-WDG-02', 'Grand Wedding Season Early Bird', 'Referral', '3-day destination wedding package.', 600, '2026-12-10', false)
on conflict (id) do nothing;

-- ========== ACTIVITIES ==========
insert into sm_activities (id, property_id, activity_code, activity_type, priority, deal_id, lead_id, deal_name, lead_name, customer_name, company_name, contact_person, mobile_number, email, pipeline_stage, activity_date, activity_time, assigned_executive, status, venue_required, purpose, timeline) values
  ('smac-001-gpr', 'prop-grand-palace', 'ACT-1001', 'Call', 'High', 'smdl-001-gpr', 'sml-001-gpr', 'Reddy & Sharma Wedding Reception', 'Reddy & Sharma Wedding Reception', 'Pooja Reddy', 'Reddy Family', 'Pooja Reddy', '+91 99001 22334', 'pooja.reddy@gmail.com', 'Quotation / Proposal', '2026-09-17', '03:00 PM', 'Vikram Malhotra', 'Scheduled', 'Grand Ballroom', 'Discuss revised banquet menu package.', '[]'::jsonb),
  ('smac-002-gpr', 'prop-grand-palace', 'ACT-1002', 'Site Visit', 'High', 'smdl-001-gpr', 'sml-001-gpr', 'Reddy & Sharma Wedding Reception', 'Reddy & Sharma Wedding Reception', 'Pooja Reddy', 'Reddy Family', 'Pooja Reddy', '+91 99001 22334', 'pooja.reddy@gmail.com', 'Quotation / Proposal', '2026-09-17', '11:30 AM', 'Vikram Malhotra', 'Scheduled', 'Grand Ballroom', 'Hotel site visit with family.', '[]'::jsonb),
  ('smac-003-gpr', 'prop-grand-palace', 'ACT-1003', 'Call', 'Medium', 'smdl-002-gpr', 'sml-002-gpr', 'TCS Executive Leadership Meet', 'TCS Q4 Executive Leadership Meet', 'Sunil Varma', 'TCS India Ltd', 'Sunil Varma', '+91 97110 44556', 'sunil.v@tcs.com', 'Negotiation', '2026-09-18', '03:00 PM', 'Jay Kumar', 'Scheduled', null, 'Corporate LRA contract review.', '[]'::jsonb)
on conflict (id) do nothing;

-- ========== BOOKINGS ==========
insert into sm_bookings (id, property_id, booking_code, booking_type, booking_category, booking_name, contact_id, customer_name, company_name, mobile, email, deal_id, lead_id, campaign_id, created_from, start_date, end_date, start_time, end_time, venue_id, venue_or_room, guest_count, contract_value, advance_received, balance_due, payment_status, status, beo_required, beo_id, beo_status, handover_status, coordinator_name, timeline) values
  ('smbk-001-gpr', 'prop-grand-palace', 'BOOK-1001', 'Banquet / Event Booking', 'Wedding', 'Sharma Royal Wedding Reception', 'smct-001-gpr', 'Raj Sharma', 'Sharma Family Enterprise', '+91 98765 43210', 'raj.sharma@gmail.com', null, null, 'CMP-WDG-02', 'Direct Walk-In', '2026-11-15', '2026-11-15', '06:00 PM', '11:30 PM', 'smv-001-gpr', 'Grand Ballroom', 400, 850000, 300000, 550000, 'Partial Advance', 'Confirmed', true, 'BEO-801', 'Approved', 'Not Required', 'Vikram Malhotra', '[]'::jsonb),
  ('smbk-002-gpr', 'prop-grand-palace', 'BOOK-1002', 'Room Booking', 'Business Stay', 'TCS Business Delegation Stay', 'smct-002-gpr', 'Sunil Varma', 'TCS India Ltd', '+91 97110 44556', 'sunil.v@tcs.com', 'smdl-002-gpr', 'sml-002-gpr', 'CMP-CRP-03', 'Corporate Client', '2026-09-15', '2026-09-18', '02:00 PM', '12:00 PM', null, '12 Deluxe King Rooms (Wing B)', 20, 120000, 120000, 0, 'Fully Settled', 'Confirmed', false, null, null, 'Handed Over', 'Jay Kumar', '[]'::jsonb)
on conflict (id) do nothing;

-- ========== OTA CHANNELS ==========
insert into sm_ota_channels (id, property_id, channel_code, channel_name, logo_badge, status, monthly_revenue, monthly_bookings, room_nights_sold, commission_rate, adr, profitability_score, occupancy_contribution, cancellation_rate, avg_stay_nights, avg_lead_time_days, growth_rate_percent, last_sync_time, inventory_push_status, rate_push_status, restriction_push_status, room_mappings) values
  ('smota-001-gpr', 'prop-grand-palace', 'BKG', 'Booking.com', 'BKG', 'Active Sync', 1820000, 285, 420, 15.0, 4333, 'High', 34.2, 5.8, 2.5, 18, 14.5, 'Just now', 'Success', 'Success', 'Success', '[{"pmsRoomCategory":"Standard Room","otaMappedRoomName":"Standard Double","inventoryAllocated":10,"syncState":"Mapped"},{"pmsRoomCategory":"Deluxe King Room","otaMappedRoomName":"Deluxe King Room with City View","inventoryAllocated":15,"syncState":"Mapped"}]'::jsonb),
  ('smota-002-gpr', 'prop-grand-palace', 'MMT', 'MakeMyTrip', 'MMT', 'Active Sync', 1240000, 198, 310, 18.0, 4000, 'Medium', 24.5, 7.2, 2.2, 14, 8.3, '5 mins ago', 'Success', 'Success', 'Success', '[{"pmsRoomCategory":"Deluxe King Room","otaMappedRoomName":"Deluxe Room","inventoryAllocated":12,"syncState":"Mapped"}]'::jsonb),
  ('smota-003-gpr', 'prop-grand-palace', 'AGD', 'Agoda', 'AGD', 'Sync Delayed', 680000, 112, 165, 17.0, 4121, 'Medium', 14.8, 6.5, 2.1, 12, -2.1, '25 mins ago', 'Success', 'Rate Mismatch', 'Success', '[]'::jsonb)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
