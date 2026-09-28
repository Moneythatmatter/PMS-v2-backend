-- =============================================================================
-- Accounts module — seed data (run after accounts-schema.sql)
-- Seeds every property in public.properties that has no accounts company yet.
-- Safe to re-run: properties that already have acc_companies rows are skipped.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Seed helpers (pg_temp: disappear automatically when the session ends)
-- ---------------------------------------------------------------------------

create or replace function pg_temp.acc_account_id(p_prop text, p_code text)
returns uuid language sql stable as $$
  select id from public.acc_accounts where property_id = p_prop and code = p_code
$$;

create or replace function pg_temp.acc_party_id(p_prop text, p_code text)
returns uuid language sql stable as $$
  select id from public.acc_parties where property_id = p_prop and party_code = p_code
$$;

create or replace function pg_temp.acc_division_id(p_prop text, p_code text)
returns uuid language sql stable as $$
  select id from public.acc_divisions where property_id = p_prop and division_code = p_code
$$;

create or replace function pg_temp.acc_seed_voucher(
  p_prop text,
  p_type text,
  p_date date,
  p_narration text,
  p_lines jsonb,
  p_ref text default '',
  p_status text default 'Posted',
  p_party text default null,
  p_bank text default null,
  p_pm text default null,
  p_instr text default '',
  p_prov_cat text default null,
  p_prov_type text default null,
  p_expiry date default null
) returns uuid
language plpgsql as $$
declare
  v_type public.acc_voucher_types%rowtype;
  v_fy public.acc_fiscal_years%rowtype;
  v_period uuid;
  v_seq int;
  v_no text;
  v_id uuid;
  v_line jsonb;
  v_i int := 0;
  v_total numeric := 0;
  v_dr numeric := 0;
  v_cr numeric := 0;
  v_account uuid;
begin
  select * into v_type from public.acc_voucher_types where property_id = p_prop and short_code = p_type;
  if v_type.id is null then raise exception 'Unknown voucher type %', p_type; end if;

  select * into v_fy from public.acc_fiscal_years
   where property_id = p_prop and p_date between start_date and end_date;
  if v_fy.id is null then raise exception 'No fiscal year for %', p_date; end if;

  select id into v_period from public.acc_fiscal_periods
   where fiscal_year_id = v_fy.id and p_date between start_date and end_date;

  select count(*) into v_seq from public.acc_vouchers
   where voucher_type_id = v_type.id and fiscal_year_id = v_fy.id;
  v_no := replace(v_type.prefix_template, '{FY}', v_fy.fy_code)
          || lpad((v_type.starting_number + v_seq)::text, v_type.number_padding, '0');

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_dr := v_dr + coalesce((v_line->>'dr')::numeric, 0);
    v_cr := v_cr + coalesce((v_line->>'cr')::numeric, 0);
  end loop;
  if v_dr <> v_cr then
    raise exception 'Voucher % (%) not balanced: Dr % Cr %', p_narration, p_date, v_dr, v_cr;
  end if;
  v_total := v_dr;

  insert into public.acc_vouchers (
    property_id, voucher_no, voucher_date, voucher_type_id, voucher_category, fiscal_year_id,
    fiscal_period_id, reference_no, narration, status, is_provisional, provisional_category,
    provisional_type, expiry_date, party_id, bank_cash_account_id, payment_method_id,
    instrument_no, total_amount, prepared_by, posted_at, posted_by
  ) values (
    p_prop, v_no, p_date, v_type.id,
    case when p_status = 'Provisional' then 'Journal' else v_type.category end,
    v_fy.id, v_period, coalesce(p_ref, ''), p_narration, p_status, p_status = 'Provisional',
    p_prov_cat, p_prov_type, p_expiry,
    case when p_party is null then null else pg_temp.acc_party_id(p_prop, p_party) end,
    case when p_bank is null then null else pg_temp.acc_account_id(p_prop, p_bank) end,
    case when p_pm is null then null else
      (select id from public.acc_payment_methods where property_id = p_prop and payment_method_code = p_pm) end,
    coalesce(p_instr, ''), v_total, 'Accounts Executive',
    case when p_status = 'Posted' then (p_date::timestamp + time '18:00') at time zone 'Asia/Kolkata' end,
    case when p_status = 'Posted' then 'Finance Manager' end
  ) returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_i := v_i + 1;
    v_account := pg_temp.acc_account_id(p_prop, v_line->>'a');
    if v_account is null then raise exception 'Unknown account code %', v_line->>'a'; end if;
    insert into public.acc_voucher_lines (
      property_id, voucher_id, line_no, account_id, party_id, division_id,
      debit, credit, narration, cheque_no, cheque_date
    ) values (
      p_prop, v_id, v_i,
      v_account,
      case when v_line ? 'p' then pg_temp.acc_party_id(p_prop, v_line->>'p') end,
      case when v_line ? 'd' then pg_temp.acc_division_id(p_prop, v_line->>'d') end,
      coalesce((v_line->>'dr')::numeric, 0),
      coalesce((v_line->>'cr')::numeric, 0),
      coalesce(v_line->>'n', ''),
      coalesce(v_line->>'chq', ''),
      case when v_line ? 'chq' then p_date end
    );
  end loop;

  return v_id;
end;
$$;

