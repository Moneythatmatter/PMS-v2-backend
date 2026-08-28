# Purchase & Stores — Database Setup

## 1. Run schema

In Supabase SQL Editor, run:

```
sql/purchase-stores-schema.sql
```

All tables use **UUID text primary keys** (`id text primary key default gen_random_uuid()::text`).

## 2. Seed data

**Option A — SQL Editor (recommended if seed script fails RLS):**

```
sql/purchase-stores-seeds.sql
```

**Option B — Node script** (requires RLS patch first if using anon key):

```bash
# If not done yet, run in Supabase SQL Editor first:
# sql/purchase-stores-rls-patch.sql

npm run seed:ps
```

Requires `.env` with `SUPABASE_URL` and `SUPABASE_ANON_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`).

## 3. API

Base path: `/api/purchase-stores`

| Resource | Endpoint |
|----------|----------|
| Dashboard | `GET /dashboard` |
| Units | `/masters/units` |
| Categories | `/masters/categories` |
| Suppliers | `/masters/suppliers` |
| Products | `/masters/products` |
| Warehouses | `/warehouses` |
| Requisitions | `/requisitions` |
| RFQs | `/rfqs` |
| Purchase Orders | `/purchase-orders` |
| Direct Purchases | `/direct-purchases` |
| Contracts | `/contracts` |
| Invoices | `/invoices` |
| GRNs | `/grns` (+ `GET /grns/by-po/:poNumber`) |
| Quality Inspections | `/quality-inspections` |
| Vendor Returns | `/vendor-returns` |
| Stock Balances | `/stock-balances` |
| Stock Ledger | `/stock-ledger` |
| Issues | `/stock-issues` |
| Transfers | `/stock-transfers` |
| Adjustments | `/stock-adjustments` |
| Par Stock | `/par-stock` |
| Batches | `/batches` |

All resources support standard REST CRUD: `GET`, `POST`, `PUT/PATCH`, `DELETE`.
