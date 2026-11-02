-- =============================================================================
-- Accounts — basic setup for a new property (master data only, no transactions).
--
-- public.acc_seed_property(property_id) creates, for a property that has no Accounts
-- company yet:
--   base currency INR, company, current + next fiscal year (Indian FY, April–March) with
--   periods, chart of accounts, company settings (GL defaults incl. Guest Ledger), divisions,
--   party sub types, starter parties, payment methods (mapped to Front Office payment modes),
--   voucher types, revenue categories, GST definitions + rules, and billing point mappings
--   (room nights, laundry, minibar, other charges, restaurant and room service bills).
--
-- The backend calls it when a property is created (Platform → Properties). The block at the
-- end also sets up every existing property that has no Accounts company yet.
--
-- Run after accounts-schema.sql, accounts-universal-party-types.sql, accounts-tax-billing-points.sql,
-- accounts-tax-billing-points-rules.sql, accounts-fo-posting.sql and accounts-fo-posting-phase2.sql.
-- Safe to re-run: properties that already have an Accounts company are skipped.
-- =============================================================================

create or replace function public.acc_account_id_by_code(p_property_id text, p_code text)
returns uuid
language sql
stable
as $$
  select id from public.acc_accounts where property_id = p_property_id and code = p_code limit 1;
$$;

create or replace function public.acc_seed_property(p_property_id text)
returns jsonb
language plpgsql
security definer
as $$
declare
  p text := p_property_id;
  r record;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_fy_start date;
  v_inr uuid;
  v_company uuid;
  v_fy_cur uuid;
  v_fy_next uuid;
  v_rooms uuid; v_fnb uuid; v_banq uuid; v_hk uuid;
  v_type_cust uuid; v_type_corp uuid; v_type_ta uuid; v_type_ota uuid; v_type_cc uuid; v_type_vend uuid; v_type_emp uuid;