create or replace function pg_temp.acc_seed_bill(
  p_prop text, p_party text, p_module text, p_ref_type text, p_no text,
  p_date date, p_due date, p_amount numeric, p_details text,
  p_voucher uuid default null, p_div text default null
) returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.acc_party_bills (
    property_id, party_id, module_type, ref_type, bill_no, bill_date, due_date,
    amount, details, voucher_id, division_id, created_by
  ) values (
    p_prop, pg_temp.acc_party_id(p_prop, p_party), p_module, p_ref_type, p_no, p_date, p_due,
    p_amount, p_details, p_voucher,
    case when p_div is null then null else pg_temp.acc_division_id(p_prop, p_div) end,
    'Accounts Executive'
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function pg_temp.acc_seed_settle(
  p_prop text, p_bill uuid, p_voucher uuid, p_date date, p_amount numeric,
  p_trn text, p_ref text default '', p_deductions numeric default 0
) returns void
language sql as $$
  insert into public.acc_bill_settlements (
    property_id, bill_id, voucher_id, settlement_date, trn_type, amount, deductions, reference_no, created_by
  ) values (p_prop, p_bill, p_voucher, p_date, p_trn, p_amount, p_deductions, coalesce(p_ref, ''), 'Accounts Executive');
$$;

-- ---------------------------------------------------------------------------
-- Seed every property
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  p text;
  v_inr uuid;
  v_company uuid;
  v_fy_prev uuid;
  v_fy_cur uuid;
  v_fy_next uuid;
  v_type_cust uuid; v_type_vend uuid; v_type_ta uuid; v_type_corp uuid; v_type_cc uuid; v_type_emp uuid;
  v_v uuid;
  v_b uuid;
  v_b2 uuid;
  v_letter uuid;
  m int;
  v_month_end date;
  v_room numeric[] := array[1050000, 980000, 890000, 1120000, 1240000, 1080000];
  v_food numeric[] := array[185000, 172000, 160000, 198000, 214000, 190000];
  v_bev numeric[]  := array[72000, 65000, 58000, 81000, 88000, 76000];
  v_banq numeric[] := array[120000, 90000, 60000, 180000, 240000, 150000];
  v_lndry numeric[] := array[18000, 16500, 15000, 19500, 21000, 18500];
  v_gst numeric[]  := array[150000, 139000, 125000, 162000, 178000, 154000];
  v_salary numeric[] := array[420000, 420000, 425000, 440000, 450000, 450000];
  v_fcost numeric[] := array[63000, 58500, 54400, 67300, 72800, 0];
  v_bcost numeric[] := array[23000, 21000, 18500, 26000, 28000, 0];
  v_util numeric[] := array[88000, 96000, 102000, 94000, 91000, 0];
  v_ota numeric[] := array[42000, 39000, 36000, 45000, 50000, 43000];
  v_total numeric;
begin
  for r in select id, name, code, city from public.properties order by id loop
    p := r.id;
    if exists (select 1 from public.acc_companies where property_id = p) then
      raise notice 'Accounts already seeded for %, skipping', p;
      continue;
    end if;

    -- Currencies -----------------------------------------------------------
    insert into public.acc_currencies (property_id, code, name, symbol, country, decimal_places, is_base_currency, exchange_rate_to_base, rate_effective_date, rate_source, foreign_transactions_allowed, status, created_by)
    values
      (p, 'INR', 'Indian Rupee', '₹', 'India', 2, true, 1, date '2026-04-01', 'Base Currency', false, 'Active', 'System'),
      (p, 'USD', 'US Dollar', '$', 'United States', 2, false, 83.25, date '2026-09-25', 'RBI Reference Rate', true, 'Active', 'System'),
      (p, 'EUR', 'Euro', '€', 'European Union', 2, false, 90.10, date '2026-09-25', 'RBI Reference Rate', true, 'Active', 'System'),
      (p, 'GBP', 'British Pound', '£', 'United Kingdom', 2, false, 105.40, date '2026-09-25', 'RBI Reference Rate', true, 'Active', 'System'),
      (p, 'AED', 'UAE Dirham', 'د.إ', 'United Arab Emirates', 2, false, 22.66, date '2026-09-25', 'Manual', false, 'Inactive', 'System');
    select id into v_inr from public.acc_currencies where property_id = p and code = 'INR';

    -- Company ----------------------------------------------------------------
    insert into public.acc_companies (
      property_id, company_code, trade_name, legal_name, alias, company_type, business_nature, status,
      address_line1, address_line2, city, district, state, pincode, country, primary_contact, mobile,
      telephone, email, website, gst_number, pan_number, tan_number, cin_number, msme_number,
      registration_date, tax_region, gst_applicable, base_currency_id, created_by
    ) values (
      p, upper(r.code) || '-HOSP', r.name, r.name || ' Hospitality Pvt. Ltd.', upper(r.code),
      'Private Limited', 'Hospitality', 'Active',
      case when r.city = 'Puri' then 'Chakratirtha Road' else 'Plot 24, Janpath' end,
      case when r.city = 'Puri' then 'Near Sea Beach' else 'Unit 3' end,
      r.city, r.city, 'Odisha',
      case when r.city = 'Puri' then '752002' else '751001' end,
      'India', 'Finance Controller', '+91 98610 45210', '+91 674 254 1100',
      'accounts@' || lower(r.code) || '.example.com', 'www.' || lower(r.code) || '.example.com',
      case when r.city = 'Puri' then '21AAHCG4521K1Z6' else '21AAHCS7865M1Z2' end,
      case when r.city = 'Puri' then 'AAHCG4521K' else 'AAHCS7865M' end,
      case when r.city = 'Puri' then 'BBSG04521K' else 'BBSS07865M' end,
      case when r.city = 'Puri' then 'U55101OR2016PTC020145' else 'U55101OR2012PTC015632' end,
      case when r.city = 'Puri' then 'UDYAM-OD-19-0045210' else 'UDYAM-OD-19-0078650' end,
      case when r.city = 'Puri' then date '2016-06-14' else date '2012-02-20' end,
      'Odisha (21)', true, v_inr, 'System'
    ) returning id into v_company;

    -- Fiscal years & periods ---------------------------------------------------
    insert into public.acc_fiscal_years (property_id, company_id, fiscal_year_name, fy_code, start_date, end_date, status, is_current, opened_at, opened_by, closed_at, closed_by, created_by)
    values (p, v_company, 'FY 2025-26', '25-26', date '2025-04-01', date '2026-03-31', 'Closed', false,
            timestamptz '2025-04-01 09:00+05:30', 'Finance Controller', timestamptz '2026-04-30 18:00+05:30', 'Finance Controller', 'System')
    returning id into v_fy_prev;

    insert into public.acc_fiscal_years (property_id, company_id, fiscal_year_name, fy_code, start_date, end_date, status, is_current, opened_at, opened_by, created_by)
    values (p, v_company, 'FY 2026-27', '26-27', date '2026-04-01', date '2027-03-31', 'Open', true,
            timestamptz '2026-04-01 09:00+05:30', 'Finance Controller', 'System')
    returning id into v_fy_cur;

    insert into public.acc_fiscal_years (property_id, company_id, fiscal_year_name, fy_code, start_date, end_date, status, is_current, created_by)
    values (p, v_company, 'FY 2027-28', '27-28', date '2027-04-01', date '2028-03-31', 'Upcoming', false, 'System')
    returning id into v_fy_next;

    insert into public.acc_fiscal_periods (property_id, fiscal_year_id, period_no, period_code, period_name, start_date, end_date, status, closed_at, closed_by)
    select p, fy.id, gs.n, 'P-' || lpad(gs.n::text, 2, '0'),
           to_char(fy.start_date + make_interval(months => gs.n - 1), 'FMMonth YYYY'),
           (fy.start_date + make_interval(months => gs.n - 1))::date,
           (fy.start_date + make_interval(months => gs.n) - interval '1 day')::date,
           case
             when fy.id = v_fy_prev then 'Closed'
             when fy.id = v_fy_cur and gs.n <= 3 then 'Closed'
             else 'Open'
           end,
           case
             when fy.id = v_fy_prev or (fy.id = v_fy_cur and gs.n <= 3)
               then ((fy.start_date + make_interval(months => gs.n) + interval '5 days')::timestamp + time '17:30') at time zone 'Asia/Kolkata'
           end,
           case when fy.id = v_fy_prev or (fy.id = v_fy_cur and gs.n <= 3) then 'Finance Controller' end
      from public.acc_fiscal_years fy
      cross join generate_series(1, 12) as gs(n)
     where fy.id in (v_fy_prev, v_fy_cur);

    -- Chart of accounts ------------------------------------------------------
    insert into public.acc_accounts (property_id, code, name, account_type, nature, report_section, category, classification, allow_posting, is_system_account, description)
    values
      (p, '1000', 'Assets', 'Group', 'Asset', '', 'Assets', 'Balance Sheet', false, true, 'All property assets'),
      (p, '2000', 'Liabilities & Equity', 'Group', 'Liability', '', 'Liabilities', 'Balance Sheet', false, true, 'Owner funds and obligations'),
      (p, '3000', 'Income', 'Group', 'Income', '', 'Income', 'Profit & Loss', false, true, 'Operating and other income'),
      (p, '4000', 'Expenses', 'Group', 'Expense', '', 'Expenses', 'Profit & Loss', false, true, 'Operating and other expenses');

    insert into public.acc_accounts (property_id, parent_id, code, name, account_type, nature, report_section, category, classification, allow_posting, is_system_account)
    values
      (p, pg_temp.acc_account_id(p, '1000'), '1100', 'Current Assets', 'Group', 'Asset', 'Current Assets', 'Current Assets', 'Balance Sheet', false, true),
      (p, pg_temp.acc_account_id(p, '1000'), '1500', 'Fixed Assets', 'Group', 'Asset', 'Fixed Assets', 'Fixed Assets', 'Balance Sheet', false, true),
      (p, pg_temp.acc_account_id(p, '2000'), '2100', 'Capital & Reserves', 'Group', 'Liability', 'Capital & Reserves', 'Equity', 'Balance Sheet', false, true),
      (p, pg_temp.acc_account_id(p, '2000'), '2400', 'Current Liabilities', 'Group', 'Liability', 'Current Liabilities', 'Current Liabilities', 'Balance Sheet', false, true),
      (p, pg_temp.acc_account_id(p, '2000'), '2500', 'Non-Current Liabilities', 'Group', 'Liability', 'Non-Current Liabilities', 'Long Term Borrowings', 'Balance Sheet', false, true),
      (p, pg_temp.acc_account_id(p, '3000'), '3100', 'Direct Income', 'Group', 'Income', 'Direct Income', 'Operating Revenue', 'Profit & Loss', false, true),
      (p, pg_temp.acc_account_id(p, '3000'), '3200', 'Indirect Income', 'Group', 'Income', 'Indirect Income', 'Other Income', 'Profit & Loss', false, true),
      (p, pg_temp.acc_account_id(p, '4000'), '4100', 'Direct Expenses', 'Group', 'Expense', 'Direct Expenses', 'Cost of Sales', 'Profit & Loss', false, true),
      (p, pg_temp.acc_account_id(p, '4000'), '4200', 'Indirect Expenses', 'Group', 'Expense', 'Indirect Expenses', 'Operating Expenses', 'Profit & Loss', false, true);

    insert into public.acc_accounts (property_id, parent_id, code, name, account_type, nature, report_section, category, classification, allow_posting, is_system_account)
    values
      (p, pg_temp.acc_account_id(p, '1100'), '1110', 'Cash & Bank Balances', 'Group', 'Asset', 'Current Assets', 'Cash & Bank', 'Balance Sheet', false, true),
      (p, pg_temp.acc_account_id(p, '1100'), '1190', 'Trade Receivables', 'Group', 'Asset', 'Current Assets', 'Receivables', 'Balance Sheet', false, true),
      (p, pg_temp.acc_account_id(p, '1100'), '1400', 'Inventories', 'Group', 'Asset', 'Current Assets', 'Stock', 'Balance Sheet', false, true);

    insert into public.acc_accounts (property_id, parent_id, code, name, account_type, nature, report_section, category, classification, allow_posting, is_system_account, is_bank_account, is_cash_account, bank_account_no, bank_ifsc)
    values
      (p, pg_temp.acc_account_id(p, '1110'), '1111', 'Cash in Hand - Front Desk', 'Ledger', 'Asset', 'Current Assets', 'Cash & Bank', 'Balance Sheet', true, true, false, true, '', ''),
      (p, pg_temp.acc_account_id(p, '1110'), '1112', 'Petty Cash - Accounts', 'Ledger', 'Asset', 'Current Assets', 'Cash & Bank', 'Balance Sheet', true, false, false, true, '', ''),
      (p, pg_temp.acc_account_id(p, '1110'), '1121', 'HDFC Bank - Operating A/c', 'Ledger', 'Asset', 'Current Assets', 'Cash & Bank', 'Balance Sheet', true, false, true, false, '50200012345678', 'HDFC0001234'),
      (p, pg_temp.acc_account_id(p, '1110'), '1122', 'YES Bank - Card Settlement A/c', 'Ledger', 'Asset', 'Current Assets', 'Cash & Bank', 'Balance Sheet', true, false, true, false, '018763400002345', 'YESB0000187'),
      (p, pg_temp.acc_account_id(p, '1110'), '1123', 'ICICI Bank - Collection A/c', 'Ledger', 'Asset', 'Current Assets', 'Cash & Bank', 'Balance Sheet', true, false, true, false, '000405123456', 'ICIC0000004'),
      (p, pg_temp.acc_account_id(p, '1190'), '1191', 'Sundry Debtors - Corporate', 'Ledger', 'Asset', 'Current Assets', 'Receivables', 'Balance Sheet', true, true, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '1190'), '1192', 'Sundry Debtors - Travel Agents', 'Ledger', 'Asset', 'Current Assets', 'Receivables', 'Balance Sheet', true, true, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '1190'), '1193', 'Credit Card Receivables', 'Ledger', 'Asset', 'Current Assets', 'Receivables', 'Balance Sheet', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '1400'), '1401', 'Stock - Food Provisions', 'Ledger', 'Asset', 'Current Assets', 'Stock', 'Balance Sheet', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '1400'), '1402', 'Stock - Bar Beverages', 'Ledger', 'Asset', 'Current Assets', 'Stock', 'Balance Sheet', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '1400'), '1403', 'Stock - Guest Amenities & Linen', 'Ledger', 'Asset', 'Current Assets', 'Stock', 'Balance Sheet', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '1500'), '1510', 'Building & Furniture', 'Ledger', 'Asset', 'Fixed Assets', 'Fixed Assets', 'Balance Sheet', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '1500'), '1520', 'Kitchen & Laundry Equipment', 'Ledger', 'Asset', 'Fixed Assets', 'Fixed Assets', 'Balance Sheet', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '2100'), '2110', 'Share Capital', 'Ledger', 'Liability', 'Capital & Reserves', 'Equity', 'Balance Sheet', true, true, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '2100'), '2120', 'Retained Earnings & Reserves', 'Ledger', 'Liability', 'Capital & Reserves', 'Equity', 'Balance Sheet', true, true, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '2400'), '2410', 'Sundry Creditors - Vendors', 'Ledger', 'Liability', 'Current Liabilities', 'Payables', 'Balance Sheet', true, true, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '2400'), '2415', 'Sundry Creditors - F&B Suppliers', 'Ledger', 'Liability', 'Current Liabilities', 'Payables', 'Balance Sheet', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '2400'), '2430', 'GST Output Payable', 'Ledger', 'Liability', 'Current Liabilities', 'Duties & Taxes', 'Balance Sheet', true, true, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '2400'), '2440', 'TDS Payable', 'Ledger', 'Liability', 'Current Liabilities', 'Duties & Taxes', 'Balance Sheet', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '2400'), '2450', 'Guest Advance Deposits', 'Ledger', 'Liability', 'Current Liabilities', 'Advances', 'Balance Sheet', true, true, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '2400'), '2490', 'Round Off', 'Ledger', 'Liability', 'Current Liabilities', 'Round Off', 'Balance Sheet', true, true, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '2500'), '2510', 'Term Loan - HDFC Bank', 'Ledger', 'Liability', 'Non-Current Liabilities', 'Long Term Borrowings', 'Balance Sheet', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '3100'), '3110', 'Room Revenue', 'Ledger', 'Income', 'Direct Income', 'Room Revenue', 'Profit & Loss', true, true, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '3100'), '3120', 'Food Revenue', 'Ledger', 'Income', 'Direct Income', 'Food Revenue', 'Profit & Loss', true, true, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '3100'), '3130', 'Beverage Revenue', 'Ledger', 'Income', 'Direct Income', 'Beverage Revenue', 'Profit & Loss', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '3100'), '3140', 'Banquet & Events Revenue', 'Ledger', 'Income', 'Direct Income', 'Banquet Revenue', 'Profit & Loss', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '3100'), '3150', 'Laundry & Other Services', 'Ledger', 'Income', 'Direct Income', 'Other Operating Revenue', 'Profit & Loss', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '3200'), '3210', 'Interest Income', 'Ledger', 'Income', 'Indirect Income', 'Other Income', 'Profit & Loss', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '3200'), '3220', 'Commission & Misc Income', 'Ledger', 'Income', 'Indirect Income', 'Other Income', 'Profit & Loss', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '4100'), '4110', 'Cost of Food Consumed', 'Ledger', 'Expense', 'Direct Expenses', 'Cost of Sales', 'Profit & Loss', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '4100'), '4120', 'Cost of Beverages Consumed', 'Ledger', 'Expense', 'Direct Expenses', 'Cost of Sales', 'Profit & Loss', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '4100'), '4130', 'Guest Amenities Consumed', 'Ledger', 'Expense', 'Direct Expenses', 'Cost of Sales', 'Profit & Loss', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '4200'), '4210', 'Salaries & Wages', 'Ledger', 'Expense', 'Indirect Expenses', 'Payroll', 'Profit & Loss', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '4200'), '4220', 'Heat, Light & Power', 'Ledger', 'Expense', 'Indirect Expenses', 'Utilities', 'Profit & Loss', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '4200'), '4230', 'Repairs & Maintenance', 'Ledger', 'Expense', 'Indirect Expenses', 'Repairs & Maintenance', 'Profit & Loss', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '4200'), '4240', 'Sales & Marketing', 'Ledger', 'Expense', 'Indirect Expenses', 'Sales & Marketing', 'Profit & Loss', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '4200'), '4250', 'Administrative & General', 'Ledger', 'Expense', 'Indirect Expenses', 'Administrative & General', 'Profit & Loss', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '4200'), '4260', 'OTA Commission', 'Ledger', 'Expense', 'Indirect Expenses', 'Commission', 'Profit & Loss', true, false, false, false, '', ''),
      (p, pg_temp.acc_account_id(p, '4200'), '4270', 'Finance Costs', 'Ledger', 'Expense', 'Indirect Expenses', 'Finance Costs', 'Profit & Loss', true, false, false, false, '', '');

    update public.acc_fiscal_years set retained_earnings_account_id = pg_temp.acc_account_id(p, '2120')
     where property_id = p;

    insert into public.acc_company_settings (
      property_id, company_id, current_fiscal_year_id, accounting_method, decimal_places,
      allow_future_transactions, allow_back_dated_posting, back_dated_limit_days, lock_date_before,
      require_voucher_approval, auto_voucher_numbering, voucher_reset_frequency, allow_manual_voucher_no,
      prevent_duplicate_vouchers, require_posting_approval, allow_negative_cash, enforce_credit_limit,
      default_receivable_account_id, default_payable_account_id, default_round_off_account_id,
      default_guest_deposit_account_id, enable_gst, enable_einvoice, default_tax_region,
      enable_tds_deductions, last_audit_date, configured_by
    ) values (
      p, v_company, v_fy_cur, 'Accrual', 2, false, true, 30, date '2026-06-30',
      false, true, 'Yearly', false, true, false, false, true,
      pg_temp.acc_account_id(p, '1191'), pg_temp.acc_account_id(p, '2410'),
      pg_temp.acc_account_id(p, '2490'), pg_temp.acc_account_id(p, '2450'),
      true, false, 'Odisha (21)', true, timestamptz '2026-07-05 11:00+05:30', 'Finance Controller'
    );

    -- Divisions --------------------------------------------------------------
    insert into public.acc_divisions (property_id, company_id, division_code, division_name, short_name, division_type, sequence, description)
    values
      (p, v_company, 'ROOMS', 'Rooms Division', 'Rooms', 'Revenue Center', 1, 'Front office and room sales'),
      (p, v_company, 'FNB', 'Food & Beverage', 'F&B', 'Revenue Center', 2, 'Restaurants, bar and room service'),
      (p, v_company, 'BANQ', 'Banquets & Events', 'Banquets', 'Revenue Center', 3, 'Weddings, conferences and events'),
      (p, v_company, 'HK', 'Housekeeping & Laundry', 'HK', 'Revenue Center', 4, 'Guest laundry and housekeeping'),
      (p, v_company, 'ADMIN', 'Administration & General', 'A&G', 'Cost Center', 5, 'Accounts, HR and management'),
      (p, v_company, 'SALES', 'Sales & Marketing', 'S&M', 'Cost Center', 6, 'Sales team and campaigns'),
      (p, v_company, 'ENG', 'Engineering & Maintenance', 'Engg', 'Cost Center', 7, 'Plant, utilities and repairs');
    insert into public.acc_divisions (property_id, company_id, parent_division_id, division_code, division_name, short_name, division_type, sequence, description)
    values
      (p, v_company, pg_temp.acc_division_id(p, 'FNB'), 'FNB-REST', 'All Day Dining Restaurant', 'Restaurant', 'Revenue Center', 1, 'Main restaurant outlet'),
      (p, v_company, pg_temp.acc_division_id(p, 'FNB'), 'FNB-BAR', 'Lounge Bar', 'Bar', 'Revenue Center', 2, 'Bar and lounge outlet');

    -- Party types / sub types ---------------------------------------------------
    insert into public.acc_party_types (property_id, type_code, type_name, description, sequence) values
      (p, 'CUST', 'Customer', 'Individual guests and city ledger customers', 1),
      (p, 'CORP', 'Corporate', 'Corporate clients with credit facility', 2),
      (p, 'TA', 'Travel Agent', 'Online and offline travel agents', 3),
      (p, 'CC', 'Credit Card Company', 'Card acquirers and payment aggregators', 4),
      (p, 'VEND', 'Vendor', 'Suppliers and service providers', 5),
      (p, 'EMP', 'Employee', 'Staff advances and reimbursements', 6);
    select id into v_type_cust from public.acc_party_types where property_id = p and type_code = 'CUST';
    select id into v_type_corp from public.acc_party_types where property_id = p and type_code = 'CORP';
    select id into v_type_ta from public.acc_party_types where property_id = p and type_code = 'TA';
    select id into v_type_cc from public.acc_party_types where property_id = p and type_code = 'CC';
    select id into v_type_vend from public.acc_party_types where property_id = p and type_code = 'VEND';
    select id into v_type_emp from public.acc_party_types where property_id = p and type_code = 'EMP';

    insert into public.acc_party_sub_types (property_id, party_type_id, sub_type_code, sub_type_name, description, sequence) values
      (p, v_type_cust, 'WALKIN', 'Walk-in Guest', 'Direct walk-in guests', 1),
      (p, v_type_cust, 'CITYLEDGER', 'City Ledger', 'Guests billed on account', 2),
      (p, v_type_corp, 'CORPCONTRACT', 'Contracted Corporate', 'Corporates with negotiated rates', 1),
      (p, v_type_corp, 'MICE', 'MICE Client', 'Meetings, incentives, conferences and events', 2),
      (p, v_type_ta, 'OTA', 'Online Travel Agent', 'Online booking channels', 1),
      (p, v_type_ta, 'OFFLINETA', 'Offline Travel Agent', 'Tour operators and offline agents', 2),
      (p, v_type_cc, 'CCACQ', 'Card Acquirer', 'EDC and payment gateway settlements', 1),
      (p, v_type_vend, 'FNBSUP', 'F&B Supplier', 'Food and beverage suppliers', 1),
      (p, v_type_vend, 'UTIL', 'Utility Provider', 'Electricity, water and gas', 2),
      (p, v_type_vend, 'AMC', 'Service / AMC Vendor', 'Maintenance contracts', 3),
      (p, v_type_vend, 'MKTG', 'Marketing Agency', 'Advertising and digital marketing', 4),
      (p, v_type_emp, 'STAFF', 'Staff Advance', 'Salary and travel advances', 1);

    -- Payment methods ----------------------------------------------------------
    insert into public.acc_payment_methods (property_id, company_id, account_id, payment_method_code, payment_method_name, method_type, reference_required, description) values
      (p, v_company, pg_temp.acc_account_id(p, '1111'), 'CASH', 'Cash', 'Cash', false, 'Cash collected at front desk'),
      (p, v_company, pg_temp.acc_account_id(p, '1122'), 'CARD', 'Credit / Debit Card', 'Card', true, 'EDC card settlements'),
      (p, v_company, pg_temp.acc_account_id(p, '1121'), 'UPI', 'UPI', 'UPI', true, 'UPI QR collections'),
      (p, v_company, pg_temp.acc_account_id(p, '1121'), 'NEFT', 'NEFT / RTGS', 'Bank Transfer', true, 'Electronic bank transfers'),
      (p, v_company, pg_temp.acc_account_id(p, '1123'), 'CHQ', 'Cheque', 'Cheque', true, 'Cheque deposits and issues'),
      (p, v_company, null, 'CL', 'City Ledger / Credit', 'Credit', false, 'Billed to company account');

    -- Parties ------------------------------------------------------------------
    insert into public.acc_parties (
      property_id, party_code, party_name, short_name, party_type_id, party_sub_type_id, party_group,
      entity_type, email, phone, address_line1, city, state, postal_code, country,
      contact_person_name, contact_person_phone, contact_person_email, contact_person_designation,
      pan_number, gstin, gst_registration_type, msme_type, currency_id, credit_days, credit_limit,
      payment_method_id, bank_name, bank_account_number, bank_ifsc, bank_branch,
      receivable_account_id, payable_account_id, created_by
    )
    select p, x.code, x.name, x.short_name, pt.id, pst.id, x.grp, 'Company', x.email, x.phone, x.addr, x.city, x.state, x.pin, 'India',
           x.cp, x.cp_phone, x.cp_email, x.cp_desg, x.pan, x.gstin, 'Regular', x.msme, v_inr, x.days, x.limit_amt,
           (select id from public.acc_payment_methods where property_id = p and payment_method_code = x.pm),
           x.bank, x.acct, x.ifsc, x.branch,
           case when x.recv is null then null else pg_temp.acc_account_id(p, x.recv) end,
           case when x.pay is null then null else pg_temp.acc_account_id(p, x.pay) end,
           'System'
      from (values
        ('P-0001', 'Metso Outotec India Pvt Ltd', 'Metso', 'CORP', 'CORPCONTRACT', 'Corporate Debtors', 'travel.desk@metso.example.com', '+91 22 6112 4000', 'Lodha Excelus, Mahalaxmi', 'Mumbai', 'Maharashtra', '400011', 'Anita Rao', '+91 98200 11223', 'anita.rao@metso.example.com', 'Travel Manager', 'AABCM1234F', '27AABCM1234F1Z5', 'Non-MSME', 30, 500000, 'NEFT', '', '', '', '', '1191', null),
        ('P-0002', 'Infosys Limited', 'Infosys', 'CORP', 'MICE', 'Corporate Debtors', 'events@infosys.example.com', '+91 80 2852 0261', 'Electronics City, Hosur Road', 'Bengaluru', 'Karnataka', '560100', 'Rahul Menon', '+91 98450 22334', 'rahul.menon@infosys.example.com', 'Events Lead', 'AAACI4798L', '29AAACI4798L1ZX', 'Non-MSME', 30, 1000000, 'NEFT', '', '', '', '', '1191', null),
        ('P-0003', 'Reliance Retail Ltd', 'Reliance Retail', 'CORP', 'CORPCONTRACT', 'Corporate Debtors', 'accounts@relianceretail.example.com', '+91 22 3555 5000', 'Maker Chambers IV, Nariman Point', 'Mumbai', 'Maharashtra', '400021', 'Sunil Shah', '+91 98190 33445', 'sunil.shah@relianceretail.example.com', 'AP Manager', 'AABCR1718E', '27AABCR1718E1ZL', 'Non-MSME', 45, 600000, 'NEFT', '', '', '', '', '1191', null),
        ('P-0004', 'MakeMyTrip India Pvt Ltd', 'MakeMyTrip', 'TA', 'OTA', 'Travel Agents', 'hotelpayments@mmt.example.com', '+91 124 462 8747', 'DLF Building No. 5, Cyber City', 'Gurugram', 'Haryana', '122002', 'Priya Nair', '+91 98100 44556', 'priya.nair@mmt.example.com', 'Supplier Payments', 'AAECM5767R', '06AAECM5767R1ZF', 'Non-MSME', 30, 800000, 'NEFT', '', '', '', '', '1192', null),
        ('P-0005', 'Agoda Company Pte Ltd', 'Agoda', 'TA', 'OTA', 'Travel Agents', 'payments@agoda.example.com', '+65 6329 9800', '30 Cecil Street', 'Singapore', 'Singapore', '049712', 'Wei Lin', '+65 9123 4567', 'wei.lin@agoda.example.com', 'Partner Finance', 'AAGCA1234A', '', 'Non-MSME', 30, 600000, 'NEFT', '', '', '', '', '1192', null),
        ('P-0006', 'Thomas Cook India Ltd', 'Thomas Cook', 'TA', 'OFFLINETA', 'Travel Agents', 'hotels@thomascook.example.com', '+91 22 4242 7000', 'Thomas Cook Building, Fort', 'Mumbai', 'Maharashtra', '400001', 'Kiran Desai', '+91 98210 55667', 'kiran.desai@thomascook.example.com', 'Contracting Manager', 'AAACT2803M', '27AAACT2803M1ZO', 'Non-MSME', 21, 300000, 'CHQ', '', '', '', '', '1192', null),
        ('P-0007', 'Paytm Payments Services Ltd', 'Paytm EDC', 'CC', 'CCACQ', 'Credit Card Company', 'settlements@paytm.example.com', '+91 120 477 0770', 'Skymark One, Sector 98', 'Noida', 'Uttar Pradesh', '201304', 'Settlement Desk', '+91 120 477 0771', 'settlements@paytm.example.com', 'Settlement Team', 'AAHCP1234P', '09AAHCP1234P1ZR', 'Non-MSME', 2, 0, 'CARD', '', '', '', '', '1193', null),
        ('P-0008', 'Amaan Agency', 'Amaan', 'VEND', 'FNBSUP', 'Sundry Creditors', 'amaan.agency@example.com', '+91 674 253 0101', 'Unit 4, Saheed Nagar', 'Bhubaneswar', 'Odisha', '751007', 'Amaan Khan', '+91 94370 11122', 'amaan.agency@example.com', 'Proprietor', 'ABQPK1234M', '21ABQPK1234M1Z9', 'Micro', 7, 200000, 'CHQ', 'State Bank of India', '32145678901', 'SBIN0010234', 'Saheed Nagar', null, '2415'),
        ('P-0009', 'Fresh Foods Distributors', 'Fresh Foods', 'VEND', 'FNBSUP', 'Sundry Creditors', 'orders@freshfoods.example.com', '+91 674 259 7788', 'Rasulgarh Industrial Estate', 'Bhubaneswar', 'Odisha', '751010', 'Sanjay Patnaik', '+91 94371 22233', 'sanjay@freshfoods.example.com', 'Sales Head', 'AAFFF5678K', '21AAFFF5678K1Z3', 'Small', 14, 300000, 'NEFT', 'Axis Bank', '917020012345678', 'UTIB0000345', 'Rasulgarh', null, '2415'),
        ('P-0010', 'Prime Beverage Supplies', 'Prime Bev', 'VEND', 'FNBSUP', 'Sundry Creditors', 'billing@primebev.example.com', '+91 674 257 4455', 'Mancheswar Industrial Estate', 'Bhubaneswar', 'Odisha', '751017', 'Deepak Sahu', '+91 94372 33344', 'deepak@primebev.example.com', 'Accounts', 'AAKFP9012L', '21AAKFP9012L1Z7', 'Non-MSME', 7, 250000, 'NEFT', 'ICICI Bank', '004505009876', 'ICIC0000045', 'Mancheswar', null, '2415'),
        ('P-0011', 'City Energy Services Ltd', 'City Energy', 'VEND', 'UTIL', 'Sundry Creditors', 'billing@cityenergy.example.com', '1912', 'Power House Square, Unit 8', 'Bhubaneswar', 'Odisha', '751012', 'Billing Desk', '+91 674 239 1912', 'billing@cityenergy.example.com', 'Customer Care', 'AAACC4455E', '21AAACC4455E1ZQ', 'Non-MSME', 30, 500000, 'NEFT', 'HDFC Bank', '50200099887766', 'HDFC0000123', 'Unit 8', null, '2410'),
        ('P-0012', 'Voltas Ltd', 'Voltas AMC', 'VEND', 'AMC', 'Sundry Creditors', 'amc.east@voltas.example.com', '+91 33 2282 1234', 'Camac Street', 'Kolkata', 'West Bengal', '700016', 'Arindam Ghosh', '+91 98300 44455', 'arindam@voltas.example.com', 'Service Manager', 'AAACV2809D', '19AAACV2809D1ZK', 'Non-MSME', 30, 400000, 'NEFT', 'Kotak Mahindra Bank', '0412345678', 'KKBK0000321', 'Camac Street', null, '2410'),
        ('P-0013', 'BrandCraft Marketing LLP', 'BrandCraft', 'VEND', 'MKTG', 'Sundry Creditors', 'hello@brandcraft.example.com', '+91 674 256 6677', 'Patia Square', 'Bhubaneswar', 'Odisha', '751024', 'Neha Mohanty', '+91 94373 55566', 'neha@brandcraft.example.com', 'Account Director', 'AAMFB3456C', '21AAMFB3456C1Z1', 'Small', 15, 150000, 'NEFT', 'HDFC Bank', '50200055443322', 'HDFC0000456', 'Patia', null, '2410')
      ) as x(code, name, short_name, ptype, pstype, grp, email, phone, addr, city, state, pin, cp, cp_phone, cp_email, cp_desg, pan, gstin, msme, days, limit_amt, pm, bank, acct, ifsc, branch, recv, pay)
      join public.acc_party_types pt on pt.property_id = p and pt.type_code = x.ptype
      join public.acc_party_sub_types pst on pst.property_id = p and pst.sub_type_code = x.pstype;

    -- Voucher types ------------------------------------------------------------
    insert into public.acc_voucher_types (property_id, company_id, voucher_type_name, short_code, category, sequence, prefix_template, starting_number, reset_frequency, default_entry_nature, party_required, division_required, is_system) values
      (p, v_company, 'Journal Voucher', 'JV', 'Journal', 1, 'JV/{FY}/', 1, 'Yearly', 'None', false, false, true),
      (p, v_company, 'Receipt Voucher', 'RV', 'Receipt', 2, 'RV/{FY}/', 1, 'Yearly', 'Debit', false, false, true),
      (p, v_company, 'Payment Voucher', 'PV', 'Payment', 3, 'PV/{FY}/', 1, 'Yearly', 'Credit', false, false, true),
      (p, v_company, 'Contra Voucher', 'CV', 'Contra', 4, 'CV/{FY}/', 1, 'Yearly', 'None', false, false, true),
      (p, v_company, 'Sales Invoice', 'SV', 'Sales', 5, 'SV/{FY}/', 1, 'Yearly', 'Debit', true, true, false),
      (p, v_company, 'Purchase Bill', 'PUR', 'Purchase', 6, 'PUR/{FY}/', 1, 'Yearly', 'Credit', true, false, false),
      (p, v_company, 'Credit Note', 'CN', 'Credit Note', 7, 'CN/{FY}/', 1, 'Yearly', 'Credit', true, false, false),
      (p, v_company, 'Debit Note', 'DN', 'Debit Note', 8, 'DN/{FY}/', 1, 'Yearly', 'Debit', true, false, false),
      (p, v_company, 'Provisional Entry', 'PRV', 'Journal', 9, 'PRV/{FY}/', 1, 'Yearly', 'None', false, false, true),
      (p, v_company, 'Opening Balance', 'OB', 'Opening', 10, 'OB/{FY}/', 1, 'Never', 'None', false, false, true);

    -- Revenue categories / taxes -------------------------------------------------
    insert into public.acc_revenue_categories (property_id, company_id, income_account_id, revenue_category_code, revenue_category_name, description) values
      (p, v_company, pg_temp.acc_account_id(p, '3110'), 'ROOM', 'Room Revenue', 'Room tariff and extra bed charges'),
      (p, v_company, pg_temp.acc_account_id(p, '3120'), 'FOOD', 'Food Revenue', 'Restaurant and room service food'),
      (p, v_company, pg_temp.acc_account_id(p, '3130'), 'BEV', 'Beverage Revenue', 'Bar and beverage sales'),
      (p, v_company, pg_temp.acc_account_id(p, '3140'), 'BANQ', 'Banquet Revenue', 'Banquet hall, packages and events'),
      (p, v_company, pg_temp.acc_account_id(p, '3150'), 'LNDRY', 'Laundry & Services', 'Guest laundry and miscellaneous services');

    insert into public.acc_tax_definitions (property_id, company_id, output_account_id, tax_code, tax_name, tax_type, rate, calculation_type, hsn_sac_code, description) values
      (p, v_company, pg_temp.acc_account_id(p, '2430'), 'GST0', 'GST Exempt', 'GST', 0, 'Percentage', '996311', 'Room tariff up to ₹1,000'),
      (p, v_company, pg_temp.acc_account_id(p, '2430'), 'GST5', 'GST 5%', 'GST', 5, 'Percentage', '996331', 'Restaurant services'),
      (p, v_company, pg_temp.acc_account_id(p, '2430'), 'GST12', 'GST 12%', 'GST', 12, 'Percentage', '996311', 'Room tariff ₹1,001 - ₹7,500'),
      (p, v_company, pg_temp.acc_account_id(p, '2430'), 'GST18', 'GST 18%', 'GST', 18, 'Percentage', '996334', 'Room tariff above ₹7,500, banquets and services');

    insert into public.acc_tax_rules (property_id, company_id, tax_id, revenue_category_id, division_id, tax_rule_code, tax_rule_name, applicability_type, service_type, minimum_amount, maximum_amount, priority, effective_from, description)
    select p, v_company, td.id, rc.id, pg_temp.acc_division_id(p, x.div), x.code, x.name, 'Revenue Category', x.svc, x.min_amt, x.max_amt, x.prio, date '2026-04-01', x.descr
      from (values
        ('TR-ROOM-0', 'Room Tariff up to ₹1,000', 'GST0', 'ROOM', 'ROOMS', 'Accommodation', 0::numeric, 1000::numeric, 1, 'Exempt room tariff slab'),
        ('TR-ROOM-12', 'Room Tariff ₹1,001 - ₹7,500', 'GST12', 'ROOM', 'ROOMS', 'Accommodation', 1001, 7500, 2, 'Standard room tariff slab'),
        ('TR-ROOM-18', 'Room Tariff above ₹7,500', 'GST18', 'ROOM', 'ROOMS', 'Accommodation', 7501, null, 3, 'Premium room tariff slab'),
        ('TR-FNB-5', 'Restaurant Food & Beverage', 'GST5', 'FOOD', 'FNB', 'Restaurant', null, null, 1, 'Restaurant services without ITC'),
        ('TR-BANQ-18', 'Banquet & Events', 'GST18', 'BANQ', 'BANQ', 'Outdoor Catering / Events', null, null, 1, 'Banquet packages'),
        ('TR-LNDRY-18', 'Guest Laundry', 'GST18', 'LNDRY', 'HK', 'Laundry', null, null, 1, 'Laundry services')
      ) as x(code, name, tax, cat, div, svc, min_amt, max_amt, prio, descr)
      join public.acc_tax_definitions td on td.property_id = p and td.tax_code = x.tax
      join public.acc_revenue_categories rc on rc.property_id = p and rc.revenue_category_code = x.cat;

    -- Budgets ------------------------------------------------------------------
    insert into public.acc_budgets (property_id, fiscal_year_id, division_id, budget_amount)
    select p, v_fy_cur, pg_temp.acc_division_id(p, x.div), x.amt
      from (values ('ROOMS', 13500000::numeric), ('FNB', 3600000), ('BANQ', 1900000), ('HK', 240000)) as x(div, amt);

    -- Opening balances (carried forward from FY 2025-26) ---------------------
    v_v := pg_temp.acc_seed_voucher(p, 'OB', date '2026-03-31', 'Opening balances carried forward from FY 2025-26', jsonb_build_array(
      jsonb_build_object('a','1111','dr',50000,'n','Cash in hand'),
      jsonb_build_object('a','1121','dr',850000,'n','HDFC operating balance'),
      jsonb_build_object('a','1122','dr',425000,'n','YES Bank balance'),
      jsonb_build_object('a','1123','dr',350000,'n','ICICI collection balance'),
      jsonb_build_object('a','1510','dr',5000000,'n','Building & furniture WDV'),
      jsonb_build_object('a','1520','dr',1200000,'n','Equipment WDV'),
      jsonb_build_object('a','1401','dr',42000,'n','Food stock'),
      jsonb_build_object('a','1402','dr',114000,'n','Bar stock'),
      jsonb_build_object('a','1403','dr',35000,'n','Amenities stock'),
      jsonb_build_object('a','1191','dr',340000,'p','P-0003','n','Reliance Retail - INV-2025-9912'),
      jsonb_build_object('a','2110','cr',5000000,'n','Share capital'),
      jsonb_build_object('a','2510','cr',1500000,'n','Term loan outstanding'),
      jsonb_build_object('a','2410','cr',150000,'p','P-0012','n','Voltas AMC - BILL-2026-0010'),
      jsonb_build_object('a','2120','cr',1756000,'n','Retained earnings')
    ), 'OB-FY25-26');
    perform pg_temp.acc_seed_bill(p, 'P-0003', 'AR', 'Invoice', 'INV-2025-9912', date '2025-12-15', date '2026-01-29', 340000, 'Corporate stays - Dec 2025', v_v, 'ROOMS');
    v_b2 := pg_temp.acc_seed_bill(p, 'P-0012', 'AP', 'Bill', 'BILL-2026-0010', date '2026-03-20', date '2026-04-19', 150000, 'Annual HVAC maintenance contract', v_v, 'ENG');

    -- Monthly operations Apr - Sep 2026 -------------------------------------------
    for m in 1..6 loop
      v_month_end := case when m = 6 then date '2026-09-25'
                          else (date '2026-04-01' + make_interval(months => m) - interval '1 day')::date end;
      v_total := v_room[m] + v_food[m] + v_bev[m] + v_banq[m] + v_lndry[m] + v_gst[m];

      perform pg_temp.acc_seed_voucher(p, 'RV', v_month_end,
        'Revenue summary - ' || to_char(v_month_end, 'FMMonth YYYY'), jsonb_build_array(
          jsonb_build_object('a','1121','dr', v_total - 230000, 'n','Settlements to HDFC'),
          jsonb_build_object('a','1122','dr', 200000, 'n','Card EDC settlements'),
          jsonb_build_object('a','1111','dr', 30000, 'n','Cash collections'),
          jsonb_build_object('a','3110','cr', v_room[m], 'd','ROOMS','n','Room revenue'),
          jsonb_build_object('a','3120','cr', v_food[m], 'd','FNB-REST','n','Food revenue'),
          jsonb_build_object('a','3130','cr', v_bev[m], 'd','FNB-BAR','n','Beverage revenue'),
          jsonb_build_object('a','3140','cr', v_banq[m], 'd','BANQ','n','Banquet revenue'),
          jsonb_build_object('a','3150','cr', v_lndry[m], 'd','HK','n','Laundry revenue'),
          jsonb_build_object('a','2430','cr', v_gst[m], 'n','GST collected')
        ), 'NA-' || to_char(v_month_end, 'YYYYMM'), 'Posted', null, '1121', 'NEFT');

      perform pg_temp.acc_seed_voucher(p, 'PV', v_month_end,
        'Salaries & wages - ' || to_char(v_month_end, 'FMMonth YYYY'), jsonb_build_array(
          jsonb_build_object('a','4210','dr', v_salary[m], 'd','ADMIN','n','Monthly payroll'),
          jsonb_build_object('a','1121','cr', v_salary[m], 'n','Payroll transfer')
        ), 'SAL-' || to_char(v_month_end, 'YYYYMM'), 'Posted', null, '1121', 'NEFT', 'NEFT-SAL-' || to_char(v_month_end, 'YYYYMM'));

      perform pg_temp.acc_seed_voucher(p, 'PV', v_month_end,
        'OTA commission settlement - ' || to_char(v_month_end, 'FMMonth YYYY'), jsonb_build_array(
          jsonb_build_object('a','4260','dr', v_ota[m], 'd','SALES','n','OTA commissions'),
          jsonb_build_object('a','1121','cr', v_ota[m], 'n','Commission payout')
        ), 'OTA-' || to_char(v_month_end, 'YYYYMM'), 'Posted', null, '1121', 'NEFT', 'NEFT-OTA-' || to_char(v_month_end, 'YYYYMM'));

      perform pg_temp.acc_seed_voucher(p, 'PV', (v_month_end - 10),
        'Administrative & general expenses', jsonb_build_array(
          jsonb_build_object('a','4250','dr', 30000, 'd','ADMIN','n','Printing, stationery, communication'),
          jsonb_build_object('a','4130','dr', 12000, 'd','HK','n','Guest amenities issued'),
          jsonb_build_object('a','1121','cr', 42000, 'n','Vendor payments')
        ), 'AG-' || to_char(v_month_end, 'YYYYMM'), 'Posted', null, '1121', 'NEFT', 'NEFT-AG-' || to_char(v_month_end, 'YYYYMM'));

      perform pg_temp.acc_seed_voucher(p, 'PV', (date '2026-04-05' + make_interval(months => m - 1))::date,
        'Term loan EMI - HDFC Bank', jsonb_build_array(
          jsonb_build_object('a','2510','dr', 25000, 'n','Principal'),
          jsonb_build_object('a','4270','dr', 12500, 'd','ADMIN','n','Interest'),
          jsonb_build_object('a','1121','cr', 37500, 'n','EMI auto-debit')
        ), 'EMI-' || to_char(v_month_end, 'YYYYMM'), 'Posted', null, '1121', 'NEFT', 'ECS-EMI-' || to_char(v_month_end, 'YYYYMM'));

      if v_fcost[m] > 0 then
        perform pg_temp.acc_seed_voucher(p, 'PV', v_month_end - 3,
          'F&B purchases (cash & carry) - ' || to_char(v_month_end, 'FMMonth YYYY'), jsonb_build_array(
            jsonb_build_object('a','4110','dr', v_fcost[m], 'd','FNB-REST','n','Food purchases'),
            jsonb_build_object('a','4120','dr', v_bcost[m], 'd','FNB-BAR','n','Beverage purchases'),
            jsonb_build_object('a','1121','cr', v_fcost[m] + v_bcost[m], 'n','Supplier payments')
          ), 'FNB-' || to_char(v_month_end, 'YYYYMM'), 'Posted', null, '1121', 'NEFT', 'NEFT-FNB-' || to_char(v_month_end, 'YYYYMM'));
      end if;

      if v_util[m] > 0 then
        perform pg_temp.acc_seed_voucher(p, 'PV', v_month_end - 5,
          'Electricity & water charges - ' || to_char(v_month_end, 'FMMonth YYYY'), jsonb_build_array(
            jsonb_build_object('a','4220','dr', v_util[m], 'd','ENG','n','Utility bill'),
            jsonb_build_object('a','1121','cr', v_util[m], 'n','Utility payment')
          ), 'UTIL-' || to_char(v_month_end, 'YYYYMM'), 'Posted', null, '1121', 'NEFT', 'NEFT-UTIL-' || to_char(v_month_end, 'YYYYMM'));
      end if;

      if m >= 2 then
        perform pg_temp.acc_seed_voucher(p, 'PV', (date '2026-04-20' + make_interval(months => m - 1))::date,
          'GST remittance for ' || to_char(date '2026-04-01' + make_interval(months => m - 2), 'FMMonth YYYY'), jsonb_build_array(
            jsonb_build_object('a','2430','dr', v_gst[m - 1], 'n','GSTR-3B payment'),
            jsonb_build_object('a','1121','cr', v_gst[m - 1], 'n','GST challan')
          ), 'GST-' || to_char(date '2026-04-01' + make_interval(months => m - 2), 'YYYYMM'), 'Posted', null, '1121', 'NEFT', 'CIN-' || to_char(date '2026-04-01' + make_interval(months => m - 2), 'YYYYMM'));
      end if;
    end loop;

    perform pg_temp.acc_seed_voucher(p, 'PV', date '2026-04-22', 'Kitchen exhaust repair', jsonb_build_array(
      jsonb_build_object('a','4230','dr',22000,'d','ENG','n','Exhaust motor rewinding'),
      jsonb_build_object('a','1111','cr',22000,'n','Paid in cash')
    ), 'RM-0422', 'Posted', null, '1111', 'CASH');
    perform pg_temp.acc_seed_voucher(p, 'PV', date '2026-06-14', 'Plumbing and bathroom fixture repairs', jsonb_build_array(
      jsonb_build_object('a','4230','dr',35000,'d','ENG','n','Plumbing work - 3rd floor'),
      jsonb_build_object('a','1111','cr',35000,'n','Paid in cash')
    ), 'RM-0614', 'Posted', null, '1111', 'CASH');
    perform pg_temp.acc_seed_voucher(p, 'PV', date '2026-08-10', 'Lift maintenance - emergency call-out', jsonb_build_array(
      jsonb_build_object('a','4230','dr',28000,'d','ENG','n','Lift door sensor replacement'),
      jsonb_build_object('a','1111','cr',28000,'n','Paid in cash')
    ), 'RM-0810', 'Posted', null, '1111', 'CASH');
    perform pg_temp.acc_seed_voucher(p, 'CV', date '2026-07-31', 'Cash deposited into HDFC Bank', jsonb_build_array(
      jsonb_build_object('a','1121','dr',60000,'n','Cash deposit slip 00871'),
      jsonb_build_object('a','1111','cr',60000,'n','Front desk cash')
    ), 'DEP-00871', 'Posted', null, '1121', 'CASH', 'DEP-00871');

    -- Marketing agency bills + payments
    v_v := pg_temp.acc_seed_voucher(p, 'PUR', date '2026-05-12', 'Summer campaign - digital marketing', jsonb_build_array(
      jsonb_build_object('a','4240','dr',45000,'d','SALES','n','Summer campaign'),
      jsonb_build_object('a','2410','cr',45000,'p','P-0013','n','BrandCraft invoice BC-2026-118')
    ), 'BC-2026-118', 'Posted', 'P-0013');
    v_b := pg_temp.acc_seed_bill(p, 'P-0013', 'AP', 'Bill', 'BC-2026-118', date '2026-05-12', date '2026-05-27', 45000, 'Summer digital campaign', v_v, 'SALES');
    v_v := pg_temp.acc_seed_voucher(p, 'PV', date '2026-05-26', 'Payment to BrandCraft Marketing LLP', jsonb_build_array(
      jsonb_build_object('a','2410','dr',45000,'p','P-0013','n','Against BC-2026-118'),
      jsonb_build_object('a','1122','cr',45000,'n','NEFT from YES Bank')
    ), 'BC-2026-118', 'Posted', 'P-0013', '1122', 'NEFT', 'NEFT-YES-55120');
    perform pg_temp.acc_seed_settle(p, v_b, v_v, date '2026-05-26', 45000, 'Payments', 'NEFT-YES-55120');

    v_v := pg_temp.acc_seed_voucher(p, 'PUR', date '2026-09-08', 'Durga Puja festive campaign', jsonb_build_array(
      jsonb_build_object('a','4240','dr',35000,'d','SALES','n','Festive campaign creatives'),
      jsonb_build_object('a','2410','cr',35000,'p','P-0013','n','BrandCraft invoice BC-2026-204')
    ), 'BC-2026-204', 'Posted', 'P-0013');
    perform pg_temp.acc_seed_bill(p, 'P-0013', 'AP', 'Bill', 'BC-2026-204', date '2026-09-08', date '2026-09-23', 35000, 'Festive season campaign', v_v, 'SALES');

    -- Voltas opening bill partly paid
    v_v := pg_temp.acc_seed_voucher(p, 'PV', date '2026-04-25', 'Part payment to Voltas Ltd - AMC', jsonb_build_array(
      jsonb_build_object('a','2410','dr',100000,'p','P-0012','n','Against BILL-2026-0010'),
      jsonb_build_object('a','1121','cr',100000,'n','NEFT')
    ), 'BILL-2026-0010', 'Posted', 'P-0012', '1121', 'NEFT', 'NEFT-44871');
    perform pg_temp.acc_seed_settle(p, v_b2, v_v, date '2026-04-25', 100000, 'Payments', 'NEFT-44871');

    -- Corporate / travel agent sales and receipts
    v_v := pg_temp.acc_seed_voucher(p, 'SV', date '2026-05-10', 'Agoda group allotment - May', jsonb_build_array(
      jsonb_build_object('a','1192','dr',220000,'p','P-0005','n','INV-2026-0410'),
      jsonb_build_object('a','3110','cr',196000,'d','ROOMS','n','Room revenue'),
      jsonb_build_object('a','2430','cr',24000,'n','GST 12%')
    ), 'INV-2026-0410', 'Posted', 'P-0005');
    v_b := pg_temp.acc_seed_bill(p, 'P-0005', 'AR', 'Invoice', 'INV-2026-0410', date '2026-05-10', date '2026-06-09', 220000, 'OTA group allotment - 28 room nights', v_v, 'ROOMS');

    v_v := pg_temp.acc_seed_voucher(p, 'SV', date '2026-07-10', 'Metso annual meet - rooms & banquet', jsonb_build_array(
      jsonb_build_object('a','1191','dr',150000,'p','P-0001','n','INV-2026-0812'),
      jsonb_build_object('a','3110','cr',110000,'d','ROOMS','n','Room revenue'),
      jsonb_build_object('a','3140','cr',24000,'d','BANQ','n','Conference hall'),
      jsonb_build_object('a','2430','cr',16000,'n','GST')
    ), 'INV-2026-0812', 'Posted', 'P-0001');
    v_b := pg_temp.acc_seed_bill(p, 'P-0001', 'AR', 'Invoice', 'INV-2026-0812', date '2026-07-10', date '2026-08-09', 150000, 'Annual meet - 18 room nights + conference hall', v_v, 'ROOMS');
    v_v := pg_temp.acc_seed_voucher(p, 'RV', date '2026-07-20', 'Part receipt from Metso Outotec', jsonb_build_array(
      jsonb_build_object('a','1121','dr',50000,'n','NEFT received'),
      jsonb_build_object('a','1191','cr',50000,'p','P-0001','n','Against INV-2026-0812')
    ), 'INV-2026-0812', 'Posted', 'P-0001', '1121', 'NEFT', 'NEFT-MET-7781');
    perform pg_temp.acc_seed_settle(p, v_b, v_v, date '2026-07-20', 50000, 'Receipts', 'NEFT-MET-7781');

    v_v := pg_temp.acc_seed_voucher(p, 'SV', date '2026-07-24', 'MakeMyTrip bookings - July', jsonb_build_array(
      jsonb_build_object('a','1192','dr',145000,'p','P-0004','n','INV-2026-0902'),
      jsonb_build_object('a','3110','cr',130000,'d','ROOMS','n','Room revenue'),
      jsonb_build_object('a','2430','cr',15000,'n','GST 12%')
    ), 'INV-2026-0902', 'Posted', 'P-0004');
    perform pg_temp.acc_seed_bill(p, 'P-0004', 'AR', 'Invoice', 'INV-2026-0902', date '2026-07-24', date '2026-08-23', 145000, 'Prepaid OTA bookings - 22 room nights', v_v, 'ROOMS');

    v_v := pg_temp.acc_seed_voucher(p, 'SV', date '2026-08-18', 'Infosys leadership offsite', jsonb_build_array(
      jsonb_build_object('a','1191','dr',280000,'p','P-0002','n','INV-2026-1020'),
      jsonb_build_object('a','3110','cr',200000,'d','ROOMS','n','Room revenue'),
      jsonb_build_object('a','3140','cr',50000,'d','BANQ','n','Banquet package'),
      jsonb_build_object('a','2430','cr',30000,'n','GST')
    ), 'INV-2026-1020', 'Posted', 'P-0002');
    v_b := pg_temp.acc_seed_bill(p, 'P-0002', 'AR', 'Invoice', 'INV-2026-1020', date '2026-08-18', date '2026-09-17', 280000, 'Leadership offsite - rooms and banquet', v_v, 'BANQ');
    v_v := pg_temp.acc_seed_voucher(p, 'RV', date '2026-08-25', 'Receipt from Infosys Limited', jsonb_build_array(
      jsonb_build_object('a','1121','dr',280000,'n','RTGS received'),
      jsonb_build_object('a','1191','cr',280000,'p','P-0002','n','Against INV-2026-1020')
    ), 'INV-2026-1020', 'Posted', 'P-0002', '1121', 'NEFT', 'RTGS-INF-2291');
    perform pg_temp.acc_seed_settle(p, v_b, v_v, date '2026-08-25', 280000, 'Receipts', 'RTGS-INF-2291');

    v_v := pg_temp.acc_seed_voucher(p, 'SV', date '2026-09-05', 'Thomas Cook tour group', jsonb_build_array(
      jsonb_build_object('a','1192','dr',96000,'p','P-0006','n','INV-2026-1105'),
      jsonb_build_object('a','3110','cr',72000,'d','ROOMS','n','Room revenue'),
      jsonb_build_object('a','3120','cr',14000,'d','FNB-REST','n','Meal plan'),
      jsonb_build_object('a','2430','cr',10000,'n','GST')
    ), 'INV-2026-1105', 'Posted', 'P-0006');
    perform pg_temp.acc_seed_bill(p, 'P-0006', 'AR', 'Invoice', 'INV-2026-1105', date '2026-09-05', date '2026-09-26', 96000, 'Tour group - 12 room nights with MAP', v_v, 'ROOMS');

    v_v := pg_temp.acc_seed_voucher(p, 'JV', date '2026-09-15', 'Card settlements pending from Paytm EDC', jsonb_build_array(
      jsonb_build_object('a','1193','dr',13597,'p','P-0007','n','EDC batch 0915'),
      jsonb_build_object('a','3110','cr',13597,'d','ROOMS','n','Room revenue - card')
    ), 'EDC-0915', 'Posted', 'P-0007');
    perform pg_temp.acc_seed_bill(p, 'P-0007', 'AR', 'Invoice', 'CC-2026-0915', date '2026-09-15', date '2026-09-17', 13597, 'EDC batch settlement', v_v, 'ROOMS');

    perform pg_temp.acc_seed_voucher(p, 'RV', date '2026-09-26', 'Restaurant walk-in cash sales', jsonb_build_array(
      jsonb_build_object('a','1111','dr',18500,'n','Cash sales'),
      jsonb_build_object('a','3120','cr',16500,'d','FNB-REST','n','Food'),
      jsonb_build_object('a','3130','cr',2000,'d','FNB-BAR','n','Beverage')
    ), 'CASH-0926', 'Posted', null, '1111', 'CASH');
    perform pg_temp.acc_seed_voucher(p, 'RV', date '2026-09-27', 'Card settlement received - room charges', jsonb_build_array(
      jsonb_build_object('a','1122','dr',45000,'n','EDC settlement'),
      jsonb_build_object('a','3110','cr',45000,'d','ROOMS','n','Room revenue')
    ), 'EDC-0927', 'Posted', null, '1122', 'CARD', 'EDC-BATCH-0927');

    -- Supplier bills and payments
    v_v := pg_temp.acc_seed_voucher(p, 'PUR', date '2026-07-05', 'Provisions supply - Amaan Agency', jsonb_build_array(
      jsonb_build_object('a','4110','dr',85000,'d','FNB-REST','n','Groceries and dry provisions'),
      jsonb_build_object('a','2415','cr',85000,'p','P-0008','n','BILL-2026-0044')
    ), 'BILL-2026-0044', 'Posted', 'P-0008');
    v_b := pg_temp.acc_seed_bill(p, 'P-0008', 'AP', 'Bill', 'BILL-2026-0044', date '2026-07-05', date '2026-07-12', 85000, 'Dry provisions - July', v_v, 'FNB');
    v_v := pg_temp.acc_seed_voucher(p, 'PV', date '2026-07-15', 'Part payment to Amaan Agency', jsonb_build_array(
      jsonb_build_object('a','2415','dr',50000,'p','P-0008','n','Against BILL-2026-0044'),
      jsonb_build_object('a','1123','cr',50000,'n','Cheque 044012','chq','044012')
    ), 'BILL-2026-0044', 'Posted', 'P-0008', '1123', 'CHQ', '044012');
    perform pg_temp.acc_seed_settle(p, v_b, v_v, date '2026-07-15', 50000, 'Payments', 'CHQ-044012');

    v_v := pg_temp.acc_seed_voucher(p, 'PUR', date '2026-09-01', 'Fresh produce supply - September', jsonb_build_array(
      jsonb_build_object('a','4110','dr',85000,'d','FNB-REST','n','Vegetables, dairy and meat'),
      jsonb_build_object('a','2415','cr',85000,'p','P-0009','n','BILL-2026-0089')
    ), 'BILL-2026-0089', 'Posted', 'P-0009');
    v_b := pg_temp.acc_seed_bill(p, 'P-0009', 'AP', 'Bill', 'BILL-2026-0089', date '2026-09-01', date '2026-09-15', 85000, 'Fresh produce - September', v_v, 'FNB');
    v_v := pg_temp.acc_seed_voucher(p, 'PV', date '2026-09-10', 'Payment to Fresh Foods Distributors', jsonb_build_array(
      jsonb_build_object('a','2415','dr',85000,'p','P-0009','n','Against BILL-2026-0089'),
      jsonb_build_object('a','1121','cr',85000,'n','NEFT')
    ), 'BILL-2026-0089', 'Posted', 'P-0009', '1121', 'NEFT', 'NEFT-99120');
    perform pg_temp.acc_seed_settle(p, v_b, v_v, date '2026-09-10', 85000, 'Payments', 'NEFT-99120');

    v_v := pg_temp.acc_seed_voucher(p, 'PUR', date '2026-09-20', 'Bar stock replenishment', jsonb_build_array(
      jsonb_build_object('a','4120','dr',62000,'d','FNB-BAR','n','Spirits, beer and mixers'),
      jsonb_build_object('a','2415','cr',62000,'p','P-0010','n','INV-2026-882')
    ), 'INV-2026-882', 'Posted', 'P-0010');
    perform pg_temp.acc_seed_bill(p, 'P-0010', 'AP', 'Bill', 'INV-2026-882', date '2026-09-20', date '2026-09-27', 62000, 'Bar stock - September', v_v, 'FNB');

    v_v := pg_temp.acc_seed_voucher(p, 'PUR', date '2026-09-05', 'Electricity bill - August consumption', jsonb_build_array(
      jsonb_build_object('a','4220','dr',85000,'d','ENG','n','HT connection - August'),
      jsonb_build_object('a','2410','cr',85000,'p','P-0011','n','UTIL-AUG-2026')
    ), 'UTIL-AUG-2026', 'Posted', 'P-0011');
    perform pg_temp.acc_seed_bill(p, 'P-0011', 'AP', 'Bill', 'UTIL-AUG-2026', date '2026-09-05', date '2026-10-05', 85000, 'Electricity - August 2026', v_v, 'ENG');

    -- Draft + provisional entries -------------------------------------------
    perform pg_temp.acc_seed_voucher(p, 'JV', date '2026-09-26', 'Reclassification of banquet advance (pending review)', jsonb_build_array(
      jsonb_build_object('a','2450','dr',25000,'n','Advance from wedding booking'),
      jsonb_build_object('a','3140','cr',25000,'d','BANQ','n','Banquet revenue recognised')
    ), 'BQ-ADV-0926', 'Draft');

    perform pg_temp.acc_seed_voucher(p, 'PRV', date '2026-09-25', 'Provision for electricity - September', jsonb_build_array(
      jsonb_build_object('a','4220','dr',45000,'d','ENG','n','Estimated consumption'),
      jsonb_build_object('a','2410','cr',45000,'p','P-0011','n','Accrued utility')
    ), 'PROV-UTIL-09', 'Provisional', 'P-0011', null, null, '', 'Accrued Expense', 'Utilities', date '2026-10-10');
    perform pg_temp.acc_seed_voucher(p, 'PRV', date '2026-09-24', 'Unbilled revenue - Infosys extended stay', jsonb_build_array(
      jsonb_build_object('a','1191','dr',32000,'p','P-0002','n','Unbilled room nights'),
      jsonb_build_object('a','3110','cr',32000,'d','ROOMS','n','Room revenue accrual')
    ), 'PROV-UNB-09', 'Provisional', 'P-0002', null, null, '', 'Unbilled Revenue', 'Revenue Accrual', date '2026-10-05');
    perform pg_temp.acc_seed_voucher(p, 'PRV', date '2026-09-22', 'Audit fee accrual - Q2', jsonb_build_array(
      jsonb_build_object('a','4250','dr',25000,'d','ADMIN','n','Statutory audit fee'),
      jsonb_build_object('a','2410','cr',25000,'n','Audit fee payable')
    ), 'PROV-AUD-Q2', 'Provisional', null, null, null, '', 'Accrued Expense', 'Professional Fees', date '2026-10-15');

    -- Bank reconciliation: everything cleared up to 31 Aug 2026 -----------------
    update public.acc_voucher_lines l
       set reconciled = true,
           recon_date = least(v.voucher_date + 2, date '2026-08-31'),
           reconciled_by = 'Accounts Executive',
           reconciled_at = (least(v.voucher_date + 2, date '2026-08-31')::timestamp + time '16:00') at time zone 'Asia/Kolkata'
      from public.acc_vouchers v, public.acc_accounts a
     where l.voucher_id = v.id
       and a.id = l.account_id
       and a.is_bank_account
       and v.status = 'Posted'
       and v.voucher_date <= date '2026-08-31'
       and l.property_id = p;

    -- Closing stock count 31 Aug 2026 ------------------------------------------
    insert into public.acc_closing_stock_items (property_id, valuation_date, store_name, valuation_method, item_code, item_name, category, uom, sys_qty, physical_qty, unit_rate, prev_period_value, stock_account_id, consumption_account_id, status, last_audit_date, created_by)
    select p, date '2026-08-31', x.store, 'Weighted Average', x.code, x.name, x.cat, x.uom, x.sys, x.phy, x.rate, x.prev,
           pg_temp.acc_account_id(p, x.stock), pg_temp.acc_account_id(p, x.cons), x.st, date '2026-09-02', 'Store Keeper'
      from (values
        ('Main Kitchen Store', 'FD-001', 'Basmati Rice (Premium)', 'Food Provisions', 'Kg', 180::numeric, 176::numeric, 118::numeric, 19500::numeric, '1401', '4110', 'Audited'),
        ('Main Kitchen Store', 'FD-014', 'Refined Sunflower Oil', 'Food Provisions', 'Ltr', 120, 118, 165, 21000, '1401', '4110', 'Audited'),
        ('Main Kitchen Store', 'FD-027', 'Paneer (Fresh)', 'Dairy', 'Kg', 25, 24, 380, 8400, '1401', '4110', 'Draft'),
        ('Bar Store', 'BV-003', 'Single Malt Whisky 750ml', 'Spirits', 'Btl', 36, 36, 3200, 108000, '1402', '4120', 'Audited'),
        ('Bar Store', 'BV-011', 'Premium Lager 330ml', 'Beer', 'Case', 22, 21, 1450, 29000, '1402', '4120', 'Draft'),
        ('Housekeeping Store', 'HK-005', 'Guest Toiletry Kit', 'Guest Amenities', 'Nos', 850, 842, 28, 22000, '1403', '4130', 'Audited'),
        ('Housekeeping Store', 'HK-012', 'Bath Towel (White)', 'Linen', 'Nos', 160, 155, 290, 48000, '1403', '4130', 'Draft')
      ) as x(store, code, name, cat, uom, sys, phy, rate, prev, stock, cons, st);

    -- Covering letters ----------------------------------------------------------
    insert into public.acc_covering_letters (property_id, letter_no, letter_date, party_id, status, total_amount, bills_count, prepared_by, remarks)
    values (p, 'BCL/26-27/0001', date '2026-07-12', pg_temp.acc_party_id(p, 'P-0001'), 'Active', 150000, 1, 'Accounts Executive', 'Sent with courier AWB 5521880')
    returning id into v_letter;
    insert into public.acc_covering_letter_bills (property_id, letter_id, bill_id, amount)
    select p, v_letter, b.id, b.amount from public.acc_party_bills b
     where b.property_id = p and b.bill_no = 'INV-2026-0812';

    insert into public.acc_covering_letters (property_id, letter_no, letter_date, party_id, status, total_amount, bills_count, prepared_by, remarks, reversed_at, reversed_by, reversal_reason)
    values (p, 'BCL/26-27/0002', date '2026-05-12', pg_temp.acc_party_id(p, 'P-0005'), 'Reversed', 220000, 1, 'Accounts Executive', 'Emailed to partner finance',
            timestamptz '2026-05-20 12:00+05:30', 'Finance Manager', 'Partner requested revised invoice format')
    returning id into v_letter;
    insert into public.acc_covering_letter_bills (property_id, letter_id, bill_id, amount)
    select p, v_letter, b.id, b.amount from public.acc_party_bills b
     where b.property_id = p and b.bill_no = 'INV-2026-0410';

    -- Audit trail ----------------------------------------------------------------
    insert into public.acc_audit_logs (property_id, entity_type, entity_id, action, actor, reason, created_at)
    values
      (p, 'fiscal_year', v_fy_prev, 'Opened', 'Finance Controller', null, timestamptz '2025-04-01 09:00+05:30'),
      (p, 'fiscal_year', v_fy_prev, 'Closed', 'Finance Controller', 'Year-end audit completed', timestamptz '2026-04-30 18:00+05:30'),
      (p, 'fiscal_year', v_fy_cur, 'Opened', 'Finance Controller', null, timestamptz '2026-04-01 09:00+05:30'),
      (p, 'fiscal_year', v_fy_cur, 'Set Current', 'Finance Controller', null, timestamptz '2026-04-01 09:05+05:30');

    raise notice 'Accounts seeded for %', p;
  end loop;
end $$;

notify pgrst, 'reload schema';
