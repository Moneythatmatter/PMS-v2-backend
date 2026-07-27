# PMS Backend (TypeScript)

Express + Supabase API for Hotel PMS Front Office.

## Setup

1. Install deps: `npm install`
2. Ensure `.env` has:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `PORT=5001` (5000 is often taken by macOS AirPlay)
3. **Create tables** — open Supabase Dashboard → SQL Editor → paste and run:
   [`sql/front-office-schema.sql`](sql/front-office-schema.sql)
4. Start: `npm run dev` → http://localhost:5001

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
