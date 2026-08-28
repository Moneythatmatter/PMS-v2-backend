-- Purchase & Stores seed data (UUID primary keys)
-- Run in Supabase SQL Editor AFTER purchase-stores-schema.sql (+ RLS patch if needed).
-- Idempotent: ON CONFLICT DO NOTHING / DO UPDATE.

-- ─── Masters ───────────────────────────────────────────────────────────────

insert into ps_units (id, unit_code, unit_name, symbol, description, status, created_date) values
  ('10000000-0000-4000-8000-000000000101', 'UNT-PCS', 'Pieces', 'Pcs', 'Individual count items', 'Active', '2026-06-01'),
  ('10000000-0000-4000-8000-000000000102', 'UNT-CAN', 'Canisters', 'Can', null, 'Active', '2026-06-01'),
  ('10000000-0000-4000-8000-000000000103', 'UNT-BOX', 'Boxes', 'Box', null, 'Active', '2026-06-05'),
  ('10000000-0000-4000-8000-000000000104', 'UNT-KG', 'Kilograms', 'Kg', null, 'Active', '2026-06-05')
on conflict (id) do nothing;

insert into ps_categories (id, category_code, category_name, department, product_count, status, created_date) values
  ('20000000-0000-4000-8000-000000000101', 'CAT-LIN', 'Housekeeping Linen', 'Housekeeping', 24, 'Active', '2026-06-01'),
  ('20000000-0000-4000-8000-000000000104', 'CAT-AMN', 'Guest Amenities', 'Housekeeping', 32, 'Active', '2026-06-10'),
  ('20000000-0000-4000-8000-000000000106', 'CAT-ENG', 'Engineering Spares', 'Maintenance', 28, 'Active', '2026-06-15')
on conflict (id) do nothing;

insert into ps_suppliers (id, supplier_code, supplier_name, contact_person, phone, email, gstin, payment_terms, rating, status, created_date) values
  ('30000000-0000-4000-8000-000000000101', 'SUP-APX', 'Apex Linen Supplies Pvt Ltd', 'Rakesh Sharma', '+91 98765 43210', 'orders@apexlinen.com', '27AAACA12341Z5', 'Net 30 Days', 5, 'Active', '2026-05-10'),
  ('30000000-0000-4000-8000-000000000102', 'SUP-DVR', 'Diversey Chemicals India', 'Meera Nair', '+91 98123 45678', 'sales@diversey.co.in', null, 'Net 30 Days', 5, 'Active', '2026-05-15')
on conflict (id) do nothing;

insert into ps_products (id, product_code, product_name, category, unit, preferred_supplier, purchase_price, gst_percent, tax_type, minimum_stock, maximum_stock, par_stock, reorder_level, storage_type, status, created_date) values
  ('40000000-0000-4000-8000-000000000101', 'PRD-LIN-001', 'Bedsheet (King Size 300TC)', 'Housekeeping Linen', 'Pieces', 'Apex Linen Supplies Pvt Ltd', 350, 12, 'Exclusive', 50, 500, 200, 80, 'Dry Storage', 'Active', '2026-06-01'),
  ('40000000-0000-4000-8000-000000000102', 'PRD-LIN-002', 'Pillow Cover (Satin Finish 20x30)', 'Housekeeping Linen', 'Pieces', 'Apex Linen Supplies Pvt Ltd', 90, 12, 'Exclusive', 80, 600, 280, 100, 'Dry Storage', 'Active', '2026-06-01'),
  ('40000000-0000-4000-8000-000000000107', 'PRD-AMN-001', 'Luxury Herbal Soap (20g)', 'Guest Amenities', 'Pieces', 'Diversey Chemicals India', 12, 18, 'Exclusive', 200, 2000, 450, 300, 'Room Temp', 'Active', '2026-06-10'),
  ('40000000-0000-4000-8000-000000000109', 'PRD-ENG-001', 'HVAC Pleated Air Filter 24x24', 'Engineering Spares', 'Pieces', 'Bharat Electricals & Hardware', 420, 18, 'Exclusive', 10, 50, 24, 12, 'Dry Storage', 'Active', '2026-06-15')
on conflict (id) do nothing;

insert into ps_warehouses (id, code, name, type, location, status) values
  ('50000000-0000-4000-8000-000000000001', 'WH-MAIN-01', 'Main Central Warehouse', 'Warehouse', 'Main Building — Basement Level 1', 'Active'),
  ('50000000-0000-4000-8000-000000000002', 'WH-KIT-02', 'Main Kitchen Store', 'Store', 'Main Kitchen Production Wing', 'Active'),
  ('50000000-0000-4000-8000-000000000004', 'WH-HK-04', 'Housekeeping Store', 'Store', 'Service Floor — Linen Pantry Block', 'Active')
on conflict (id) do nothing;

insert into ps_stock_balances (id, material_id, warehouse_id, quantity, average_cost, last_movement_at, status) values
  ('60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000101', '50000000-0000-4000-8000-000000000001', 205, 350, '2026-07-24 11:30 AM', 'Active'),
  ('60000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000102', '50000000-0000-4000-8000-000000000001', 140, 90, '2026-07-24 11:30 AM', 'Active'),
  ('60000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000107', '50000000-0000-4000-8000-000000000001', 450, 12, '2026-07-23 08:30 AM', 'Active'),
  ('60000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000109', '50000000-0000-4000-8000-000000000001', 24, 420, '2026-07-20 03:00 PM', 'Active')
