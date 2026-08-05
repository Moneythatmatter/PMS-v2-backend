# PMS Backend (TypeScript)

Express + Supabase API for Hotel PMS (Front Office, Food & Beverages, Housekeeping, Auth).

## Setup

1. Install deps: `npm install`
2. Ensure `.env` has:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `PORT=5001` (5000 is often taken by macOS AirPlay)
3. **Create tables** — open Supabase Dashboard → SQL Editor → paste and run:
   [`sql/front-office-schema.sql`](sql/front-office-schema.sql)
4. Start: `npm run dev` → http://localhost:5001

## API Documentation (OpenAPI)

Interactive Swagger UI with all endpoints, categorized by module:

- **Swagger UI:** http://localhost:5001/api-docs
- **OpenAPI JSON:** http://localhost:5001/api-docs.json

Tags are grouped as:

| Prefix | Categories |
|--------|------------|
| System / Auth | Health, login, current user |
| FO · … | Dashboard, Reservations, Rooms, Masters, Guests, Billing, Guest Services, Closing, Reports |
| FB · … | Dashboard, Live Tables, Orders, KDS, Cashier, Menu, Banquet, Inventory, Bar, Settings, Reports |
| HK · … | Dashboard, Rooms, Laundry, Requisitions, Public Areas, Staff, Inventory, Guest Services, Reports |

## Scripts

- `npm run dev` — tsx watch
- `npm run build` — compile to `dist/`
- `npm start` — run compiled server

## F&B API

Base: `/api/food-beverages`

1. Run SQL: [`sql/food-beverages-schema.sql`](sql/food-beverages-schema.sql) in Supabase SQL Editor
2. Restart: `npm run dev`

Ops:
- `GET /dashboard`
- `GET|PATCH /live-tables`, `POST /live-tables/:id/seat|settle|clean`
- `GET|POST /orders`, `POST /orders/:id/advance`
- `GET /kds`, `POST /kds/:id/advance`
- `GET|POST /cashier-shifts`, `POST /cashier-shifts/:id/close`

Also CRUD for outlets, menu, banquet, inventory, bar, settings, and `GET /reports/:type`.

## Housekeeping API

Base: `/api/housekeeping`

1. Run SQL: [`sql/housekeeping-schema.sql`](sql/housekeeping-schema.sql) in Supabase SQL Editor (after front-office schema)
2. Restart: `npm run dev`

Ops:
- `GET /dashboard`
- Rooms: `GET|POST /rooms`, `POST /rooms/:id/start-clean|pause-clean|complete-clean|inspect|mark-dirty`
- Laundry: `GET|POST /laundry`, `POST /laundry/:id/advance`
- Requisitions: `GET|POST /requisitions`, `POST /requisitions/:id/approve|issue|reject`

Also CRUD for public-areas, checklists, staff, shifts, inventory, damage-reports, history, luggage, settings.
Shared FO tables via `/guest-requests`, `/maintenance`, `/lost-found`.
Reports: `GET /reports/:type` (`room-status`, `cleaning-productivity`, `inspection`, `laundry`, `inventory`, `damage`, `staff-performance`, `public-area`).
