import "dotenv/config";
import { supabase } from "../src/utils/supabase.js";

/** Fixed UUID seeds — masters */
const U = {
  unitPcs: "10000000-0000-4000-8000-000000000101",
  unitCan: "10000000-0000-4000-8000-000000000102",
  unitBox: "10000000-0000-4000-8000-000000000103",
  unitKg: "10000000-0000-4000-8000-000000000104",
  catLin: "20000000-0000-4000-8000-000000000101",
  catAmn: "20000000-0000-4000-8000-000000000104",
  catEng: "20000000-0000-4000-8000-000000000106",
  supApex: "30000000-0000-4000-8000-000000000101",
  supDvr: "30000000-0000-4000-8000-000000000102",
  prdSheet: "40000000-0000-4000-8000-000000000101",
  prdPillow: "40000000-0000-4000-8000-000000000102",
  prdSoap: "40000000-0000-4000-8000-000000000107",
  prdFilter: "40000000-0000-4000-8000-000000000109",
  whMain: "50000000-0000-4000-8000-000000000001",
  whKit: "50000000-0000-4000-8000-000000000002",
  whHk: "50000000-0000-4000-8000-000000000004",
};

async function upsert(table: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`  ✓ ${table}: ${rows.length} rows`);
}

async function seed() {
  console.log("Seeding Purchase & Stores...\n");

  await upsert("ps_units", [
    { id: U.unitPcs, unit_code: "UNT-PCS", unit_name: "Pieces", symbol: "Pcs", description: "Individual count items", status: "Active", created_date: "2026-06-01" },
    { id: U.unitCan, unit_code: "UNT-CAN", unit_name: "Canisters", symbol: "Can", status: "Active", created_date: "2026-06-01" },
    { id: U.unitBox, unit_code: "UNT-BOX", unit_name: "Boxes", symbol: "Box", status: "Active", created_date: "2026-06-05" },
    { id: U.unitKg, unit_code: "UNT-KG", unit_name: "Kilograms", symbol: "Kg", status: "Active", created_date: "2026-06-05" },
  ]);

  await upsert("ps_categories", [
    { id: U.catLin, category_code: "CAT-LIN", category_name: "Housekeeping Linen", department: "Housekeeping", product_count: 24, status: "Active", created_date: "2026-06-01" },
    { id: U.catAmn, category_code: "CAT-AMN", category_name: "Guest Amenities", department: "Housekeeping", product_count: 32, status: "Active", created_date: "2026-06-10" },
    { id: U.catEng, category_code: "CAT-ENG", category_name: "Engineering Spares", department: "Maintenance", product_count: 28, status: "Active", created_date: "2026-06-15" },
  ]);

  await upsert("ps_suppliers", [
    { id: U.supApex, supplier_code: "SUP-APX", supplier_name: "Apex Linen Supplies Pvt Ltd", contact_person: "Rakesh Sharma", phone: "+91 98765 43210", email: "orders@apexlinen.com", gstin: "27AAACA12341Z5", payment_terms: "Net 30 Days", rating: 5, status: "Active", created_date: "2026-05-10" },
    { id: U.supDvr, supplier_code: "SUP-DVR", supplier_name: "Diversey Chemicals India", contact_person: "Meera Nair", phone: "+91 98123 45678", email: "sales@diversey.co.in", payment_terms: "Net 30 Days", rating: 5, status: "Active", created_date: "2026-05-15" },
  ]);

  await upsert("ps_products", [
    { id: U.prdSheet, product_code: "PRD-LIN-001", product_name: "Bedsheet (King Size 300TC)", category: "Housekeeping Linen", unit: "Pieces", preferred_supplier: "Apex Linen Supplies Pvt Ltd", purchase_price: 350, gst_percent: 12, tax_type: "Exclusive", minimum_stock: 50, maximum_stock: 500, par_stock: 200, reorder_level: 80, storage_type: "Dry Storage", status: "Active", created_date: "2026-06-01" },
    { id: U.prdPillow, product_code: "PRD-LIN-002", product_name: "Pillow Cover (Satin Finish 20x30)", category: "Housekeeping Linen", unit: "Pieces", preferred_supplier: "Apex Linen Supplies Pvt Ltd", purchase_price: 90, gst_percent: 12, tax_type: "Exclusive", minimum_stock: 80, maximum_stock: 600, par_stock: 280, reorder_level: 100, storage_type: "Dry Storage", status: "Active", created_date: "2026-06-01" },
    { id: U.prdSoap, product_code: "PRD-AMN-001", product_name: "Luxury Herbal Soap (20g)", category: "Guest Amenities", unit: "Pieces", preferred_supplier: "Diversey Chemicals India", purchase_price: 12, gst_percent: 18, tax_type: "Exclusive", minimum_stock: 200, maximum_stock: 2000, par_stock: 450, reorder_level: 300, storage_type: "Room Temp", status: "Active", created_date: "2026-06-10" },
    { id: U.prdFilter, product_code: "PRD-ENG-001", product_name: "HVAC Pleated Air Filter 24x24", category: "Engineering Spares", unit: "Pieces", preferred_supplier: "Bharat Electricals & Hardware", purchase_price: 420, gst_percent: 18, tax_type: "Exclusive", minimum_stock: 10, maximum_stock: 50, par_stock: 24, reorder_level: 12, storage_type: "Dry Storage", status: "Active", created_date: "2026-06-15" },
  ]);

  await upsert("ps_warehouses", [
    { id: U.whMain, code: "WH-MAIN-01", name: "Main Central Warehouse", type: "Warehouse", location: "Main Building — Basement Level 1", status: "Active" },
    { id: U.whKit, code: "WH-KIT-02", name: "Main Kitchen Store", type: "Store", location: "Main Kitchen Production Wing", status: "Active" },
    { id: U.whHk, code: "WH-HK-04", name: "Housekeeping Store", type: "Store", location: "Service Floor — Linen Pantry Block", status: "Active" },
  ]);

  await upsert("ps_stock_balances", [
    { id: "60000000-0000-4000-8000-000000000001", material_id: U.prdSheet, warehouse_id: U.whMain, quantity: 205, average_cost: 350, last_movement_at: "2026-07-24 11:30 AM", status: "Active" },
    { id: "60000000-0000-4000-8000-000000000002", material_id: U.prdPillow, warehouse_id: U.whMain, quantity: 140, average_cost: 90, last_movement_at: "2026-07-24 11:30 AM", status: "Active" },
    { id: "60000000-0000-4000-8000-000000000003", material_id: U.prdSoap, warehouse_id: U.whMain, quantity: 450, average_cost: 12, last_movement_at: "2026-07-23 08:30 AM", status: "Active" },
    { id: "60000000-0000-4000-8000-000000000004", material_id: U.prdFilter, warehouse_id: U.whMain, quantity: 24, average_cost: 420, last_movement_at: "2026-07-20 03:00 PM", status: "Active" },
  ]);

  const prId = "70000000-0000-4000-8000-000000000001";
  await upsert("ps_purchase_requisitions", [{
    id: prId,
    pr_number: "PR-2026-001",
    department: "Housekeeping",
    requested_by: "Amit Sharma",
    request_date: "18 Jul 2026",
    required_date: "25 Jul 2026",
    priority: "High",
    cost_center: "CC-HK-LINEN",
    estimated_amount: 48500,
    current_approver: "Purchase Manager",
    status: "Pending Approval",
    justification: "Linen inventory below minimum before holiday season.",
    requested_items: [
      { id: "item-1", item: "Bedsheet", category: "Linen", quantity: 100, unit: "Pieces", estimatedPrice: 350, total: 35000 },
      { id: "item-2", item: "Pillow Cover", category: "Linen", quantity: 150, unit: "Pieces", estimatedPrice: 90, total: 13500 },
    ],
    approval_timeline: [
      { stage: "Created", approverName: "Amit Sharma", status: "Completed", timestamp: "18 Jul 2026 09:30 AM" },
      { stage: "Purchase Manager", approverName: "Sunil Mehta", status: "Current" },
    ],
    attachments: [],
    comments: [],
  }]);

  const poApprovedId = "80000000-0000-4000-8000-000000000001";
  const poPendingId = "80000000-0000-4000-8000-000000000002";
  await upsert("ps_purchase_orders", [
    {
      id: poApprovedId,
      po_number: "PO-2026-001",
      order_date: "2026-07-18",
      linked_pr: "PR-2026-001",
      linked_rfq: "RFQ-2026-001",
      department: "Housekeeping",
      buyer_name: "Amit Sharma",
      vendor_name: "ABC Linen Pvt Ltd",
      contact_person: "Rajesh Mittal",
      gstin: "07AAACB1234F1Z8",
      vendor_address: "Plot 42, Okhla Industrial Area Phase 3, New Delhi",
      vendor_phone: "+91 98765 43210",
      ship_to_warehouse: "Central Linen Warehouse",
      dock_gate: "Receiving Dock 2",
      expected_delivery_date: "2026-07-25",
      freight_terms: "FOB Destination",
      payment_terms: "Net 30 Days post GRN",
      payment_due_days: 30,
      discount_percent: 2,
      currency: "INR",
      tax_terms: "18% GST",
      sub_total: 68000,
      tax_amount: 12240,
      total_amount: 80240,
      status: "Approved",
      items: [{ id: "pli-1", itemCode: "HK-LIN-001", itemDescription: "Bedsheet (King Size 300TC)", category: "Linen", quantity: 200, unit: "Pieces", unitRate: 340, taxPercent: 18, totalAmount: 68000 }],
      attachments: [],
      approval_history: [{ level: "Level 1", approver: "Store Manager", action: "Approved", timestamp: "18 Jul 2026", comments: "PR verified" }],
      activity_timeline: [{ stage: "Approved", timestamp: "18 Jul 2026", note: "PO approved", author: "Store Manager" }],
    },
    {
      id: poPendingId,
      po_number: "PO-2026-002",
      order_date: "2026-07-22",
      linked_pr: "PR-2026-002",
      department: "Maintenance",
      buyer_name: "Vikram Singh",
      vendor_name: "Bharat Electricals & Hardware",
      contact_person: "Deepak Gupta",
      gstin: "29GGGPR56787Z4",
      vendor_address: "SP Road Market, Bengaluru",
      vendor_phone: "+91 98450 12345",
      ship_to_warehouse: "Engineering Spares Store",
      dock_gate: "Dock 1",
      expected_delivery_date: "2026-07-28",
      freight_terms: "Ex-Works",
      payment_terms: "Advance",
      payment_due_days: 0,
      discount_percent: 0,
      currency: "INR",
      tax_terms: "18% GST",
      sub_total: 2520,
      tax_amount: 454,
      total_amount: 2974,
      status: "Pending Approval",
      items: [{ id: "pli-3", itemCode: "PRD-ENG-001", itemDescription: "HVAC Pleated Air Filter 24x24", category: "Engineering Spares", quantity: 6, unit: "Pieces", unitRate: 420, taxPercent: 18, totalAmount: 2520 }],
      attachments: [],
      approval_history: [],
      activity_timeline: [{ stage: "Pending Approval", timestamp: "22 Jul 2026", note: "Awaiting approval", author: "System" }],
    },
  ]);

  await upsert("ps_grns", [{
    id: "90000000-0000-4000-8000-000000000001",
    grn_number: "GRN-2026-001",
    receipt_date: "2026-07-20 10:30 AM",
    po_number: "PO-2026-001",
    supplier_name: "ABC Linen Pvt Ltd",
    warehouse: "Main Central Warehouse",
    item_count: 2,
    received_by: "Store Keeper Amit",
    total_amount: 80240,
    inspection_status: "Passed",
    status: "Completed",
    items: [{ productCode: "PRD-LIN-001", productName: "Bedsheet (King Size 300TC)", orderedQty: 200, receivedQty: 200, acceptedQty: 200, rejectedQty: 0, unit: "Pieces" }],
    attachments: [],
    logs: [{ timestamp: "2026-07-20 10:30 AM", user: "Store Keeper", action: "Received", status: "Completed" }],
  }]);

  await upsert("ps_direct_store_purchases", [{
    id: "a0000000-0000-4000-8000-000000000002",
    dsp_number: "DSP-2026-002",
    purchase_date: "2026-07-21",
    department: "Engineering",
    requester_name: "Suresh Sharma",
    payment_type: "Corporate Card",
    vendor_name: "City Electricals Store",
    gstin: "07BBBCE5678J1Z9",
    receipt_number: "INV-2026-990",
    store_location: "Engineering Maintenance Store",
    receiving_date: "2026-07-21",
    received_by: "Duty Engineer",
    tax_amount: 2160,
    net_amount: 12000,
    total_amount: 14160,
    status: "Pending Approval",
    created_by: "Suresh Sharma",
    remarks: "Immediate replacement for garden illumination.",
    items: [{ id: "di-3", itemName: "LED Floodlight 150W (IP66)", category: "Electrical", quantity: 4, unit: "Units", unitRate: 2500, lineAmount: 10000 }],
    attachments: [],
    activity_timeline: [{ stage: "Pending Approval", timestamp: "21 Jul 2026", note: "Awaiting Chief Engineer Approval", author: "System" }],
  }]);

  await upsert("ps_stock_issues", [{
    id: "b0000000-0000-4000-8000-000000000003",
    issue_no: "ISS-2026-106",
    issue_date: "2026-07-25 09:00 AM",
    department: "Housekeeping",
    warehouse: "Housekeeping Main Store",
    store: "Public Area Cart",
    requested_by: "Meena Kumari",
    status: "Pending Approval",
    purpose: "Guest amenity restock for 2nd & 3rd floor",
    line_items: [{ id: "li-5", itemCode: "PRD-AMN-001", itemName: "Luxury Herbal Soap (20g)", unit: "Pieces", requestedQty: 200, issuedQty: 0, availableStock: 450, unitCost: 12 }],
    total_value: 5100,
  }]);

  await upsert("ps_stock_transfers", [{
    id: "c0000000-0000-4000-8000-000000000004",
    transfer_no: "TRF-2026-025",
    transfer_date: "2026-07-25 02:30 PM",
    from_warehouse: "Engineering Spares Store",
    from_store: "HVAC Rack",
    to_warehouse: "Engineering Spares Store",
    to_store: "HVAC Workshop",
    requested_by: "Eng. Supervisor Vikram",
    status: "Pending Approval",
    reason: "Tower B AC filter rotation stock",
    line_items: [{ id: "tl-7", itemCode: "PRD-ENG-001", itemName: "HVAC Pleated Air Filter 24x24", unit: "Pieces", transferQty: 6, availableAtSource: 24, unitCost: 420 }],
    total_value: 2520,
  }]);

  await upsert("ps_stock_adjustments", [{
    id: "d0000000-0000-4000-8000-000000000003",
    adjustment_no: "ADJ-2026-003",
    adjustment_date: "2026-07-24 04:00 PM",
    material_id: U.prdSoap,
    warehouse_id: U.whMain,
    system_qty: 450,
    actual_qty: 442,
    difference: -8,
    reason: "Physical count variance",
    requested_by: "Store Keeper",
    status: "Pending Approval",
  }]);

  await upsert("ps_stock_ledger", [
    { id: "e0000000-0000-4000-8000-000000000001", transaction_date: "2026-07-20 10:30 AM", transaction_no: "GRN-2026-001", movement_type: "GRN", material_id: U.prdSheet, warehouse_id: U.whMain, quantity_in: 200, quantity_out: 0, balance_qty: 205, remarks: "PO-2026-001 receipt" },
    { id: "e0000000-0000-4000-8000-000000000002", transaction_date: "2026-07-24 11:30 AM", transaction_no: "ISS-2026-104", movement_type: "Issue", material_id: U.prdSheet, warehouse_id: U.whMain, quantity_in: 0, quantity_out: 45, balance_qty: 205, remarks: "HK floor replenishment" },
  ]);

  console.log("\nPurchase & Stores seed complete.");
}

seed().catch((err) => {
  console.error("\nSeed failed:", err.message);
  if (String(err.message).includes("row-level security")) {
    console.error(
      "\nFix: Run sql/purchase-stores-rls-patch.sql in Supabase SQL Editor, then retry.\n" +
        "Or paste sql/purchase-stores-seeds.sql directly in Supabase SQL Editor (bypasses RLS).\n",
    );
  }
  process.exit(1);
});