on conflict (id) do nothing;

-- ─── Procurement documents ─────────────────────────────────────────────────

insert into ps_purchase_requisitions (
  id, pr_number, department, requested_by, request_date, required_date, priority,
  cost_center, estimated_amount, current_approver, status, justification,
  requested_items, approval_timeline, attachments, comments
) values (
  '70000000-0000-4000-8000-000000000001',
  'PR-2026-001', 'Housekeeping', 'Amit Sharma', '18 Jul 2026', '25 Jul 2026', 'High',
  'CC-HK-LINEN', 48500, 'Purchase Manager', 'Pending Approval',
  'Linen inventory below minimum before holiday season.',
  '[{"id":"item-1","materialId":"40000000-0000-4000-8000-000000000101","productCode":"PRD-LIN-001","item":"Bedsheet (King Size 300TC)","category":"Housekeeping Linen","quantity":100,"unit":"Pieces","estimatedPrice":350,"total":35000},{"id":"item-2","materialId":"40000000-0000-4000-8000-000000000102","productCode":"PRD-LIN-002","item":"Pillow Cover (Satin Finish 20x30)","category":"Housekeeping Linen","quantity":150,"unit":"Pieces","estimatedPrice":90,"total":13500}]'::jsonb,
  '[{"stage":"Created","approverName":"Amit Sharma","status":"Completed","timestamp":"18 Jul 2026 09:30 AM"},{"stage":"Purchase Manager","approverName":"Sunil Mehta","status":"Current"}]'::jsonb,
  '[]'::jsonb, '[]'::jsonb
) on conflict (id) do nothing;

insert into ps_purchase_orders (
  id, po_number, order_date, linked_pr, linked_rfq, department, buyer_name,
  vendor_name, contact_person, gstin, vendor_address, vendor_phone,
  ship_to_warehouse, dock_gate, expected_delivery_date, freight_terms, payment_terms,
  payment_due_days, discount_percent, currency, tax_terms, sub_total, tax_amount, total_amount,
  status, items, attachments, approval_history, activity_timeline
) values
(
  '80000000-0000-4000-8000-000000000001', 'PO-2026-001', '2026-07-18', 'PR-2026-001', 'RFQ-2026-001',
  'Housekeeping', 'Amit Sharma', 'ABC Linen Pvt Ltd', 'Rajesh Mittal', '07AAACB1234F1Z8',
  'Plot 42, Okhla Industrial Area Phase 3, New Delhi', '+91 98765 43210',
  'Central Linen Warehouse', 'Receiving Dock 2', '2026-07-25', 'FOB Destination', 'Net 30 Days post GRN',
  30, 2, 'INR', '18% GST', 68000, 12240, 80240, 'Approved',
  '[{"id":"pli-1","materialId":"40000000-0000-4000-8000-000000000101","productCode":"PRD-LIN-001","productName":"Bedsheet (King Size 300TC)","itemCode":"PRD-LIN-001","itemDescription":"Bedsheet (King Size 300TC)","category":"Housekeeping Linen","quantity":200,"unit":"Pieces","unitRate":340,"taxPercent":18,"totalAmount":68000}]'::jsonb,
  '[]'::jsonb,
  '[{"level":"Level 1","approver":"Store Manager","action":"Approved","timestamp":"18 Jul 2026","comments":"PR verified"}]'::jsonb,
  '[{"stage":"Approved","timestamp":"18 Jul 2026","note":"PO approved","author":"Store Manager"}]'::jsonb
),
(
  '80000000-0000-4000-8000-000000000002', 'PO-2026-002', '2026-07-22', 'PR-2026-002', null,
  'Maintenance', 'Vikram Singh', 'Bharat Electricals & Hardware', 'Deepak Gupta', '29GGGPR56787Z4',
  'SP Road Market, Bengaluru', '+91 98450 12345',
  'Engineering Spares Store', 'Dock 1', '2026-07-28', 'Ex-Works', 'Advance',
  0, 0, 'INR', '18% GST', 2520, 454, 2974, 'Pending Approval',
  '[{"id":"pli-3","materialId":"40000000-0000-4000-8000-000000000109","productCode":"PRD-ENG-001","productName":"HVAC Pleated Air Filter 24x24","itemCode":"PRD-ENG-001","itemDescription":"HVAC Pleated Air Filter 24x24","category":"Engineering Spares","quantity":6,"unit":"Pieces","unitRate":420,"taxPercent":18,"totalAmount":2520}]'::jsonb,
  '[]'::jsonb, '[]'::jsonb,
  '[{"stage":"Pending Approval","timestamp":"22 Jul 2026","note":"Awaiting approval","author":"System"}]'::jsonb
) on conflict (id) do nothing;