begin
  select id, name, code, city into r from public.properties where id = p;
  if not found then
    raise exception 'Property % not found', p;
  end if;
  if exists (select 1 from public.acc_companies where property_id = p) then
    return jsonb_build_object('propertyId', p, 'seeded', false, 'reason', 'Accounts already set up');
  end if;

  select id into v_type_cust from public.acc_party_types where type_code = 'CUST';
  select id into v_type_corp from public.acc_party_types where type_code = 'CORP';
  select id into v_type_ta   from public.acc_party_types where type_code = 'TA';
  select id into v_type_ota  from public.acc_party_types where type_code = 'OTA';
  select id into v_type_cc   from public.acc_party_types where type_code = 'CC';
  select id into v_type_vend from public.acc_party_types where type_code = 'VEND';
  select id into v_type_emp  from public.acc_party_types where type_code = 'EMP';
  if v_type_cust is null or v_type_vend is null then
    raise exception 'Party types are missing — run accounts-universal-party-types.sql first';
  end if;

  v_fy_start := make_date(
    case when extract(month from v_today) >= 4 then extract(year from v_today)::int else extract(year from v_today)::int - 1 end,
    4, 1
  );

  -- Base currency -------------------------------------------------------------
  -- Every insert below skips rows that already exist (a property may have been set up partly by hand).
  insert into public.acc_currencies (property_id, code, name, symbol, country, decimal_places, is_base_currency,
                                     exchange_rate_to_base, rate_effective_date, rate_source, foreign_transactions_allowed, status, created_by)
  values (p, 'INR', 'Indian Rupee', '₹', 'India', 2,
          not exists (select 1 from public.acc_currencies where property_id = p and is_base_currency),
          1, v_fy_start, 'Base Currency', false, 'Active', 'System')
  on conflict do nothing;
  select id into v_inr from public.acc_currencies where property_id = p and code = 'INR';

  -- Company -------------------------------------------------------------------
  insert into public.acc_companies (property_id, company_code, trade_name, legal_name, alias, company_type, business_nature,
                                    status, city, country, gst_applicable, base_currency_id, created_by)
  values (p, upper(r.code), r.name, r.name, upper(r.code), 'Private Limited', 'Hospitality',
          'Active', coalesce(r.city, ''), 'India', true, v_inr, 'System')
  returning id into v_company;

  -- Fiscal years + periods (only when the property has none yet) -------------------
  if not exists (select 1 from public.acc_fiscal_years where property_id = p) then
    insert into public.acc_fiscal_years (property_id, company_id, fiscal_year_name, fy_code, start_date, end_date, status, is_current, opened_at, opened_by, created_by)
    values (p, v_company,
            'FY ' || extract(year from v_fy_start)::int || '-' || right((extract(year from v_fy_start)::int + 1)::text, 2),
            right(extract(year from v_fy_start)::int::text, 2) || '-' || right((extract(year from v_fy_start)::int + 1)::text, 2),
            v_fy_start, (v_fy_start + interval '1 year' - interval '1 day')::date, 'Open', true, now(), 'System', 'System');

    insert into public.acc_fiscal_years (property_id, company_id, fiscal_year_name, fy_code, start_date, end_date, status, is_current, created_by)
    values (p, v_company,
            'FY ' || (extract(year from v_fy_start)::int + 1) || '-' || right((extract(year from v_fy_start)::int + 2)::text, 2),
            right((extract(year from v_fy_start)::int + 1)::text, 2) || '-' || right((extract(year from v_fy_start)::int + 2)::text, 2),
            (v_fy_start + interval '1 year')::date, (v_fy_start + interval '2 years' - interval '1 day')::date, 'Upcoming', false, 'System');
  end if;
  update public.acc_fiscal_years set company_id = v_company where property_id = p and company_id is null;

  select id into v_fy_cur from public.acc_fiscal_years
   where property_id = p
   order by is_current desc, (v_today between start_date and end_date) desc, start_date desc
   limit 1;

  insert into public.acc_fiscal_periods (property_id, fiscal_year_id, period_no, period_code, period_name, start_date, end_date, status)
  select p, fy.id, gs.n, 'P-' || lpad(gs.n::text, 2, '0'),
         to_char(fy.start_date + make_interval(months => gs.n - 1), 'FMMonth YYYY'),
         (fy.start_date + make_interval(months => gs.n - 1))::date,
         (fy.start_date + make_interval(months => gs.n) - interval '1 day')::date,
         'Open'
    from public.acc_fiscal_years fy
    cross join generate_series(1, 12) as gs(n)
   where fy.property_id = p
     and fy.status <> 'Closed'
     and not exists (select 1 from public.acc_fiscal_periods fp where fp.fiscal_year_id = fy.id)
  on conflict do nothing;

  -- Chart of accounts -------------------------------------------------------------
  insert into public.acc_accounts (property_id, code, name, account_type, nature, report_section, category, classification, allow_posting, is_system_account, description)
  values
    (p, '1000', 'Assets', 'Group', 'Asset', '', 'Assets', 'Balance Sheet', false, true, 'All property assets'),
    (p, '2000', 'Liabilities & Equity', 'Group', 'Liability', '', 'Liabilities', 'Balance Sheet', false, true, 'Owner funds and obligations'),
    (p, '3000', 'Income', 'Group', 'Income', '', 'Income', 'Profit & Loss', false, true, 'Operating and other income'),
    (p, '4000', 'Expenses', 'Group', 'Expense', '', 'Expenses', 'Profit & Loss', false, true, 'Operating and other expenses')
  on conflict do nothing;

  insert into public.acc_accounts (property_id, parent_id, code, name, account_type, nature, report_section, category, classification, allow_posting, is_system_account)
  select p, public.acc_account_id_by_code(p, x.parent), x.code, x.name, 'Group', x.nature, x.section, x.category, x.class, false, true
    from (values
      ('1000', '1100', 'Current Assets', 'Asset', 'Current Assets', 'Current Assets', 'Balance Sheet'),
      ('1000', '1500', 'Fixed Assets', 'Asset', 'Fixed Assets', 'Fixed Assets', 'Balance Sheet'),
      ('2000', '2100', 'Capital & Reserves', 'Liability', 'Capital & Reserves', 'Equity', 'Balance Sheet'),
      ('2000', '2400', 'Current Liabilities', 'Liability', 'Current Liabilities', 'Current Liabilities', 'Balance Sheet'),
      ('2000', '2500', 'Non-Current Liabilities', 'Liability', 'Non-Current Liabilities', 'Long Term Borrowings', 'Balance Sheet'),
      ('3000', '3100', 'Direct Income', 'Income', 'Direct Income', 'Operating Revenue', 'Profit & Loss'),
      ('3000', '3200', 'Indirect Income', 'Income', 'Indirect Income', 'Other Income', 'Profit & Loss'),
      ('4000', '4100', 'Direct Expenses', 'Expense', 'Direct Expenses', 'Cost of Sales', 'Profit & Loss'),
      ('4000', '4200', 'Indirect Expenses', 'Expense', 'Indirect Expenses', 'Operating Expenses', 'Profit & Loss')
    ) as x(parent, code, name, nature, section, category, class)
  on conflict do nothing;

  insert into public.acc_accounts (property_id, parent_id, code, name, account_type, nature, report_section, category, classification, allow_posting, is_system_account)
  select p, public.acc_account_id_by_code(p, x.parent), x.code, x.name, 'Group', 'Asset', 'Current Assets', x.category, 'Balance Sheet', false, true
    from (values
      ('1100', '1110', 'Cash & Bank Balances', 'Cash & Bank'),
      ('1100', '1190', 'Trade Receivables', 'Receivables'),
      ('1100', '1400', 'Inventories', 'Stock')
    ) as x(parent, code, name, category)
  on conflict do nothing;

  insert into public.acc_accounts (property_id, parent_id, code, name, account_type, nature, report_section, category, classification,
                                   allow_posting, is_system_account, is_bank_account, is_cash_account)
  select p, public.acc_account_id_by_code(p, x.parent), x.code, x.name, 'Ledger', x.nature, x.section, x.category,
         case when x.nature in ('Income', 'Expense') then 'Profit & Loss' else 'Balance Sheet' end,
         true, x.sys, x.bank, x.cash
    from (values
      ('1110', '1111', 'Cash in Hand - Front Desk', 'Asset', 'Current Assets', 'Cash & Bank', true, false, true),
      ('1110', '1112', 'Cash in Hand - F&B Outlets', 'Asset', 'Current Assets', 'Cash & Bank', false, false, true),
      ('1110', '1113', 'Petty Cash', 'Asset', 'Current Assets', 'Cash & Bank', false, false, true),
      ('1110', '1121', 'Bank - Operating Account', 'Asset', 'Current Assets', 'Cash & Bank', false, true, false),
      ('1110', '1122', 'Bank - Card / UPI Settlement Account', 'Asset', 'Current Assets', 'Cash & Bank', false, true, false),
      ('1190', '1191', 'Sundry Debtors - Corporate', 'Asset', 'Current Assets', 'Receivables', true, false, false),
      ('1190', '1192', 'Sundry Debtors - Travel Agents', 'Asset', 'Current Assets', 'Receivables', true, false, false),
      ('1190', '1193', 'Credit Card Receivables', 'Asset', 'Current Assets', 'Receivables', false, false, false),
      ('1190', '1194', 'Guest Ledger - In-House', 'Asset', 'Current Assets', 'Receivables', true, false, false),
      ('1400', '1401', 'Stock - Food Provisions', 'Asset', 'Current Assets', 'Stock', false, false, false),
      ('1400', '1402', 'Stock - Beverages', 'Asset', 'Current Assets', 'Stock', false, false, false),
      ('1400', '1403', 'Stock - Guest Amenities & Linen', 'Asset', 'Current Assets', 'Stock', false, false, false),
      ('1500', '1510', 'Building & Furniture', 'Asset', 'Fixed Assets', 'Fixed Assets', false, false, false),
      ('1500', '1520', 'Plant & Equipment', 'Asset', 'Fixed Assets', 'Fixed Assets', false, false, false),
      ('2100', '2110', 'Capital Account', 'Liability', 'Capital & Reserves', 'Equity', true, false, false),
      ('2100', '2120', 'Retained Earnings & Reserves', 'Liability', 'Capital & Reserves', 'Equity', true, false, false),
      ('2400', '2410', 'Sundry Creditors - Vendors', 'Liability', 'Current Liabilities', 'Payables', true, false, false),
      ('2400', '2430', 'GST Output Payable', 'Liability', 'Current Liabilities', 'Duties & Taxes', true, false, false),
      ('2400', '2435', 'GST Input Credit', 'Liability', 'Current Liabilities', 'Duties & Taxes', false, false, false),
      ('2400', '2440', 'TDS Payable', 'Liability', 'Current Liabilities', 'Duties & Taxes', false, false, false),
      ('2400', '2450', 'Guest Advance Deposits', 'Liability', 'Current Liabilities', 'Advances', true, false, false),
      ('2400', '2490', 'Round Off', 'Liability', 'Current Liabilities', 'Round Off', true, false, false),
      ('3100', '3110', 'Room Revenue', 'Income', 'Direct Income', 'Room Revenue', true, false, false),
      ('3100', '3120', 'Food Revenue', 'Income', 'Direct Income', 'Food Revenue', true, false, false),
      ('3100', '3130', 'Beverage Revenue', 'Income', 'Direct Income', 'Beverage Revenue', false, false, false),
      ('3100', '3140', 'Banquet & Events Revenue', 'Income', 'Direct Income', 'Banquet Revenue', false, false, false),
      ('3100', '3150', 'Laundry & Other Services', 'Income', 'Direct Income', 'Other Operating Revenue', false, false, false),
      ('3200', '3210', 'Interest Income', 'Income', 'Indirect Income', 'Other Income', false, false, false),
      ('3200', '3220', 'Commission & Misc Income', 'Income', 'Indirect Income', 'Other Income', false, false, false),
      ('4100', '4110', 'Cost of Food Consumed', 'Expense', 'Direct Expenses', 'Cost of Sales', false, false, false),
      ('4100', '4120', 'Cost of Beverages Consumed', 'Expense', 'Direct Expenses', 'Cost of Sales', false, false, false),
      ('4100', '4130', 'Guest Amenities Consumed', 'Expense', 'Direct Expenses', 'Cost of Sales', false, false, false),
      ('4200', '4210', 'Salaries & Wages', 'Expense', 'Indirect Expenses', 'Payroll', false, false, false),
      ('4200', '4220', 'Heat, Light & Power', 'Expense', 'Indirect Expenses', 'Utilities', false, false, false),
      ('4200', '4230', 'Repairs & Maintenance', 'Expense', 'Indirect Expenses', 'Repairs & Maintenance', false, false, false),
      ('4200', '4240', 'Sales & Marketing', 'Expense', 'Indirect Expenses', 'Sales & Marketing', false, false, false),
      ('4200', '4250', 'Administrative & General', 'Expense', 'Indirect Expenses', 'Administrative & General', false, false, false),
      ('4200', '4260', 'OTA / Travel Agent Commission', 'Expense', 'Indirect Expenses', 'Commission', false, false, false),
      ('4200', '4270', 'Bank Charges & Finance Costs', 'Expense', 'Indirect Expenses', 'Finance Costs', false, false, false)
    ) as x(parent, code, name, nature, section, category, sys, bank, cash)
  on conflict do nothing;

  update public.acc_fiscal_years
     set retained_earnings_account_id = public.acc_account_id_by_code(p, '2120')
   where property_id = p
     and retained_earnings_account_id is null;

  -- Company settings --------------------------------------------------------------
  insert into public.acc_company_settings (
    property_id, company_id, current_fiscal_year_id, accounting_method, decimal_places,
    allow_future_transactions, allow_back_dated_posting, back_dated_limit_days,
    require_voucher_approval, auto_voucher_numbering, voucher_reset_frequency, allow_manual_voucher_no,
    prevent_duplicate_vouchers, require_posting_approval, allow_negative_cash, enforce_credit_limit,
    default_receivable_account_id, default_payable_account_id, default_round_off_account_id,
    default_guest_deposit_account_id, default_guest_ledger_account_id, fo_posting_status,
    enable_gst, enable_einvoice, enable_tds_deductions, configured_by
  ) values (
    p, v_company, v_fy_cur, 'Accrual', 2,
    false, true, 30,
    false, true, 'Yearly', false,
    true, false, false, true,
    public.acc_account_id_by_code(p, '1191'), public.acc_account_id_by_code(p, '2410'), public.acc_account_id_by_code(p, '2490'),
    public.acc_account_id_by_code(p, '2450'), public.acc_account_id_by_code(p, '1194'), 'Draft',
    true, false, true, 'System'
  )
  on conflict do nothing;

  -- Divisions -----------------------------------------------------------------------
  insert into public.acc_divisions (property_id, company_id, division_code, division_name, short_name, division_type, sequence, description)
  values
    (p, v_company, 'ROOMS', 'Rooms Division', 'Rooms', 'Revenue Center', 1, 'Front office and room sales'),
    (p, v_company, 'FNB', 'Food & Beverage', 'F&B', 'Revenue Center', 2, 'Restaurants, bar and room service'),
    (p, v_company, 'BANQ', 'Banquets & Events', 'Banquets', 'Revenue Center', 3, 'Weddings, conferences and events'),
    (p, v_company, 'HK', 'Housekeeping & Laundry', 'HK', 'Revenue Center', 4, 'Guest laundry and housekeeping'),
    (p, v_company, 'ADMIN', 'Administration & General', 'A&G', 'Cost Center', 5, 'Accounts, HR and management'),
    (p, v_company, 'SALES', 'Sales & Marketing', 'S&M', 'Cost Center', 6, 'Sales team and campaigns'),
    (p, v_company, 'ENG', 'Engineering & Maintenance', 'Engg', 'Cost Center', 7, 'Plant, utilities and repairs')
  on conflict do nothing;
  select id into v_rooms from public.acc_divisions where property_id = p and division_code = 'ROOMS';
  select id into v_fnb   from public.acc_divisions where property_id = p and division_code = 'FNB';
  select id into v_banq  from public.acc_divisions where property_id = p and division_code = 'BANQ';
  select id into v_hk    from public.acc_divisions where property_id = p and division_code = 'HK';

  -- Party sub types -----------------------------------------------------------------------
  insert into public.acc_party_sub_types (property_id, party_type_id, sub_type_code, sub_type_name, description, sequence)
  select p, x.type_id, x.code, x.name, x.descr, x.seq
    from (values
      (v_type_cust, 'WALKIN', 'Walk-in Guest', 'Direct walk-in guests', 1),
      (v_type_cust, 'CITYLEDGER', 'City Ledger', 'Guests billed on account', 2),
      (v_type_corp, 'CORPCONTRACT', 'Contracted Corporate', 'Corporates with negotiated rates', 1),
      (v_type_corp, 'MICE', 'MICE Client', 'Meetings, incentives, conferences and events', 2),
      (v_type_ota, 'OTA', 'Online Travel Agent', 'Online booking channels', 1),
      (v_type_ta, 'OFFLINETA', 'Offline Travel Agent', 'Tour operators and offline agents', 1),
      (v_type_cc, 'CCACQ', 'Card Acquirer', 'EDC and payment gateway settlements', 1),
      (v_type_vend, 'FNBSUP', 'F&B Supplier', 'Food and beverage suppliers', 1),
      (v_type_vend, 'GENSUP', 'General Supplier', 'Housekeeping, stationery and general stores', 2),
      (v_type_vend, 'UTIL', 'Utility Provider', 'Electricity, water and gas', 3),
      (v_type_vend, 'AMC', 'Service / AMC Vendor', 'Maintenance contracts', 4),
      (v_type_emp, 'STAFF', 'Staff Advance', 'Salary and travel advances', 1)
    ) as x(type_id, code, name, descr, seq)
   where x.type_id is not null
  on conflict do nothing;

  -- Payment methods (fo_payment_mode links Front Office / F&B payments to the ledger) ------
  insert into public.acc_payment_methods (property_id, company_id, account_id, payment_method_code, payment_method_name,
                                          method_type, reference_required, description, fo_payment_mode)
  values
    (p, v_company, public.acc_account_id_by_code(p, '1111'), 'CASH', 'Cash', 'Cash', false, 'Cash collected at the front desk and outlets', 'CASH'),
    (p, v_company, public.acc_account_id_by_code(p, '1122'), 'CARD', 'Credit / Debit Card', 'Card', true, 'EDC card settlements', 'CARD'),
    (p, v_company, public.acc_account_id_by_code(p, '1122'), 'UPI', 'UPI', 'UPI', true, 'UPI QR collections', 'UPI'),
    (p, v_company, public.acc_account_id_by_code(p, '1121'), 'NEFT', 'NEFT / RTGS', 'Bank Transfer', true, 'Electronic bank transfers', 'BANK_TRANSFER'),
    (p, v_company, public.acc_account_id_by_code(p, '1121'), 'CHQ', 'Cheque', 'Cheque', true, 'Cheque deposits and issues', 'CHEQUE'),
    (p, v_company, public.acc_account_id_by_code(p, '1121'), 'OTHER', 'Other', 'Bank Transfer', false, 'Wallets and other modes', 'OTHER'),
    (p, v_company, null, 'CL', 'City Ledger / Credit', 'Credit', false, 'Billed to company account', null)
  on conflict do nothing;

  -- Starter parties -------------------------------------------------------------------------
  insert into public.acc_parties (property_id, party_code, party_name, short_name, party_type_id, party_sub_type_id, party_group,
                                  entity_type, country, currency_id, credit_days, credit_limit,
                                  receivable_account_id, payable_account_id, remarks, created_by)
  select p, x.code, x.name, x.short_name, pst.party_type_id, pst.id, x.grp, x.entity, 'India', v_inr, x.days, 0,
         public.acc_account_id_by_code(p, x.recv), public.acc_account_id_by_code(p, x.pay), x.remarks, 'System'
    from (values
      ('P-0001', 'Walk-in Guests', 'Walk-in', 'WALKIN', 'Sundry Debtors', 'Individual', 0, '1194', null::text, 'Default party for walk-in guest billing'),
      ('P-0002', 'Card Settlements (EDC)', 'EDC', 'CCACQ', 'Credit Card Company', 'Company', 2, '1193', null, 'Card and UPI settlement receivable'),
      ('P-0003', 'Cash Purchases', 'Cash Purchase', 'GENSUP', 'Sundry Creditors', 'Company', 0, null, '2410', 'Small cash purchases without a regular vendor')
    ) as x(code, name, short_name, sub_type, grp, entity, days, recv, pay, remarks)
    join public.acc_party_sub_types pst on pst.property_id = p and pst.sub_type_code = x.sub_type
  on conflict do nothing;

  -- Voucher types ----------------------------------------------------------------------------
  insert into public.acc_voucher_types (property_id, company_id, voucher_type_name, short_code, category, sequence, prefix_template,
                                        starting_number, reset_frequency, default_entry_nature, party_required, division_required, is_system)
  values
    (p, v_company, 'Journal Voucher', 'JV', 'Journal', 1, 'JV/{FY}/', 1, 'Yearly', 'None', false, false, true),
    (p, v_company, 'Receipt Voucher', 'RV', 'Receipt', 2, 'RV/{FY}/', 1, 'Yearly', 'Debit', false, false, true),
    (p, v_company, 'Payment Voucher', 'PV', 'Payment', 3, 'PV/{FY}/', 1, 'Yearly', 'Credit', false, false, true),
    (p, v_company, 'Contra Voucher', 'CV', 'Contra', 4, 'CV/{FY}/', 1, 'Yearly', 'None', false, false, true),
    (p, v_company, 'Sales Invoice', 'SV', 'Sales', 5, 'SV/{FY}/', 1, 'Yearly', 'Debit', true, false, false),
    (p, v_company, 'Purchase Bill', 'PUR', 'Purchase', 6, 'PUR/{FY}/', 1, 'Yearly', 'Credit', true, false, false),
    (p, v_company, 'Credit Note', 'CN', 'Credit Note', 7, 'CN/{FY}/', 1, 'Yearly', 'Credit', true, false, false),
    (p, v_company, 'Debit Note', 'DN', 'Debit Note', 8, 'DN/{FY}/', 1, 'Yearly', 'Debit', true, false, false),
    (p, v_company, 'Provisional Entry', 'PRV', 'Journal', 9, 'PRV/{FY}/', 1, 'Yearly', 'None', false, false, true),
    (p, v_company, 'Opening Balance', 'OB', 'Opening', 10, 'OB/{FY}/', 1, 'Never', 'None', false, false, true)
  on conflict do nothing;

  -- Revenue categories ---------------------------------------------------------------------------
  insert into public.acc_revenue_categories (property_id, company_id, income_account_id, revenue_category_code, revenue_category_name, description)
  select p, v_company, public.acc_account_id_by_code(p, x.acc), x.code, x.name, x.descr
    from (values
      ('3110', 'ROOM', 'Room Revenue', 'Room tariff and extra bed charges'),
      ('3120', 'FOOD', 'Food & Beverage (Restaurant)', 'Restaurant, bar food and room service'),
      ('3130', 'BEV', 'Beverage / Minibar', 'Minibar and packaged beverages'),
      ('3140', 'BANQ', 'Banquet Revenue', 'Banquet hall, packages and events'),
      ('3150', 'LNDRY', 'Laundry', 'Guest laundry'),
      ('3150', 'MISC', 'Other Services', 'Miscellaneous guest services')
    ) as x(acc, code, name, descr)
  on conflict do nothing;

  -- GST definitions and rules (rates after the September 2025 GST rationalisation) ------------
  insert into public.acc_tax_definitions (property_id, company_id, output_account_id, tax_code, tax_name, tax_type, rate, calculation_type, hsn_sac_code, description)
  values
    (p, v_company, public.acc_account_id_by_code(p, '2430'), 'GST0', 'GST Exempt', 'GST', 0, 'Percentage', '996311', 'Room tariff up to ₹1,000'),
    (p, v_company, public.acc_account_id_by_code(p, '2430'), 'GST5', 'GST 5%', 'GST', 5, 'Percentage', '996331', 'Restaurant services; room tariff ₹1,001 - ₹7,500'),
    (p, v_company, public.acc_account_id_by_code(p, '2430'), 'GST18', 'GST 18%', 'GST', 18, 'Percentage', '996334', 'Room tariff above ₹7,500, banquets and other services')
  on conflict do nothing;

  insert into public.acc_tax_rules (property_id, company_id, tax_id, revenue_category_id, division_id, tax_rule_code, tax_rule_name,
                                    applicability_type, service_type, minimum_amount, maximum_amount, priority, effective_from, description)
  select p, v_company, td.id, rc.id, d.id, x.code, x.name, 'Revenue Category', x.svc, x.min_amt, x.max_amt, x.prio, v_fy_start, x.descr
    from (values
      ('TR-ROOM-0', 'Room Tariff up to ₹1,000', 'GST0', 'ROOM', 'ROOMS', 'Accommodation', 0::numeric, 1000::numeric, 1, 'Exempt room tariff slab'),
      ('TR-ROOM-5', 'Room Tariff ₹1,001 - ₹7,500', 'GST5', 'ROOM', 'ROOMS', 'Accommodation', 1001, 7500, 2, 'Room tariff slab (no input tax credit)'),
      ('TR-ROOM-18', 'Room Tariff above ₹7,500', 'GST18', 'ROOM', 'ROOMS', 'Accommodation', 7501, null, 3, 'Premium room tariff slab'),
      ('TR-FNB-5', 'Restaurant Food & Beverage', 'GST5', 'FOOD', 'FNB', 'Restaurant', null, null, 1, 'Restaurant services without input tax credit'),
      ('TR-BEV-5', 'Minibar / Beverages', 'GST5', 'BEV', 'FNB', 'Restaurant', null, null, 1, 'Minibar and beverages'),
      ('TR-BANQ-18', 'Banquet & Events', 'GST18', 'BANQ', 'BANQ', 'Outdoor Catering / Events', null, null, 1, 'Banquet packages'),
      ('TR-LNDRY-18', 'Guest Laundry', 'GST18', 'LNDRY', 'HK', 'Laundry', null, null, 1, 'Laundry services'),
      ('TR-MISC-18', 'Other Services', 'GST18', 'MISC', 'ROOMS', 'Other Services', null, null, 1, 'Miscellaneous guest services')
    ) as x(code, name, tax, cat, div, svc, min_amt, max_amt, prio, descr)
    join public.acc_tax_definitions td on td.property_id = p and td.tax_code = x.tax
    join public.acc_revenue_categories rc on rc.property_id = p and rc.revenue_category_code = x.cat
    left join public.acc_divisions d on d.property_id = p and d.division_code = x.div
   -- A category that already has its own rules keeps them (no overlapping slabs).
   where not exists (
     select 1 from public.acc_tax_rules t
      where t.property_id = p and t.revenue_category_id = rc.id and t.tax_rule_code <> x.code
   )
  on conflict do nothing;

  -- Billing points → revenue category (+ division for the income line) -----------------------
  insert into public.acc_tax_applications (property_id, company_id, billing_point, revenue_category_id, division_id,
                                           price_includes_tax, effective_from, description, created_by)
  select p, v_company, x.point, rc.id, d.id, false, v_fy_start, x.descr, 'System'
    from (values
      ('FO_ROOM_NIGHT', 'ROOM', 'ROOMS', 'Room tariff charged per night (Night Audit / checkout)'),
      ('FO_LAUNDRY', 'LNDRY', 'HK', 'Guest laundry charged to the room'),
      ('FO_MINIBAR', 'BEV', 'FNB', 'Minibar charged to the room'),
      ('FO_OTHER_CHARGE', 'MISC', 'ROOMS', 'Other charges posted to the folio'),
      ('FB_RESTAURANT_BILL', 'FOOD', 'FNB', 'Dine-in / takeaway bills'),
      ('FB_ROOM_SERVICE', 'FOOD', 'FNB', 'Room service bills')
    ) as x(point, cat, div, descr)
    join public.acc_revenue_categories rc on rc.property_id = p and rc.revenue_category_code = x.cat
    left join public.acc_divisions d on d.property_id = p and d.division_code = x.div
   where not exists (
     select 1 from public.acc_tax_applications a where a.property_id = p and a.billing_point = x.point
   );

  return jsonb_build_object('propertyId', p, 'seeded', true, 'companyId', v_company, 'fiscalYearId', v_fy_cur);
end;
$$;

grant execute on function public.acc_seed_property(text) to anon, authenticated;

-- Set up every existing property that has no Accounts company yet.
do $$
declare
  r record;
begin
  for r in
    select p.id from public.properties p
     where not exists (select 1 from public.acc_companies c where c.property_id = p.id)
  loop
    perform public.acc_seed_property(r.id);
    raise notice 'Accounts basic setup created for %', r.id;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