insert into ps_grns (
  id, grn_number, receipt_date, po_number, supplier_name, warehouse, item_count,
  received_by, total_amount, inspection_status, status, items, attachments, logs
) values (
  '90000000-0000-4000-8000-000000000001', 'GRN-2026-001', '2026-07-20 10:30 AM', 'PO-2026-001',
  'ABC Linen Pvt Ltd', 'Main Central Warehouse', 2, 'Store Keeper Amit', 80240, 'Passed', 'Completed',
  '[{"id":"line-0","materialId":"40000000-0000-4000-8000-000000000101","productCode":"PRD-LIN-001","productName":"Bedsheet (King Size 300TC)","category":"Housekeeping Linen","orderedQty":200,"receivedQty":200,"acceptedQty":200,"rejectedQty":0,"unit":"Pieces","unitRate":340,"receivedValue":68000}]'::jsonb,
  '[]'::jsonb,
  '[{"timestamp":"2026-07-20 10:30 AM","user":"Store Keeper","action":"Received","status":"Completed"}]'::jsonb
) on conflict (id) do nothing;

insert into ps_direct_store_purchases (
  id, dsp_number, purchase_date, department, requester_name, payment_type, vendor_name,
  gstin, receipt_number, store_location, receiving_date, received_by,
  tax_amount, net_amount, total_amount, status, created_by, remarks, items, attachments, activity_timeline
) values (
  'a0000000-0000-4000-8000-000000000002', 'DSP-2026-002', '2026-07-21', 'Engineering', 'Suresh Sharma',
  'Corporate Card', 'City Electricals Store', '07BBBCE5678J1Z9', 'INV-2026-990',
  'Engineering Maintenance Store', '2026-07-21', 'Duty Engineer',
  2160, 12000, 14160, 'Pending Approval', 'Suresh Sharma',
  'Immediate replacement for garden illumination.',
  '[{"id":"di-3","itemName":"LED Floodlight 150W (IP66)","category":"Electrical","quantity":4,"unit":"Units","unitRate":2500,"lineAmount":10000}]'::jsonb,
  '[]'::jsonb,
  '[{"stage":"Pending Approval","timestamp":"21 Jul 2026","note":"Awaiting Chief Engineer Approval","author":"System"}]'::jsonb
) on conflict (id) do nothing;

-- ─── Inventory transactions ────────────────────────────────────────────────

insert into ps_stock_issues (
  id, issue_no, issue_date, department, warehouse, store, requested_by, status, purpose, line_items, total_value
) values (
  'b0000000-0000-4000-8000-000000000003', 'ISS-2026-106', '2026-07-25 09:00 AM',
  'Housekeeping', 'Housekeeping Main Store', 'Public Area Cart', 'Meena Kumari',
  'Pending Approval', 'Guest amenity restock for 2nd & 3rd floor',
  '[{"id":"li-5","itemCode":"PRD-AMN-001","itemName":"Luxury Herbal Soap (20g)","unit":"Pieces","requestedQty":200,"issuedQty":0,"availableStock":450,"unitCost":12}]'::jsonb,
  5100
) on conflict (id) do nothing;

insert into ps_stock_transfers (
  id, transfer_no, transfer_date, from_warehouse, from_store, to_warehouse, to_store,
  requested_by, status, reason, line_items, total_value
) values (
  'c0000000-0000-4000-8000-000000000004', 'TRF-2026-025', '2026-07-25 02:30 PM',
  'Engineering Spares Store', 'HVAC Rack', 'Engineering Spares Store', 'HVAC Workshop',
  'Eng. Supervisor Vikram', 'Pending Approval', 'Tower B AC filter rotation stock',
  '[{"id":"tl-7","itemCode":"PRD-ENG-001","itemName":"HVAC Pleated Air Filter 24x24","unit":"Pieces","transferQty":6,"availableAtSource":24,"unitCost":420}]'::jsonb,
  2520
) on conflict (id) do nothing;

insert into ps_stock_adjustments (
  id, adjustment_no, adjustment_date, material_id, warehouse_id,
  system_qty, actual_qty, difference, reason, requested_by, status
) values (
  'd0000000-0000-4000-8000-000000000003', 'ADJ-2026-003', '2026-07-24 04:00 PM',
  '40000000-0000-4000-8000-000000000107', '50000000-0000-4000-8000-000000000001',
  450, 442, -8, 'Physical count variance', 'Store Keeper', 'Pending Approval'
) on conflict (id) do nothing;

insert into ps_stock_ledger (
  id, transaction_date, transaction_no, movement_type, material_id, warehouse_id,
  quantity_in, quantity_out, balance_qty, remarks
) values
  ('e0000000-0000-4000-8000-000000000001', '2026-07-20 10:30 AM', 'GRN-2026-001', 'GRN', '40000000-0000-4000-8000-000000000101', '50000000-0000-4000-8000-000000000001', 200, 0, 205, 'PO-2026-001 receipt'),
  ('e0000000-0000-4000-8000-000000000002', '2026-07-24 11:30 AM', 'ISS-2026-104', 'Issue', '40000000-0000-4000-8000-000000000101', '50000000-0000-4000-8000-000000000001', 0, 45, 205, 'HK floor replenishment')
on conflict (id) do nothing;
